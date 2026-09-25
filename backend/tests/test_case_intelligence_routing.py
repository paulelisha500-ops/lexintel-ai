import sys
sys.path.insert(0, ".")
from unittest.mock import patch

# Tests the language-routing logic only; nothing below calls the LLM node.
from app.agents import case_intelligence_agent as cia

print("1. Arabic input routes to extract_arabic_entities, never touches spaCy...")
with patch.object(cia, "get_nlp") as mock_get_nlp:
    result = cia.extract_general_entities({
        "case_id": "c1",
        "raw_text": "رفعت النيابة العامة الاتحادية في أبوظبي دعوى بتاريخ 2026-06-01 بمبلغ 5000 درهم.",
    })
    mock_get_nlp.assert_not_called()
labels = {e["label"] for e in result["entities"]}
assert "ORG" in labels and "LOCATION" in labels and "DATE" in labels and "AMOUNT_AED" in labels
print("   OK -- spaCy never invoked for Arabic text; got labels:", labels)

print("2. English input routes to spaCy path (mocked model, real routing logic)...")


class FakeEnt:
    def __init__(self, text, label_, start_char, end_char):
        self.text, self.label_, self.start_char, self.end_char = text, label_, start_char, end_char


class FakeDoc:
    def __init__(self, ents):
        self.ents = ents


class FakeNLP:
    def __call__(self, text):
        return FakeDoc([FakeEnt("Dubai Courts", "ORG", 0, 12), FakeEnt("2026-06-01", "DATE", 20, 30)])


with patch.object(cia, "get_nlp", return_value=FakeNLP()) as mock_get_nlp:
    result = cia.extract_general_entities({
        "case_id": "c2",
        "raw_text": "Dubai Courts issued a ruling on 2026-06-01 regarding the matter.",
    })
    mock_get_nlp.assert_called_once()
labels = {e["label"] for e in result["entities"]}
assert labels == {"ORG", "DATE"}
assert any(e["text"] == "Dubai Courts" for e in result["entities"])
print("   OK -- English routed through spaCy path (mocked), got labels:", labels)

print("3. Mixed bilingual, Arabic-majority text still routes to Arabic path...")
with patch.object(cia, "get_nlp") as mock_get_nlp:
    result = cia.extract_general_entities({
        "case_id": "c3",
        "raw_text": "أصدرت المحكمة الاتحادية العليا حكمها في القضية رقم CR-2026-00123 بتاريخ 2026-06-01.",
    })
    mock_get_nlp.assert_not_called()
assert any(e["label"] == "CASE_REF" for e in result["entities"])
print("   OK -- bilingual Arabic-majority document did not fall through to English-only spaCy")

print("\nALL ROUTING CHECKS PASSED.")
