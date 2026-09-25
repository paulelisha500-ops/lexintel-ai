import sys
import types
sys.path.insert(0, ".")
from datetime import date

_fake_llm_module = types.ModuleType("app.core.llm")
_fake_llm_module.get_chat_model = lambda *a, **kw: None
_fake_llm_module.get_embedding_model = lambda *a, **kw: None
sys.modules["app.core.llm"] = _fake_llm_module

from app.ingestion.parsers.uae_legislation_gov_ae import (
    parse_pdf_text, _strip_page_footers, _parse_uae_date, LegislationMetadata,
)
from app.ingestion.uae_law_ingestion import LawSource

with open("tests/fixtures/uae_penal_code_sample.txt", encoding="utf-8") as f:
    real_fixture_text = f.read()

meta = LegislationMetadata(
    legislation_id=1529,
    title="Federal Law by Decree No. (31) of 2021 Promulgating the Crimes and Penalties Law",
    law_number="31", year=2021,
    issued_date=date(2021, 9, 20),
    effective_date=date(2022, 1, 2),
    gazette_date=date(2021, 9, 26),
    gazette_no="712",
    state="Active",
    url="https://uaelegislation.gov.ae/en/legislations/1529",
)
source = LawSource(name="UAE Legislation", jurisdiction="federal", base_url="https://uaelegislation.gov.ae/en")

print("1. _parse_uae_date handles the site's date format...")
assert _parse_uae_date("20 Sep 2021") == date(2021, 9, 20)
assert _parse_uae_date("02 Jan 2022") == date(2022, 1, 2)
print("   OK")

print("2. _strip_page_footers removes repeated page-footer noise, not body text...")
cleaned = _strip_page_footers(real_fixture_text, meta.title)
assert "Federal Law by Decree of 2021 Promulgating the Crimes and Penalties Law 47" not in cleaned
# body text that happens to be near article boundaries must survive:
assert "The provisions of the Islamic Sharia shall apply" in cleaned
print("   OK -- footers gone, real article text intact")

print("3. parse_pdf_text against the REAL fixture (actual official PDF text)...")
articles = parse_pdf_text(real_fixture_text, meta, source)
numbers = [a.article_number for a in articles]
print("   Parsed article numbers:", numbers)

# The decree's own spelled-out preamble ("Article One/Two/Three") must NOT
# be parsed as numeric articles -- those are decree mechanics, not the
# attached law's substantive provisions.
assert "One" not in numbers and "Two" not in numbers and "Three" not in numbers
# Both "Article (N)" and "Article(N)" (no space, real in the source, e.g.
# Article(30)) must be caught by the same pattern.
assert "30" in numbers, "no-space 'Article(30)' variant was not matched"
# Real, non-sequential article numbers from the fixture must all appear,
# in source order, not sorted/deduplicated in some way that would hide a
# parsing gap:
assert numbers == ["1", "2", "3", "4", "5", "6", "13", "14", "17", "27", "30", "154", "227"], numbers
print("   OK -- all real article numbers found, decree preamble correctly excluded")

print("4. Article body text is real, complete, and correctly bounded...")
art_1 = next(a for a in articles if a.article_number == "1")
assert "Islamic Sharia" in art_1.body and "Qisas" in art_1.body
assert "Article (2)" not in art_1.body, "article 1's body bled into article 2"
art_227 = articles[-1]
assert "shall not lapse by the passage of time" in art_227.body
print("   OK -- checked article 1 and the last article's body boundaries")

print("5. Metadata correctly attached to every article...")
assert all(a.law_number == "31" and a.year == 2021 for a in articles)
assert all(a.effective_from == "2022-01-02" for a in articles)
assert all(a.effective_to is None for a in articles), "Active law should have no effective_to"
assert all(a.jurisdiction == "federal" for a in articles)
print("   OK")

print("6. Book/Section/Chapter/Part structure context tracked correctly across articles...")
by_number = {a.article_number: a for a in articles}
# Article 1 sits under Book One > Section One (no Chapter/Part at that point)
assert by_number["1"].extra_metadata["book"] == "One"
assert by_number["1"].extra_metadata["section"] == "One"
assert by_number["1"].extra_metadata["chapter"] is None
# Article 13 sits under Section Two > Chapter One (structure has moved on)
assert by_number["13"].extra_metadata["section"] == "Two"
assert by_number["13"].extra_metadata["chapter"] == "One"
# Article 154 has moved into Book Two entirely
assert by_number["154"].extra_metadata["book"] == "Two"
assert by_number["154"].extra_metadata["chapter"] == "One"
print("   OK -- structure context correctly updates as articles progress through the law")

print("\nALL CHECKS PASSED against the real, official UAE Penal Code text.")
