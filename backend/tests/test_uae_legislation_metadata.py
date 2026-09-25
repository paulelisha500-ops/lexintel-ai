"""
Tests fetch_metadata()'s field-extraction logic (the label-walking loop,
not the network call) against HTML built to match the label/value text
pattern actually observed on the live page on 2026-07-22 (Issued Date /
Effective Date / Official Gazette Date / Official Gazette No / Legislation
State, each a label followed by its value). This is a reasonable
approximation of that structure, not a byte-for-byte copy of the live DOM
-- confirm against a real page before relying on this in production, the
way you would for any scraper against a site that can change its markup.
"""
import sys
import types
sys.path.insert(0, ".")
from datetime import date
from unittest.mock import MagicMock

_fake_llm_module = types.ModuleType("app.core.llm")
_fake_llm_module.get_chat_model = lambda *a, **kw: None
_fake_llm_module.get_embedding_model = lambda *a, **kw: None
sys.modules["app.core.llm"] = _fake_llm_module

from app.ingestion.parsers.uae_legislation_gov_ae import fetch_metadata

SAMPLE_HTML = """
<html><head><title>United Arab Emirates Legislations | Federal Law by Decree No. (31) of 2021 Promulgating the Crimes and Penalties Law</title></head>
<body>
<h1>Federal Law by Decree No. (31) of 2021 Promulgating the Crimes and Penalties Law</h1>
<div>The last update on this law was listed on 01 Oct 2025</div>
<div>Issued Date</div><h4>20 Sep 2021</h4>
<div>Effective Date</div><h4>02 Jan 2022</h4>
<div>Official Gazette Date</div><h4>26 Sep 2021</h4>
<div>Official Gazette No</div><h4>712 (Supplement)</h4>
<div>Legislation State</div><h4>Active</h4>
</body></html>
"""


class FakeResponse:
    def __init__(self, text):
        self.text = text
    def raise_for_status(self):
        pass


class FakeClient:
    def get(self, url, timeout=None, follow_redirects=None):
        return FakeResponse(SAMPLE_HTML)


print("1. fetch_metadata extracts all fields from label/value HTML pattern...")
meta = fetch_metadata(1529, FakeClient(), lang="en")
assert meta.law_number == "31", meta.law_number
assert meta.year == 2021, meta.year
assert meta.issued_date == date(2021, 9, 20), meta.issued_date
assert meta.effective_date == date(2022, 1, 2), meta.effective_date
assert meta.gazette_date == date(2021, 9, 26), meta.gazette_date
assert meta.gazette_no == "712 (Supplement)", meta.gazette_no
assert meta.state == "Active", meta.state
assert "Crimes and Penalties" in meta.title
print("   OK -- law_number, year, all three dates, gazette_no, and state all extracted correctly")

print("\nMETADATA PARSING LOGIC CHECKS PASSED (against constructed HTML approximating the live page).")
print("Confirm against a real page fetch before production use -- see this file's docstring.")
