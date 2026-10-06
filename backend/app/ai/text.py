"""Bilingual text helpers shared by the task models: sentence splitting and script checks."""

from __future__ import annotations

import re

_ARABIC = re.compile(r"[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]")
_LATIN = re.compile(r"[A-Za-z]")
# Scripts a UAE legal answer should never contain; small multilingual models
# sometimes drift into them mid-sentence.
_FOREIGN_SCRIPT = re.compile(r"[぀-ヿ㐀-䶿一-鿿가-힯Ѐ-ӿ฀-๿]")

# Split after sentence-final punctuation (Latin and Arabic) or at line breaks...
_LINES = re.compile(r"\n+")
_SENTENCE_END = re.compile(r"(?<=[.!?؟۔])\s+")
# ...but not after an abbreviation: "Mr. Omar Farouk", "H.H. Sh. Mohammed", "Law No. 31 of 2021",
# "Art. 5", "e.g. a lease". Titles and initials join a following capital, numbering words a
# following number.
_BEFORE_NAME = re.compile(r"(?:^|[\s(])(?:Mr|Mrs|Ms|Dr|Prof|Hon|Sh|Capt|Lt|Col|Gen|Sgt|[A-Z])\.$")
_BEFORE_NUMBER = re.compile(r"(?:^|[\s(])(?:No|Nos|Art|Arts|Para|Sec|Cl|Vol|Ch|p|pp)\.$", re.IGNORECASE)
_ALWAYS = re.compile(r"(?:^|[\s(])(?:e\.g|i\.e|cf|vs|viz)\.$", re.IGNORECASE)
_NUMBER_START = re.compile(r"^\(?[0-9٠-٩]")
_WS = re.compile(r"[ \t ]+")
_WORD = re.compile(r"[\w؀-ۿ]{3,}", re.UNICODE)

_MAX_SENTENCE = 400
_MIN_SENTENCE = 12

STOPWORDS = {
    "the", "and", "for", "that", "with", "this", "from", "was", "were", "are", "has", "have", "had", "not",
    "but", "his", "her", "their", "they", "them", "which", "who", "been", "will", "shall", "may", "any",
    "all", "such", "its", "into", "upon", "than", "then", "also", "there", "where", "when", "what",
    "في", "من", "على", "إلى", "الى", "عن", "أن", "ان", "التي", "الذي", "هذا", "هذه", "ذلك", "تلك", "كان",
    "كانت", "مع", "أو", "او", "ما", "لا", "قد", "كل", "بعد", "قبل", "عند", "حيث", "وقد", "وفي", "ولا",
}


def arabic_ratio(text: str) -> float:
    ar, lat = len(_ARABIC.findall(text)), len(_LATIN.findall(text))
    return ar / (ar + lat) if ar + lat else 0.0


def language_of(text: str) -> str:
    return "ar" if arabic_ratio(text) >= 0.4 else "en"


def has_foreign_script(text: str) -> bool:
    return bool(_FOREIGN_SCRIPT.search(text))


def _joins(before: str, following: str) -> bool:
    return bool(_ALWAYS.search(before)
                or (_BEFORE_NAME.search(before) and following[:1].isupper())
                or (_BEFORE_NUMBER.search(before) and _NUMBER_START.match(following)))


def _raw_sentences(text: str) -> list[str]:
    """Split at line breaks and after sentence-final punctuation, but not after an abbreviation."""
    out: list[str] = []
    for line in _LINES.split(text):
        current = ""
        for piece in _SENTENCE_END.split(line):
            if current and not _joins(current, piece):
                out.append(current)
                current = piece
            else:
                current = f"{current} {piece}" if current else piece
        if current:
            out.append(current)
    return out


def split_sentences(text: str, limit: int = 600) -> list[str]:
    """Sentences of 12-400 characters; overlong ones are cut at clause boundaries."""
    out: list[str] = []
    for raw in _raw_sentences(text or ""):
        sentence = _WS.sub(" ", raw).strip(" -•*‏‎")
        if len(sentence) < _MIN_SENTENCE:
            continue
        while len(sentence) > _MAX_SENTENCE:
            cut = max(sentence.rfind(sep, 0, _MAX_SENTENCE) for sep in (";", "؛", "،", ",", " "))
            cut = cut if cut > _MAX_SENTENCE // 2 else _MAX_SENTENCE
            out.append(sentence[:cut + 1].strip())
            sentence = sentence[cut + 1:].strip()
        if len(sentence) >= _MIN_SENTENCE:
            out.append(sentence)
        if len(out) >= limit:
            break
    return out[:limit]


_TURN = re.compile(r"^([^:\n]{2,60}):\s+(.+)$")


def dialogue_turns(text: str) -> list[tuple[str, str]] | None:
    """A dialogue as composed at the stand ("Speaker: words" on every line) as
    (speaker, words) turns; None for any other text."""
    lines = [line.strip() for line in (text or "").split("\n") if line.strip()]
    turns = [_TURN.match(line) for line in lines]
    if len(lines) < 2 or not all(turns):
        return None
    return [(m.group(1).strip(), m.group(2)) for m in turns]


