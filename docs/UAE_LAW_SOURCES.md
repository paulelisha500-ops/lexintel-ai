# UAE legal source map

`app/ingestion/uae_law_ingestion.py` is intentionally not pre-loaded with
statute text. For a corpus a lawyer or judge will actually rely on, the
text has to come from the official source at ingestion time, not from an
LLM's memory and not from hand-transcription -- both are exactly how a
legal-research tool ends up confidently citing a law that doesn't say
what it claims. This document is the source list that pipeline is meant
to pull from, verified as of July 2026.

## Federal law

| Source | URL | Notes |
|---|---|---|
| UAE Legislation (unified platform) | https://uaelegislation.gov.ae/en | Run by the General Secretariat of the UAE Cabinet. The single best starting point -- covers all federal laws, executive regulations, and amendments in one searchable index, in Arabic and English. **Parser implemented** (`app/ingestion/parsers/uae_legislation_gov_ae.py`), tested against the actual live Penal Code text -- see `docs/ARCHITECTURE.md`. Real structure: the metadata page (`/en/legislations/{id}`) has dates/gazette info/state but not the article text; the actual articles are in the PDF at `/en/legislations/{id}/download`. |
| Ministry of Justice -- Laws & Legislation | https://www.moj.gov.ae/en/laws-and-legislation.aspx | The Ministry's own portal; useful for the curated "main legislations" list (Evidence Law, Civil Procedures, Penal Procedures, Crimes and Penalties Law, Civil Transactions Law, etc). |
| Ministry of Justice e-Laws portal | https://elaws.moj.gov.ae | English translations of federal law plus UAE High Court case decisions (civil and criminal) and international treaties -- useful for Module 5 (similar-case retrieval) once you have access. |
| UAE Official Gazette | via Ministry of Justice | Federal laws are published here within two weeks of presidential signature -- this is the authoritative "as of" record for effective dates. Subscription is arranged through the Ministry of Justice. |

## Free-zone law (different legal systems, not a subset of federal law)

| Source | URL | Notes |
|---|---|---|
| DIFC legal database | https://www.difc.com/business/laws-and-regulations/legal-database | Dubai International Financial Centre -- an independent, English-language common-law jurisdiction for civil and commercial matters, established under Federal Law No. 8 of 2004. |
| ADGM legal framework | https://www.adgm.com/legal-framework | Abu Dhabi Global Market -- adopts English common law directly, established under Abu Dhabi Law No. 4 of 2013. |

**Tag every ingested document with its jurisdiction** (`federal`, `difc`,
`adgm`, and eventually emirate-level sources like Dubai Courts / Abu Dhabi
Judicial Department for matters outside the free zones). The legal
research agent's system prompt is written to keep these separate --
conflating "UAE law" as one undifferentiated corpus is a real accuracy
risk given how different DIFC/ADGM's common-law framework is from federal
civil law.

## Current blocker: every structured source is unreachable (verified 2026-09-09)

**There is currently no viable automated path to a UAE statute corpus from
an ordinary server environment.** All six documented sources were probed
from inside the backend container with a normal browser User-Agent:

| Source | Result | Usable? |
|---|---|---|
| `uaelegislation.gov.ae` | `403`, `server: cloudflare` (incl. homepage) | No -- bot wall |
| `elaws.moj.gov.ae` | `ConnectError` (does not resolve) | No |
| `moj.gov.ae` (main) | `200`, 139KB | Barely -- see below |
| `u.ae` | `200`, 1.2MB | No -- services portal, not statute text |
| DIFC legal database | `429` on every request, incl. homepage | No -- bot wall |
| ADGM legal framework | `403`, `server: cloudflare` | No -- bot wall |

The DIFC `429` is a static ~29KB block page returned identically to a
single first request, not genuine rate limiting from our traffic -- same
category of bot wall as the Cloudflare `403`s, just a different status
code.

`moj.gov.ae` is the only one that serves real content, and it is a dead
end for ingestion: its "UAE Legislations" index surfaces exactly **one**
actual statute (Federal Law No. 39 of 2006), and that document is a 10MB
**scanned-image PDF** (`ScandAll PRO` / JFIF markers, zero `Article`
string matches). There is no text layer, so it would need OCR per page
before any parsing -- and one law does not make a corpus.

