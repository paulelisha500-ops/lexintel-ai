"""
Law Library ingestion (Module 6's corpus).

Every official UAE statute portal blocks automated downloads (see
docs/UAE_LAW_SOURCES.md), and this project does not circumvent that. The
sanctioned path used here: an authorized staff member downloads the official
PDF in their own browser and uploads it. This module parses it into
article-level chunks, tags jurisdiction + effective dates, and indexes it
into FAISS (semantic search) and Elasticsearch (keyword search).

Parsing: "Article (12)" / "Article 12" (English) and "المادة (12)" /
"مادة 12" (Arabic, with Arabic-Indic digits normalized). If a document has
no article markers, it is chunked into numbered sections instead, and the
law document is marked parse_mode="sections" so citations say "Section N".
"""

from __future__ import annotations

import fcntl
import logging
import re
import uuid
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator, Optional

from app.core.config import get_settings

log = logging.getLogger("lexintel.library")

_ARABIC_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹", "01234567890123456789")

_ARTICLE_RE = re.compile(
    r"(?:^|\n)\s*(?:"
    r"Article\s*\(?\s*(?P<en>\d{1,4})\s*\)?"
    r"|(?:ال)?مادة\s*\(?\s*(?P<ar>\d{1,4})\s*\)?"
    r")\s*(?=[\n:\-–.]|\s)",
    re.IGNORECASE,
)


@dataclass
class ParsedArticle:
    number: str
    body: str
    kind: str          # article | section


def normalize(text: str) -> str:
    text = text.translate(_ARABIC_DIGITS)
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[ \t\u00a0]+", " ", text)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def parse_articles(text: str) -> tuple[list[ParsedArticle], str]:
    clean = normalize(text)
    matches = list(_ARTICLE_RE.finditer(clean))

    articles: list[ParsedArticle] = []
    if len(matches) >= 2:
        # Start at the first "Article 1" when present: promulgating decrees often
        # carry their own preamble articles before the law's own numbering begins.
        start_index = 0
        for i, m in enumerate(matches):
            if (m.group("en") or m.group("ar")) == "1":
                start_index = i
                break
        seen: set[str] = set()
        for i in range(start_index, len(matches)):
            m = matches[i]
            number = m.group("en") or m.group("ar")
            end = matches[i + 1].start() if i + 1 < len(matches) else len(clean)
            body = clean[m.end():end].strip(" \n:-–.")
            if len(body) < 15:
                continue
            if number in seen:
                # A repeated number is almost always a cross-reference that happened
                # to start a line; keep it as a continuation of the previous article.
                if articles:
                    articles[-1].body += "\n" + body
                continue
            seen.add(number)
            articles.append(ParsedArticle(number=number, body=body[:12000], kind="article"))
    if len(articles) >= 2:
        return articles, "articles"

    # No reliable article structure: numbered ~1200-char sections on paragraph boundaries.
    sections: list[ParsedArticle] = []
    buffer = ""
    for para in re.split(r"\n\s*\n", clean):
        if len(buffer) + len(para) > 1200 and buffer:
            sections.append(ParsedArticle(number=str(len(sections) + 1), body=buffer.strip(), kind="section"))
            buffer = ""
        buffer += para + "\n\n"
    if buffer.strip():
        sections.append(ParsedArticle(number=str(len(sections) + 1), body=buffer.strip(), kind="section"))
    return sections, "sections"


# ---------------------------------------------------------------------------
# FAISS index access: one writer at a time (file lock), readers reload on change.
# ---------------------------------------------------------------------------

def index_dir() -> Path:
    path = Path(get_settings().faiss_index_path)
    path.mkdir(parents=True, exist_ok=True)
    return path


