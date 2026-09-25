import sys
sys.path.insert(0, ".")

from app.agents.arabic_ner import is_arabic, extract_structured_entities, extract_gazetteer_entities, extract_arabic_entities

print("1. is_arabic() language routing...")
assert is_arabic("رفعت النيابة العامة في أبوظبي دعوى جزائية بتاريخ 2026-06-01.") is True
assert is_arabic("The Public Prosecution filed a criminal case on 2026-06-01.") is False
# Bilingual, Arabic-majority (English case citation embedded) should still route Arabic
mixed = "أصدرت المحكمة الاتحادية العليا حكمها في القضية رقم CR-2026-00123 بتاريخ 2026-06-01."
assert is_arabic(mixed) is True
print("   OK")

print("2. extract_structured_entities() -- language-agnostic patterns...")
text_en = "Defendant paid AED 12,500 on 2026-06-12, reference CR-2026-00123, Emirates ID 784-1990-1234567-1."
ents = extract_structured_entities(text_en)
labels = {e["label"] for e in ents}
assert labels == {"AMOUNT_AED", "DATE", "CASE_REF", "EMIRATES_ID"}, labels
assert any(e["text"] == "784-1990-1234567-1" for e in ents)
assert any(e["text"] == "CR-2026-00123" for e in ents)
print("   OK -- found:", [e["text"] for e in ents])

text_ar = "دفع المتهم 12500 درهم بتاريخ 2026-06-12 برقم القضية CR-2026-00123."
ents_ar = extract_structured_entities(text_ar)
assert any(e["label"] == "AMOUNT_AED" for e in ents_ar)
assert any(e["label"] == "DATE" for e in ents_ar)
print("   OK -- same patterns work on Arabic-context text")

print("3. extract_gazetteer_entities() -- verified government body names...")
text_gov = "رفعت النيابة العامة الاتحادية في أبوظبي دعوى أمام المحكمة الاتحادية العليا بالتنسيق مع وزارة العدل."
ents_gov = extract_gazetteer_entities(text_gov)
found_texts = {e["text"] for e in ents_gov}
# longest-match-wins: should catch "النيابة العامة الاتحادية" (federal), NOT
# also double-count the shorter "النيابة العامة" inside it
assert "النيابة العامة الاتحادية" in found_texts
assert "النيابة العامة" not in found_texts, "shorter overlapping term should not double-match"
assert "أبوظبي" in found_texts
assert "المحكمة الاتحادية العليا" in found_texts
assert "وزارة العدل" in found_texts
assert all(e["label"] in ("ORG", "LOCATION") for e in ents_gov)
print("   OK -- found:", found_texts)

print("4. extract_arabic_entities() combines both layers...")
combined = extract_arabic_entities(text_gov + " بتاريخ 2026-06-01، بمبلغ 5000 درهم.")
combined_labels = {e["label"] for e in combined}
assert "ORG" in combined_labels and "DATE" in combined_labels and "AMOUNT_AED" in combined_labels
print("   OK -- combined labels:", combined_labels)

print("5. get_arabic_ner_pipeline() raises clearly, matching compute_face_embedding()'s pattern...")
from app.agents.arabic_ner import get_arabic_ner_pipeline
try:
    get_arabic_ner_pipeline()
    raise SystemExit("Should have raised NotImplementedError")
except NotImplementedError as e:
    assert "extract_arabic_entities" in str(e)
print("   OK -- raises with a clear explanation, not a silent no-op")

print("\nALL ARABIC NER CHECKS PASSED.")
