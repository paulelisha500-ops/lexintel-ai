"""
UAE legal corpus ingestion pipeline.

Run this OFFLINE, with real internet access and (ideally) a licensed data
feed -- this is not something to run inside the app's request path. It is
intentionally NOT pre-populated with hand-typed statute text: for a corpus
that a judge or lawyer will actually rely on, the text must come from the
official source, not from an LLM's memory or a hand-transcription. See
docs/UAE_LAW_SOURCES.md for the verified official portals and how to get
proper access to each one.

Pipeline stages:
  1. fetch      -- pull each law/regulation page from an official source
  2. parse      -- split into articles, capture number + title + body
  3. tag        -- attach jurisdiction + effective_from/effective_to +
                   source_url metadata (this is what makes the RAG agent's
                   effective-date filter possible)
  4. chunk      -- article-level chunks (legal text should not be split
                   mid-article; that's how citations become misleading)
  5. embed      -- push into FAISS, versioned by ingestion date so you can
                   roll back a bad ingest
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from datetime import date
from typing import Iterable, Optional

import httpx
from bs4 import BeautifulSoup
from langchain_core.documents import Document
from langchain_community.vectorstores import FAISS

from app.core.llm import get_embedding_model
from app.core.config import get_settings


@dataclass
class LawSource:
    """One row of docs/UAE_LAW_SOURCES.md, made machine-readable."""
    name: str
    jurisdiction: str          # federal | difc | adgm | dubai | abu_dhabi
    base_url: str
    requires_auth: bool = False
    notes: str = ""


# Populate this from docs/UAE_LAW_SOURCES.md. Left as a stub with real
# portal roots (verified against official sites) but no scraping logic
# baked in per-source, since each portal has a different structure and
# most require respecting robots.txt / a formal data-access request
# rather than open scraping -- see docs/UAE_LAW_SOURCES.md "Access notes".
UAE_LAW_SOURCES: list[LawSource] = [
    LawSource(
        name="UAE Legislation (General Secretariat of the Cabinet)",
        jurisdiction="federal",
        base_url="https://uaelegislation.gov.ae/en",
        notes="Unified official platform for federal laws + executive regulations, EN/AR.",
    ),
    LawSource(
        name="Ministry of Justice e-Laws Portal",
        jurisdiction="federal",
        base_url="https://elaws.moj.gov.ae",
        notes="Federal laws with English translations + judicial opinions.",
    ),
    LawSource(
        name="DIFC Legal Database",
        jurisdiction="difc",
        base_url="https://www.difc.com/business/laws-and-regulations/legal-database",
        notes="Common-law civil/commercial framework for the DIFC free zone.",
    ),
    LawSource(
        name="ADGM Legal Framework",
        jurisdiction="adgm",
        base_url="https://www.adgm.com/legal-framework",
        notes="English common law as directly applicable law within ADGM.",
    ),
]


@dataclass
class RawArticle:
    title: str
    article_number: Optional[str]
    body: str
    jurisdiction: str
    source_url: str
    effective_from: Optional[str] = None   # ISO date, parse from the source's "in force from"
    effective_to: Optional[str] = None     # None == still in force
    law_number: Optional[str] = None
    year: Optional[int] = None
    extra_metadata: dict = field(default_factory=dict)


def fetch_page(url: str, client: httpx.Client) -> BeautifulSoup:
    resp = client.get(url, timeout=30.0, follow_redirects=True)
    resp.raise_for_status()
    return BeautifulSoup(resp.text, "html.parser")


def parse_articles_from_page(soup: BeautifulSoup, source: LawSource, url: str) -> list[RawArticle]:
    """
    STUB for every source except uaelegislation.gov.ae (see
    app/ingestion/parsers/uae_legislation_gov_ae.py for that one, wired in
    via ingest_uaelegislation_gov_ae() below -- it doesn't go through this
    generic soup-based signature since its actual text comes from a PDF,
    not the HTML page). Each remaining portal renders differently
    (elaws.moj.gov.ae, the DIFC/ADGM databases) -- implement one parser
    per source and register it here rather than attempting a single
    generic parser; legal text is exactly where "close enough" parsing
    produces citations that look right and aren't.
    """
    raise NotImplementedError(
        f"No article parser registered for {source.name}. "
        "Add one in app/ingestion/parsers/ and wire it in here before "
        "ingesting this source."
    )


def ingest_uaelegislation_gov_ae(legislation_ids: list[int], client: httpx.Client) -> list[RawArticle]:
    """Real, tested ingestion path for the one source that's implemented.
    legislation_ids are the numeric ids from each law's uaelegislation.gov.ae
    URL (e.g. 1529 for /en/legislations/1529) -- there is no working index/
    sitemap enumeration here yet, so start from docs/UAE_LAW_SOURCES.md's
    list of specific laws this system needs (penal code, criminal
    procedure, evidence law, ...) and grow the id list deliberately rather
    than trying to crawl the whole platform in one run."""
    from app.ingestion.parsers.uae_legislation_gov_ae import ingest_legislation

    source = next(s for s in UAE_LAW_SOURCES if "uaelegislation.gov.ae" in s.base_url)
    all_articles: list[RawArticle] = []
    for leg_id in legislation_ids:
        articles = ingest_legislation(leg_id, source, client)
        print(f"[ingest] legislation {leg_id}: {len(articles)} articles parsed.")
        all_articles.extend(articles)
    return all_articles


def compute_checksum(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def articles_to_documents(articles: Iterable[RawArticle]) -> list[Document]:
    docs = []
    for a in articles:
        docs.append(Document(
            page_content=a.body,
            metadata={
                "title": a.title,
                "article": a.article_number,
                "jurisdiction": a.jurisdiction,
                "source_url": a.source_url,
                "effective_from": a.effective_from,
                "effective_to": a.effective_to,
                "law_number": a.law_number,
                "year": a.year,
                "checksum": compute_checksum(a.body),
                "ingested_at": date.today().isoformat(),
                **a.extra_metadata,
            },
        ))
    return docs


def build_or_update_index(documents: list[Document], index_path: Optional[str] = None) -> FAISS:
    settings = get_settings()
    path = index_path or settings.faiss_index_path
    embeddings = get_embedding_model()

    try:
        store = FAISS.load_local(path, embeddings, allow_dangerous_deserialization=True)
        store.add_documents(documents)
    except Exception:
        store = FAISS.from_documents(documents, embeddings)

    store.save_local(path)
    return store


def run_full_ingestion(
    sources: list[LawSource] = UAE_LAW_SOURCES,
    uaelegislation_ids: Optional[list[int]] = None,
) -> None:
    """
    Entry point for the offline ingestion job (wire this into a Celery
    beat schedule, e.g. nightly, to pick up amendments -- see
    docs/UAE_LAW_SOURCES.md for how often each source publishes updates).

    uaelegislation_ids: specific legislation ids to ingest from the one
    implemented source (see ingest_uaelegislation_gov_ae's docstring for
    why this is an explicit list rather than a full-site crawl). Example
    starting set for a criminal case system: [1529, 1609, 1526] (Crimes
    and Penalties Law, Criminal Procedures Law, Cybercrimes Law) -- verify
    current ids against docs/UAE_LAW_SOURCES.md before relying on these,
    since a given law's id is stable but this list itself is illustrative.
    """
    all_docs: list[Document] = []
    with httpx.Client(headers={"User-Agent": "LexIntel-Ingestion/0.1"}) as client:
        for source in sources:
            print(f"[ingest] {source.name} ({source.jurisdiction}) -- {source.notes}")
            if "uaelegislation.gov.ae" in source.base_url and uaelegislation_ids:
                articles = ingest_uaelegislation_gov_ae(uaelegislation_ids, client)
                all_docs.extend(articles_to_documents(articles))
            else:
                # Real run for any other source: enumerate each law's page
                # from the source's index/sitemap, then implement and call
                # a parser matching ingest_uaelegislation_gov_ae's pattern.
                # Left unimplemented deliberately -- see parse_articles_from_page.
                continue

    if all_docs:
        build_or_update_index(all_docs)
        print(f"[ingest] indexed {len(all_docs)} articles.")
    else:
        print("[ingest] no documents ingested -- pass uaelegislation_ids for the "
              "implemented source, or register parsers for the others first.")


if __name__ == "__main__":
    # Starting set: Crimes and Penalties Law, Criminal Procedures Law,
    # Cybercrimes Law -- see docs/UAE_LAW_SOURCES.md before extending this.
    run_full_ingestion(uaelegislation_ids=[1529, 1609, 1526])
