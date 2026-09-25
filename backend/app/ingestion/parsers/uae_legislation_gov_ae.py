"""
Parser for uaelegislation.gov.ae -- the General Secretariat of the Cabinet's
unified legislation platform, and per the project README the broadest
single federal source, so the first one implemented here.

Real structure (confirmed 2026-07-22 against live pages, not assumed):
  - https://uaelegislation.gov.ae/en/legislations/{id}
    Metadata only: title, issued/effective/gazette dates, gazette number,
    "Legislation State" (Active/Repealed/...). The article text is NOT in
    this page's static HTML.
  - https://uaelegislation.gov.ae/en/legislations/{id}/download
    A PDF containing the full text, "Article (N)" markers throughout,
    organized under Book -> Section -> Chapter -> Part headers (not every
    level present in every law). This is what actually gets parsed into
    articles.

Two things worth knowing before running this for real:
  1. The promulgating decree that attaches a law (e.g. "Federal Law by
     Decree No. (31) of 2021") has its own few articles ("Article One",
     "Article Two", spelled out) BEFORE the attached law's own Article (1)
     starts. parse_pdf_text() below only starts collecting once it hits
     the FIRST NUMERIC "Article (1)" -- the spelled-out preamble articles
     are decree mechanics ("this repeals law X"), not substantive
     provisions, and mixing them into the same numbering would make every
     later article reference off in a way a citation absolutely cannot
     tolerate.
  2. PDF text extraction leaves the repeated page footer ("Federal Law by
     Decree of 2021 Promulgating the Crimes and Penalties Law 47") inside
     the text stream. _strip_page_footers() removes it by pattern-matching
     the law's own title text, since it's the one string guaranteed to
     recur on every page and nowhere else.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date, datetime
from typing import Optional

import httpx
from bs4 import BeautifulSoup
from pypdf import PdfReader
import io

from app.ingestion.uae_law_ingestion import LawSource, RawArticle

BASE = "https://uaelegislation.gov.ae"


@dataclass
class LegislationMetadata:
    legislation_id: int
    title: str
    law_number: Optional[str]
    year: Optional[int]
    issued_date: Optional[date]
    effective_date: Optional[date]
    gazette_date: Optional[date]
    gazette_no: Optional[str]
    state: str                 # "Active" | "Repealed" | "Amended" | raw text if unrecognized
    url: str


# "Federal Law by Decree No. (31) of 2021 ..." / "Federal Law No. (7) of 2014 ..."
_LAW_NUMBER_RE = re.compile(r"No\.?\s*\((\d+)\)\s*of\s*(\d{4})", re.IGNORECASE)

_DATE_LABELS = {
    "issued_date": "Issued Date",
    "effective_date": "Effective Date",
    "gazette_date": "Official Gazette Date",
}


def _parse_uae_date(text: str) -> Optional[date]:
    """Dates on this site render like '20 Sep 2021'."""
    text = text.strip()
    for fmt in ("%d %b %Y", "%d %B %Y"):
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    return None


def fetch_metadata(legislation_id: int, client: httpx.Client, lang: str = "en") -> LegislationMetadata:
    url = f"{BASE}/{lang}/legislations/{legislation_id}"
    resp = client.get(url, timeout=30.0, follow_redirects=True)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")

    title_el = soup.find(["h1", "h2"])
    title = title_el.get_text(strip=True) if title_el else soup.title.get_text(strip=True)

    law_number, year = None, None
    m = _LAW_NUMBER_RE.search(title)
    if m:
        law_number, year = m.group(1), int(m.group(2))

    # Each metadata field on this page is a label ("Issued Date") followed
    # by its value in the next sibling block (an <h4>/<h5>-ish element in
    # the live markup) -- walk text nodes rather than relying on one fixed
    # tag name, since that's the more fragile assumption here.
    field_values: dict[str, str] = {}
    all_text_nodes = [t.strip() for t in soup.stripped_strings]
    for i, node in enumerate(all_text_nodes):
        for field, label in _DATE_LABELS.items():
            if node == label and i + 1 < len(all_text_nodes):
                field_values[field] = all_text_nodes[i + 1]
        if node == "Official Gazette No" and i + 1 < len(all_text_nodes):
            field_values["gazette_no"] = all_text_nodes[i + 1]
        if node == "Legislation State" and i + 1 < len(all_text_nodes):
            field_values["state"] = all_text_nodes[i + 1]

    return LegislationMetadata(
        legislation_id=legislation_id,
        title=title,
        law_number=law_number,
        year=year,
        issued_date=_parse_uae_date(field_values.get("issued_date", "")),
        effective_date=_parse_uae_date(field_values.get("effective_date", "")),
        gazette_date=_parse_uae_date(field_values.get("gazette_date", "")),
        gazette_no=field_values.get("gazette_no"),
        state=field_values.get("state", "Unknown"),
        url=url,
    )


def fetch_full_text(legislation_id: int, client: httpx.Client, lang: str = "en") -> str:
    url = f"{BASE}/{lang}/legislations/{legislation_id}/download"
    resp = client.get(url, timeout=60.0, follow_redirects=True)
    resp.raise_for_status()
    reader = PdfReader(io.BytesIO(resp.content))
    return "\n".join(page.extract_text() or "" for page in reader.pages)


def _strip_page_footers(text: str, title_hint: str) -> str:
    """Removes the repeated '<law title> <page number>' footer that PDF
    text extraction leaves inline. title_hint should be a distinctive
    prefix of the law's title (first 4-5 words is enough, and safer than
    the full title since OCR/extraction sometimes drops a stray
    character); matched loosely and only when immediately followed by a
    bare page number, so it can't accidentally eat real body text that
    happens to mention the law's own name."""
    prefix_words = " ".join(title_hint.split()[:5])
    pattern = re.compile(rf"{re.escape(prefix_words)}.*?\d+\s*\n", re.IGNORECASE)
    return pattern.sub("\n", text)


