"""
Offence mentions and legal references in case documents (Module 2).

Two deterministic passes replace free-form "charge extraction" by a
generative model (which, at the size that fits this server, invents charges):

1. Legal references: article/law citations that are literally written in
   the text ("Article 399 of the Penal Code", "المادة (43) من المرسوم بقانون
   اتحادي رقم 33 لسنة 2021"), found with patterns. Nothing is inferred.
2. Offence mentions: which sentences talk about theft, fraud, assault, ...
   by meaning, in Arabic or English, each with the sentence as evidence.

These are reading aids that point a lawyer to the relevant passages. They
are not charges and say nothing about whether any offence happened.
"""

from __future__ import annotations

import re

import numpy as np

from app.ai import embeddings
from app.ai.text import split_sentences

# Each offence carries phrasings a real document might use (Arabic and
# English) plus the words that must actually appear for a mid-confidence
# match to count. Measured on real-shaped case documents: plainly worded acts
# score 0.59-0.73, while unrelated legal prose reaches 0.51 on its own -- so
# meaning alone can't separate them and a lexical anchor is required in the
# middle band. See tests/test_ai_models.py.
OFFENCES: dict[str, dict] = {
    "theft": {"en": "Theft", "ar": "سرقة", "describe": [
        "someone stole property or took belongings without permission",
        "a robbery or burglary of a home, car, shop or warehouse",
        "he took the phone, laptop and cash that belonged to the victim",
        "the lock was cut and goods were missing from the store in the morning",
        "laptops and phones were taken from the display area of the shop",
        "سرق شخص ممتلكات أو أخذ أغراضاً دون إذن", "سطو أو سرقة من منزل أو سيارة أو محل أو مستودع",
        "أخذ المتهم الهاتف والنقود المملوكة للمجني عليه",
        "كُسر القفل وفُقدت البضائع من المخزن"],
        "words": ["stole", "stolen", "theft", "took", "taken", "missing", "burglar", "robbery", "shoplift",
                  "سرق", "سرقة", "سطو", "مسروق", "فقد", "اختفت"]},
    "fraud": {"en": "Fraud / deception", "ar": "احتيال", "describe": [
        "obtaining money by deceiving the victim with false promises or a fake identity",
        "a scam where the victim paid for something that was never delivered",
        "a fake message or website tricked the victim into giving card details or a one-time password",
        "the victim was deceived into transferring money to an account controlled by the sender",
        "الاستيلاء على المال بالخداع أو بوعود كاذبة أو بانتحال صفة",
        "عملية نصب دفع فيها الضحية مالاً مقابل شيء لم يسلم",
        "رسالة أو صفحة مزيفة خدعت الضحية للحصول على بيانات البطاقة أو رمز التحقق",
        "I opened the link in the message and entered my card number and the code that arrived by SMS, then money left my account",
        "فتحت الرابط في الرسالة وأدخلت رقم بطاقتي ورمز التحقق ثم خرج المال من حسابي"],
        "words": ["fraud", "scam", "deceiv", "fake", "phishing", "impersonat", "one-time password", "otp", "tricked",
                  "card number", "verification code", "opened the link", "clicked the link",
                  "احتيال", "نصب", "خداع", "مزيف", "انتحال", "تصيد", "رمز التحقق", "رقم البطاقة"]},
    "breach_of_trust": {"en": "Breach of trust", "ar": "خيانة الأمانة", "describe": [
        "money or property entrusted to a person was kept or misused by them",
        "استولى شخص على مال أو منقول سلم إليه على سبيل الأمانة"],
        "words": ["entrust", "breach of trust", "safekeeping", "أمانة", "عهدة"]},
    "embezzlement": {"en": "Embezzlement", "ar": "اختلاس", "describe": [
        "an employee took company or public funds that were under their control",
        "اختلس موظف أموالاً عامة أو أموال الشركة التي في عهدته"],
        "words": ["embezzl", "public funds", "company funds", "petty cash", "اختلاس", "المال العام"]},
    "assault": {"en": "Assault / bodily harm", "ar": "اعتداء وإيذاء", "describe": [
        "a person was hit, beaten or physically attacked and injured",
        "he punched the victim in the face and caused a broken nose",
        "تعرض شخص للضرب أو الاعتداء الجسدي وأصيب بجروح"],
        "words": ["assault", "punch", "beat", "attack", "injur", "wound", "struck the victim",
                  "اعتداء", "ضرب", "إصابة", "جرح", "لكم"]},
    "threat": {"en": "Threats", "ar": "تهديد", "describe": [
        "a person threatened to kill or harm someone",
        "هدد شخص غيره بالقتل أو بإلحاق الأذى به"],
        "words": ["threat", "threaten", "تهديد", "هدد", "يهدد"]},
    "insult_defamation": {"en": "Insult / defamation", "ar": "سب وقذف", "describe": [
        "insulting or defaming a person publicly or on social media",
        "سب أو قذف شخص علناً أو عبر وسائل التواصل الاجتماعي"],
        "words": ["insult", "defam", "slander", "libel", "سب", "قذف", "إهانة", "تشهير"]},
    "harassment": {"en": "Harassment", "ar": "تحرش", "describe": [
        "sexual harassment or repeated unwanted advances towards a person",
        "تحرش جنسي أو ملاحقة شخص بأفعال أو أقوال غير مرغوب فيها"],
        "words": ["harass", "stalk", "unwanted advances", "تحرش", "ملاحقة", "مضايقة"]},
    "forgery": {"en": "Forgery", "ar": "تزوير", "describe": [
        "a document, signature or official paper was forged or falsified",
        "تزوير مستند أو توقيع أو محرر رسمي"],
        "words": ["forg", "falsif", "counterfeit", "fake signature", "تزوير", "مزور"]},
    "bribery": {"en": "Bribery", "ar": "رشوة", "describe": [
        "offering or accepting money to influence an official's decision",
        "عرض أو قبول مبلغ مالي للتأثير على قرار موظف"],
        "words": ["bribe", "bribery", "kickback", "رشوة", "رشا"]},
    "dishonoured_cheque": {"en": "Dishonoured cheque", "ar": "شيك بدون رصيد", "describe": [
        "a cheque bounced because the account had insufficient funds",
        "رجع الشيك لعدم وجود رصيد كاف في الحساب"],
        "words": ["cheque", "check bounced", "insufficient funds", "شيك", "رصيد"]},
    "money_laundering": {"en": "Money laundering", "ar": "غسل الأموال", "describe": [
        "moving or hiding the source of illegally obtained money through transfers",
        "إخفاء مصدر أموال غير مشروعة أو تحويلها عبر حسابات"],
        "words": ["launder", "proceeds of crime", "hide the source", "غسل الأموال", "غسيل أموال"]},
    "drugs": {"en": "Narcotics", "ar": "مخدرات", "describe": [
        "possession, use or selling of drugs or narcotic substances",
        "حيازة أو تعاطي أو بيع مواد مخدرة"],
        "words": ["drug", "narcotic", "cannabis", "cocaine", "hashish", "مخدر", "مخدرات", "تعاطي"]},
    "cyber_intrusion": {"en": "Hacking / unauthorised access", "ar": "اختراق إلكتروني", "describe": [
        "an account, phone or computer system was hacked or accessed without authorisation",
        "اختراق حساب أو هاتف أو نظام إلكتروني دون تصريح"],
        "words": ["hack", "unauthorised access", "unauthorized access", "breached the account", "logged into my account",
                  "اختراق", "اخترق", "دخول غير مصرح"]},
    "online_blackmail": {"en": "Online blackmail", "ar": "ابتزاز إلكتروني", "describe": [
        "threatening to publish private photos or information online unless paid",
        "التهديد بنشر صور أو معلومات خاصة عبر الإنترنت مقابل المال"],
        "words": ["blackmail", "extort", "publish my photos", "publish the photos", "unless i pay", "unless i paid",
                  "ابتزاز", "ينشر صوري", "بنشر الصور"]},
    "property_damage": {"en": "Damage to property", "ar": "إتلاف ممتلكات", "describe": [
        "someone deliberately damaged or destroyed a car, house or other property",
        "أتلف شخص عمداً سيارة أو منزلاً أو ممتلكات للغير"],
        "words": ["vandal", "destroyed", "smashed", "broke the window", "damaged deliberately",
                  "إتلاف", "أتلف", "تخريب"]},
    "trespass": {"en": "Trespass", "ar": "انتهاك حرمة مسكن", "describe": [
        "entering a home or private property without permission",
        "دخول مسكن أو ملكية خاصة دون إذن صاحبها"],
        "words": ["without permission", "trespass", "broke into", "entered the apartment", "entered the house",
                  "دون إذن", "بغير إذن", "اقتحم", "انتهاك حرمة"]},
    "reckless_driving": {"en": "Dangerous driving", "ar": "قيادة متهورة", "describe": [
        "driving recklessly, racing or driving under the influence and endangering others",
        "القيادة بتهور أو تحت تأثير الكحول بشكل يعرض الآخرين للخطر"],
        "words": ["reckless", "dangerous driving", "speeding", "racing", "under the influence", "drunk",
                  "تهور", "سرعة زائدة", "تفحيط", "تحت تأثير"]},
    "hit_and_run": {"en": "Leaving the scene of an accident", "ar": "الفرار من موقع الحادث", "describe": [
        "a driver caused an accident and fled the scene without stopping",
        "the driver left the scene of the accident before the police arrived",
        "تسبب سائق في حادث وفر من الموقع دون توقف"],
        "words": ["left the scene", "fled the scene", "hit and run", "did not stop", "must stop immediately",
                  "فر من الموقع", "هرب", "لاذ بالفرار"]},
}