On `uaelegislation.gov.ae` specifically, note the contradiction worth
recording: its `robots.txt` is `User-agent: * / Disallow:` -- an explicit
allow-all -- while its edge blocks every programmatic request regardless
of User-Agent (plain bot UA and browser UA both `403`). The declared
crawl policy and the enforced behaviour disagree. This is a Cloudflare
challenge keyed on JS execution / TLS fingerprint, not a robots rule.

**This is deliberately not worked around in this repo.** Solving a live
bot challenge -- headless-browser evasion, TLS fingerprint spoofing, a
solver service -- is circumventing an access control, which is a
different act from setting a User-Agent, and it is a bad foundation for a
product whose entire value proposition is that its citations are
legitimate. The sanctioned path is the one already described below:
request a formal data feed from the General Secretariat of the Cabinet /
Ministry of Justice.

Practical consequence: `parse_articles_from_page` and
`parsers/uae_legislation_gov_ae.py` are untestable against live data from
here, so `/research/ask` has no corpus and returns nothing useful. The
parser's unit tests still pass -- they run against the saved fixture in
`tests/fixtures/`, not the network -- so a green test run does **not**
mean ingestion works end to end. Treat "one full UAE law source parser"
in the README's status as *implemented but currently unreachable*.

## How the corpus gets in today: the Law Library

Because every automated path is blocked, LexIntel ingests law through the
**Law Library** screen: an authorised staff member downloads the official
PDF in their own browser (a person reading a public government page, not a
bot) and uploads it with its title, jurisdiction, and in-force dates.
`app/ingestion/law_library.py` then:

1. extracts the text layer, OCR-ing scanned pages (Arabic + English);
2. splits it at "Article (N)" / "المادة (N)" markers (Arabic-Indic digits
   normalised), starting at the law's own Article 1 so a promulgating
   decree's preamble can't shift the numbering;
3. falls back to numbered sections (and says so) if no article markers exist;
4. indexes every article into FAISS (semantic) and Elasticsearch (keyword),
   tagged with jurisdiction and effective dates for the in-force filter.

Duplicate files are rejected by SHA-256; removing a law removes its vectors.

## Access notes (read before writing a scraper)

- Treat each portal's terms of use and `robots.txt` as authoritative.
  `uaelegislation.gov.ae` and `moj.gov.ae` are public-facing government
  information services, but that doesn't mean unrestricted bulk scraping
  is the right approach -- for a production system, contact the Ministry
  of Justice / General Secretariat of the Cabinet about a formal data
  feed or API rather than scraping at scale. `elaws.moj.gov.ae` in
  particular indexes over 20,000 legal texts and 45,000 "matters of law,"
  which is exactly the kind of volume where a sanctioned feed is worth
  asking for.
- `parse_articles_from_page()` in `uae_law_ingestion.py` is still
  unimplemented for `moj.gov.ae`, DIFC, and ADGM -- each portal renders
  articles with different markup, and legal text is exactly where a
  "close enough" generic parser produces citations that read correctly
  but point at the wrong article, so each still needs its own parser and
  unit tests. `uaelegislation.gov.ae` doesn't use this function at all --
  its own parser (`app/ingestion/parsers/uae_legislation_gov_ae.py`)
  handles metadata-page + PDF parsing directly, since its real text lives
  in a downloadable PDF rather than the page's HTML.
- Track amendments explicitly. Federal decree-laws are frequently issued
  as amendments to existing laws (e.g. a 2026 Cabinet Resolution amending
  a 2023 Federal Decree-Law) -- when you ingest an amendment, set the
  amended provision's `effective_to` on the old text and `effective_from`
  on the new text, rather than just adding the new text alongside the
  old. This is what makes the RAG agent's effective-date filter
  (`filter_by_effective_date` in `legal_research_agent.py`) actually work.
- DIFC and ADGM both publish their own data-protection regimes (DIFC Law
  No. 5 of 2020; ADGM's 2021 Data Protection Regulations) that are
  independent of the UAE's federal PDPL -- relevant if any part of this
  platform's own data (case files, biometric references) is processed
  through entities registered in either free zone.

## Suggested ingestion cadence

Federal laws publish to the Official Gazette on a rolling basis; DIFC and
ADGM issue amendments periodically (DIFC's Data Protection Law was
amended in 2025, for example). A nightly ingestion job (see
`run_full_ingestion()`, wired into Celery beat) that re-crawls each
source's "latest legislation" index and diffs against what's already
embedded is a reasonable starting cadence -- tune it against how often
each source actually publishes once you're watching real traffic.