@contextmanager
def index_write_lock() -> Iterator[None]:
    lock_path = index_dir() / ".write.lock"
    with open(lock_path, "w") as fh:
        fcntl.flock(fh, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(fh, fcntl.LOCK_UN)


def index_exists() -> bool:
    return (index_dir() / "index.faiss").exists()


def _model_marker() -> Path:
    return index_dir() / "embedding_model.txt"


def index_model_mismatch() -> bool:
    """True when the on-disk index was built with a different embedding model
    (vectors from two models are not comparable, so search would be garbage)."""
    if not index_exists():
        return False
    from app.ai.embeddings import signature

    marker = _model_marker()
    built_with = marker.read_text().strip() if marker.exists() else "paraphrase-multilingual-mpnet-base-v2"
    return built_with != signature()


def reset_index() -> None:
    with index_write_lock():
        for name in ("index.faiss", "index.pkl", "embedding_model.txt"):
            (index_dir() / name).unlink(missing_ok=True)


_cached_store = None
_cached_mtime: float | None = None


def load_store():
    """Cached FAISS store; reloads automatically when the worker writes a new index."""
    global _cached_store, _cached_mtime
    if not index_exists() or index_model_mismatch():
        return None
    mtime = (index_dir() / "index.faiss").stat().st_mtime
    if _cached_store is not None and _cached_mtime == mtime:
        return _cached_store
    from langchain_community.vectorstores import FAISS

    from app.core.llm import get_embedding_model

    store = FAISS.load_local(str(index_dir()), get_embedding_model(), allow_dangerous_deserialization=True)
    _cached_store, _cached_mtime = store, mtime
    return store


def article_count() -> int:
    store = load_store()
    try:
        return len(store.index_to_docstore_id) if store is not None else 0
    except Exception:
        return 0


def add_articles(law_doc: dict, articles: list[ParsedArticle], parse_mode: str) -> list[str]:
    """Embeds and indexes the articles. Returns the vector ids (for later deletion)."""
    from langchain_community.vectorstores import FAISS
    from langchain_core.documents import Document

    from app.core.llm import get_embedding_model
    from app.db import search

    label = "Art." if parse_mode == "articles" else "Section"
    docs, ids, es_docs = [], [], []
    for art in articles:
        vector_id = str(uuid.uuid4())
        metadata = {
            "title": law_doc["title"],
            "article": art.number,
            "article_label": f"{label} {art.number}",
            "jurisdiction": law_doc["jurisdiction"],
            "source_url": law_doc.get("source_url") or "",
            "effective_from": law_doc.get("effective_from"),
            "effective_to": law_doc.get("effective_to"),
            "law_number": law_doc.get("law_number"),
            "year": law_doc.get("year"),
            "language": law_doc.get("language"),
            "law_document_id": law_doc["id"],
            "legislation_state": law_doc.get("legislation_state"),
        }
        docs.append(Document(page_content=art.body, metadata=metadata))
        ids.append(vector_id)
        es_docs.append((vector_id, {**metadata, "body": art.body}))

    embeddings = get_embedding_model()
    with index_write_lock():
        if index_exists() and not index_model_mismatch():
            store = FAISS.load_local(str(index_dir()), embeddings, allow_dangerous_deserialization=True)
            store.add_documents(docs, ids=ids)
        else:
            store = FAISS.from_documents(docs, embeddings, ids=ids)
        store.save_local(str(index_dir()))
        from app.ai.embeddings import signature

        _model_marker().write_text(signature())

    search.bulk_index("law", es_docs)
    return ids


def remove_articles(law_document_id: str, vector_ids: Optional[list[str]]) -> None:
    from app.db import search

    if vector_ids and index_exists():
        from langchain_community.vectorstores import FAISS

        from app.core.llm import get_embedding_model

        with index_write_lock():
            store = FAISS.load_local(str(index_dir()), get_embedding_model(), allow_dangerous_deserialization=True)
            present = [vid for vid in vector_ids if vid in store.docstore._dict]
            if present:
                store.delete(present)
                store.save_local(str(index_dir()))
    search.delete_by_field("law", "law_document_id", str(law_document_id))


def articles_for_document(law_document_id: str, limit: int = 2000) -> list[dict]:
    store = load_store()
    if store is None:
        return []
    out = []
    for doc in store.docstore._dict.values():
        if doc.metadata.get("law_document_id") == str(law_document_id):
            out.append({"article": doc.metadata.get("article"), "label": doc.metadata.get("article_label"),
                        "text": doc.page_content})
            if len(out) >= limit:
                break

    def _key(item):
        try:
            return int(item["article"])
        except (TypeError, ValueError):
            return 10**9
    return sorted(out, key=_key)