# A mention counts when the meaning match is strong on its own, or fair *and*
# one of the offence's words appears in the document.
_STRONG = 0.60
_SUPPORTED = 0.45
_MAX_SENTENCES = 250

_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")
_LAW_EN = re.compile(
    r"(?:Federal\s+)?(?:Decree[- ]Law|Law|Decree|Cabinet\s+Resolution)\s+No\.?\s*\(?(\d{1,4})\)?\s+of\s+(\d{4})"
    r"(?:\s+(?:on|concerning|regarding)\s+(?:the\s+)?([A-Z][A-Za-z ,'&-]{3,80}))?", re.IGNORECASE)
_ARTICLE_EN = re.compile(
    r"\b(?:Article|Art\.)\s*\(?(\d{1,4})\)?(?:\s*(?:\(\d+\)|bis))?"
    r"(?:\s+of\s+(?:the\s+)?((?:[A-Z][A-Za-z-]+\s+){0,5}(?:Code|Law|Decree-Law)))?")
_LAW_AR = re.compile(r"(?:مرسوم\s+بقانون|المرسوم\s+بقانون|القانون|قانون|المرسوم|قرار\s+مجلس\s+الوزراء)\s+"
                     r"(?:(?:ال)?اتحادي\s+)?رقم\s*\(?\s*([0-9٠-٩]{1,4})\s*\)?\s+لسنة\s+([0-9٠-٩]{4})")