# Matches "Article (12)" / "Article(12)" -- both spacings appear in real
# extracted text -- but NOT "Article One" (the promulgating decree's own
# preamble articles, spelled out, handled separately in parse_pdf_text).
_ARTICLE_RE = re.compile(r"Article\s*\((\d+)\)")
_STRUCTURE_RE = re.compile(r"^(Book|Section|Chapter|Part)\s+(\w+)\s*$", re.MULTILINE)


def parse_pdf_text(
    full_text: str,
    meta: LegislationMetadata,
    source: LawSource,
) -> list[RawArticle]:
    clean_text = _strip_page_footers(full_text, meta.title)

    matches = list(_ARTICLE_RE.finditer(clean_text))
    if not matches:
        return []

    # Running Book/Section/Chapter/Part context, updated as we scan forward
    # so each article's extra_metadata reflects where it actually sits --
    # not every law has all four levels, so unseen ones stay None.
    structure_hits = list(_STRUCTURE_RE.finditer(clean_text))

    def _structure_context_at(pos: int) -> dict:
        context = {"book": None, "section": None, "chapter": None, "part": None}
        for hit in structure_hits:
            if hit.start() > pos:
                break
            context[hit.group(1).lower()] = hit.group(2)
        return context

    articles: list[RawArticle] = []
    for i, m in enumerate(matches):
        article_number = m.group(1)
        body_start = m.end()
        body_end = matches[i + 1].start() if i + 1 < len(matches) else len(clean_text)
        body = clean_text[body_start:body_end].strip()

        articles.append(RawArticle(
            title=meta.title,
            article_number=article_number,
            body=body,
            jurisdiction=source.jurisdiction,
            source_url=f"{meta.url}/download",
            effective_from=meta.effective_date.isoformat() if meta.effective_date else None,
            effective_to=None if meta.state.lower() == "active" else "unknown",
            law_number=meta.law_number,
            year=meta.year,
            extra_metadata={
                **_structure_context_at(m.start()),
                "legislation_state": meta.state,
                "gazette_no": meta.gazette_no,
            },
        ))
    return articles


def ingest_legislation(legislation_id: int, source: LawSource, client: httpx.Client, lang: str = "en") -> list[RawArticle]:
    """The function uae_law_ingestion.py's per-source dispatch calls for
    this source. One legislation id in, its parsed articles out."""
    meta = fetch_metadata(legislation_id, client, lang=lang)
    full_text = fetch_full_text(legislation_id, client, lang=lang)
    return parse_pdf_text(full_text, meta, source)