def attributed_sentences(text: str, limit: int = 600) -> list[tuple[str, str | None]]:
    """(sentence, speaker) pairs. In a dialogue each sentence keeps its speaker (and the
    "Speaker:" label stays out of the quoted words); any other text has no speaker."""
    turns = dialogue_turns(text)
    if turns is None:
        return [(s, None) for s in split_sentences(text, limit)]
    out: list[tuple[str, str | None]] = []
    for speaker, words in turns:
        out.extend((s, speaker) for s in split_sentences(words, limit))
        if len(out) >= limit:
            break
    return out[:limit]


_LOOP_WORD = re.compile(r"[^\w\s]", re.UNICODE)


def repeats_itself(text: str) -> bool:
    """True when a transcript is stuck in a loop: the same phrase of 5 or more words three times
    back to back. Speech models do this over silence or noise. People repeat themselves too, but
    rarely a long phrase three times running."""
    w = _LOOP_WORD.sub(" ", (text or "").lower()).split()[:5000]
    for size in range(5, 31):
        for i in range(len(w) - 3 * size + 1):
            if w[i:i + size] == w[i + size:i + 2 * size] == w[i + 2 * size:i + 3 * size]:
                return True
    return False


_MD_MARKS = re.compile(r"(\*\*|__|`+|~~)")
_MD_LINE_START = re.compile(r"^\s{0,3}(?:#{1,6}\s+|[-*+]\s+|\d{1,2}[.)]\s+)", re.MULTILINE)


def strip_markdown(text: str) -> str:
    """Small models format answers as markdown even when asked not to; the reader
    gets sentences, not asterisks and bullet numbers."""
    cleaned = _MD_LINE_START.sub("", _MD_MARKS.sub("", text or ""))
    return re.sub(r"\n{3,}", "\n\n", cleaned).strip()


_DIGITS_AR = str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")
_NUMBER = re.compile(r"\d+(?:[:.,/-]\d+)*")
_MONTH = re.compile(r"\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b", re.IGNORECASE)
_MONTH_AR = ("يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر",
             "نوفمبر", "ديسمبر")


# "thirty days" and "30 days" are the same figure; a check that didn't know that
# would flag every correct paraphrase.
_NUMBER_WORDS = {
    "one": "1", "two": "2", "three": "3", "four": "4", "five": "5", "six": "6", "seven": "7", "eight": "8",
    "nine": "9", "ten": "10", "eleven": "11", "twelve": "12", "fifteen": "15", "twenty": "20", "thirty": "30",
    "forty": "40", "fifty": "50", "sixty": "60", "seventy": "70", "eighty": "80", "ninety": "90",
    "hundred": "100", "thousand": "1000",
    "واحد": "1", "اثنين": "2", "ثلاثة": "3", "أربعة": "4", "خمسة": "5", "ستة": "6", "سبعة": "7", "ثمانية": "8",
    "تسعة": "9", "عشرة": "10", "عشرين": "20", "ثلاثين": "30", "أربعين": "40", "خمسين": "50", "ستين": "60",
    "سبعين": "70", "ثمانين": "80", "تسعين": "90", "مئة": "100", "مائة": "100", "ألف": "1000",
}
_WORD_TOKEN = re.compile(r"[A-Za-z؀-ۿ]+")
_AR_PREFIXES = ("و", "ف", "ب", "ل", "ك")


def _without_arabic_prefix(word: str) -> str:
    """Arabic glues conjunctions and prepositions onto words: "وسبعين" is still "seventy".
    Without this, a wrong number written that way slips past the figures check."""
    base = word
    while base[:1] in _AR_PREFIXES and len(base) > 4:
        base = base[1:]
    if base.startswith("ال") and len(base) > 4:
        base = base[2:]
    return base


def figures(text: str) -> set[str]:
    """Dates, times, amounts and other numbers written in a text, normalised
    (Arabic-Indic digits, number words, and the parts of a date or time).
    Used to catch figures a model made up: meaning-matching alone doesn't notice
    that "09:15" became "2:30 PM"."""
    normalised = (text or "").translate(_DIGITS_AR)
    found: set[str] = set()
    for m in _NUMBER.finditer(normalised):
        token = m.group().strip(".,")
        if not token:
            continue
        found.add(token.replace(",", ""))
        for part in re.split(r"[:/.-]", token):       # 03/03/2026 -> 03, 2026; 09:15 -> 09, 15
            if part:
                found.add(part.lstrip("0") or "0")
    for m in _WORD_TOKEN.finditer(normalised):
        word = m.group().lower()
        digit = _NUMBER_WORDS.get(word) or _NUMBER_WORDS.get(_without_arabic_prefix(word))
        if digit:
            found.add(digit)
    found |= {m.group(1).lower()[:3] for m in _MONTH.finditer(normalised)}
    found |= {month for month in _MONTH_AR if month in normalised}
    return {f for f in found if f}


def numeric_figures(text: str) -> set[str]:
    """Just the numeric figures (month names left out: "3 March" and "03/03" are the same date)."""
    return {f for f in figures(text) if f[:1].isdigit()}


def content_words(text: str) -> list[str]:
    return [w for w in _WORD.findall((text or "").lower()) if w not in STOPWORDS]


def word_overlap(a: str, b: str) -> float:
    """Share of `a`'s content words that also appear in `b` (0-1)."""
    wa, wb = set(content_words(a)), set(content_words(b))
    return len(wa & wb) / len(wa) if wa else 0.0