_ARTICLE_AR = re.compile(r"المادة\s*\(?\s*([0-9٠-٩]{1,4})\s*\)?")


def legal_references(text: str, limit: int = 40) -> list[dict]:
    """Laws and articles explicitly cited in the text, each with its surrounding words."""
    found: dict[str, dict] = {}

    def add(kind: str, label: str, match: re.Match) -> None:
        key = f"{kind}:{label.lower()}"
        if key in found or len(found) >= limit:
            return
        start, end = max(match.start() - 70, 0), min(match.end() + 70, len(text))
        found[key] = {"kind": kind, "reference": label, "context": " ".join(text[start:end].split())}

    for m in _LAW_EN.finditer(text):
        name = f" on {m.group(3).strip()}" if m.group(3) else ""
        add("law", f"Law No. {m.group(1)} of {m.group(2)}{name}", m)
    for m in _LAW_AR.finditer(text):
        add("law", f"رقم {m.group(1).translate(_DIGITS)} لسنة {m.group(2).translate(_DIGITS)}", m)
    for m in _ARTICLE_EN.finditer(text):
        of = f" of the {m.group(2).strip()}" if m.group(2) else ""
        add("article", f"Article {m.group(1)}{of}", m)
    for m in _ARTICLE_AR.finditer(text):
        add("article", f"المادة {m.group(1).translate(_DIGITS)}", m)
    return list(found.values())


def _has_word(haystack: str, key: str) -> bool:
    return any(word in haystack for word in OFFENCES[key]["words"])


def offence_mentions(text: str, limit: int = 6) -> dict:
    """{"mentions": [{offence, label_en, label_ar, sentence, score, support}], "method"}."""
    sentences = split_sentences(text, limit=_MAX_SENTENCES)
    if not sentences:
        return {"mentions": [], "method": "none"}
    keys, descriptions = [], []
    for key, spec in OFFENCES.items():
        for d in spec["describe"]:
            keys.append(key)
            descriptions.append(d)
    try:
        desc_vectors = embeddings.embed(descriptions)
        sent_vectors = embeddings.embed(sentences)
    except embeddings.ModelUnavailable:
        return {"mentions": [], "method": "unavailable"}

    lowered = text.lower()
    sims = sent_vectors @ desc_vectors.T          # (sentences, descriptions)
    columns: dict[str, list[int]] = {}
    for d_idx, key in enumerate(keys):
        columns.setdefault(key, []).append(d_idx)
    # Per offence: the best-matching sentence, scored across all its phrasings.
    per_offence = {key: sims[:, cols].max(axis=1) for key, cols in columns.items()}
    best = {key: (float(scores.max()), int(np.argmax(scores))) for key, scores in per_offence.items()}

    mentions = []
    for key, (score, s_idx) in sorted(best.items(), key=lambda kv: kv[1][0], reverse=True):
        supported = _has_word(lowered, key)
        if score < _SUPPORTED or (score < _STRONG and not supported):
            continue
        # Quote a sentence that uses the offence's own words where there is one.
        if not _has_word(sentences[s_idx].lower(), key):
            scores = per_offence[key]
            candidates = [i for i, sentence in enumerate(sentences) if _has_word(sentence.lower(), key)]
            if candidates:
                s_idx = max(candidates, key=lambda i: scores[i])
        mentions.append({"offence": key, "label_en": OFFENCES[key]["en"], "label_ar": OFFENCES[key]["ar"],
                         "sentence": sentences[s_idx], "score": round(score, 2),
                         "support": "wording+meaning" if supported else "meaning"})
        if len(mentions) >= limit:
            break
    return {"mentions": mentions, "method": "semantic"}
