"""
Document processing (Module 3 / Module 9): text extraction + OCR for evidence
and law PDFs, and signature verification for documents.

  - Text extraction: embedded text layer first (fast, exact); page-by-page
    Tesseract OCR (eng+ara) only for pages without one (scans, photos).
  - Signature check: is a signature present, and how closely does it match a
    reference on file? Document authentication -- the same category of check a
    bank runs on a signed form -- never a judgment about the signer's honesty.

Nothing here analyzes a person's face, expression, or emotional state.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Optional

import numpy as np

from app.core.config import get_settings
from app.models.schemas import SignatureCheckResult

log = logging.getLogger("lexintel.documents")

IMAGE_EXTENSIONS = {"png", "jpg", "jpeg", "tif", "tiff", "bmp", "webp", "gif"}
TEXT_EXTENSIONS = {"txt", "md", "csv", "json"}
AUDIO_VIDEO_EXTENSIONS = {"mp3", "wav", "m4a", "ogg", "oga", "webm", "mp4", "mov", "mkv", "aac", "flac", "3gp"}


@dataclass
class OcrResult:
    text: str
    mean_confidence: float
    language: str


@dataclass
class ExtractedText:
    text: str
    pages: list[str] = field(default_factory=list)
    method: str = "none"                 # text_layer | ocr | mixed | plain | none
    mean_confidence: Optional[float] = None
    page_count: int = 0
    warnings: list[str] = field(default_factory=list)


def _ocr_image(image, lang: str = "eng+ara") -> OcrResult:
    import pytesseract

    data = pytesseract.image_to_data(image, lang=lang, output_type=pytesseract.Output.DICT)
    words = [w for w in data["text"] if w.strip()]
    confidences = []
    for c, w in zip(data["conf"], data["text"]):
        try:
            value = float(c)
        except (TypeError, ValueError):
            continue
        if w.strip() and value >= 0:
            confidences.append(value)
    mean_conf = (sum(confidences) / len(confidences) / 100) if confidences else 0.0
    return OcrResult(text=" ".join(words), mean_confidence=round(mean_conf, 3), language=lang)


def run_ocr(image_path: str, lang: str = "eng+ara") -> OcrResult:
    from PIL import Image

    with Image.open(image_path) as image:
        return _ocr_image(image.convert("RGB"), lang=lang)


def extract_text(path: str, extension: str) -> ExtractedText:
    """Never raises for a readable file of an unsupported type: returns method='none'."""
    ext = extension.lower().lstrip(".")
    settings = get_settings()

    if ext in TEXT_EXTENSIONS:
        raw = Path(path).read_bytes()
        for encoding in ("utf-8", "utf-16", "cp1256", "latin-1"):
            try:
                text = raw.decode(encoding)
                break
            except UnicodeDecodeError:
                continue
        return ExtractedText(text=text, pages=[text], method="plain", page_count=1)

    if ext in IMAGE_EXTENSIONS:
        result = run_ocr(path)
        return ExtractedText(text=result.text, pages=[result.text], method="ocr",
                             mean_confidence=result.mean_confidence, page_count=1)

    if ext == "pdf":
        from pypdf import PdfReader

        reader = PdfReader(path)
        page_texts: list[str] = []
        for page in reader.pages:
            try:
                page_texts.append(page.extract_text() or "")
            except Exception:
                page_texts.append("")
        page_count = len(page_texts)
        warnings: list[str] = []
        needs_ocr = [i for i, t in enumerate(page_texts) if len(t.strip()) < 40]
        confidences: list[float] = []
        if needs_ocr:
            limit = settings.max_ocr_pages
            if len(needs_ocr) > limit:
                warnings.append(f"Only the first {limit} scanned pages were OCR'd ({len(needs_ocr)} need it).")
                needs_ocr = needs_ocr[:limit]
            try:
                from pdf2image import convert_from_path

                for index in needs_ocr:
                    images = convert_from_path(path, dpi=200, first_page=index + 1, last_page=index + 1)
                    if images:
                        result = _ocr_image(images[0])
                        page_texts[index] = result.text
                        confidences.append(result.mean_confidence)
            except Exception as exc:
                warnings.append(f"OCR of scanned pages failed: {type(exc).__name__}")
        text = "\n\n".join(t for t in page_texts if t.strip())
        if needs_ocr and len(needs_ocr) == page_count:
            method = "ocr"
        elif needs_ocr:
            method = "mixed"
        else:
            method = "text_layer"
        return ExtractedText(
            text=text, pages=page_texts, method=method, page_count=page_count, warnings=warnings,
            mean_confidence=round(sum(confidences) / len(confidences), 3) if confidences else None,
        )

    return ExtractedText(text="", method="none", warnings=[f"No text extraction for .{ext} files."])


# ---------------------------------------------------------------------------
# Signature detection + matching (document authentication)
# ---------------------------------------------------------------------------

def _load_grayscale(path: str) -> np.ndarray:
    import cv2

    if path.lower().endswith(".pdf"):
        from pdf2image import convert_from_path

        pages = convert_from_path(path, dpi=150, first_page=1, last_page=1)
        if not pages:
            raise FileNotFoundError(f"Could not render PDF: {path}")
        # Signatures are usually on the last page; fall back to the first if rendering fails.
        try:
            from pypdf import PdfReader

            last = len(PdfReader(path).pages)
            if last > 1:
                pages = convert_from_path(path, dpi=150, first_page=last, last_page=last) or pages
        except Exception:
            pass
        return cv2.cvtColor(np.array(pages[0].convert("RGB")), cv2.COLOR_RGB2GRAY)

    img = cv2.imread(path, cv2.IMREAD_GRAYSCALE)
    if img is None:
        raise FileNotFoundError(f"Could not read image: {path}")
    return img


def detect_signature_region(document_image_path: str, signature_zone: Optional[tuple] = None) -> Optional[np.ndarray]:
    import cv2

    img = _load_grayscale(document_image_path)
    if signature_zone:
        x, y, w, h = signature_zone
        return img[y:y + h, x:x + w]

    _, thresh = cv2.threshold(img, 200, 255, cv2.THRESH_BINARY_INV)
    contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None
    candidates = []
    for c in contours:
        x, y, w, h = cv2.boundingRect(c)
        area = w * h
        if area < 500:
            continue
        aspect = w / max(h, 1)
        if 1.5 < aspect < 8:
            candidates.append((area, (x, y, w, h)))
    if not candidates:
        return None
    _, (x, y, w, h) = max(candidates, key=lambda t: t[0])
    return img[y:y + h, x:x + w]


def compare_signatures(candidate: np.ndarray, reference: np.ndarray) -> float:
    import cv2

    candidate = cv2.resize(candidate, (300, 150))
    reference = cv2.resize(reference, (300, 150))
    orb = cv2.ORB_create(nfeatures=500)
    kp1, des1 = orb.detectAndCompute(candidate, None)
    kp2, des2 = orb.detectAndCompute(reference, None)
    if des1 is None or des2 is None or len(kp1) < 4 or len(kp2) < 4:
        return 0.0
    matches = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True).match(des1, des2)
    if not matches:
        return 0.0
    good = [m for m in matches if m.distance < 50]
    return round(min(len(good) / max(len(kp1), len(kp2), 1), 1.0), 3)


def verify_signature(
    document_image_path: str,
    reference_signature_path: Optional[str],
    signature_zone: Optional[tuple] = None,
    match_threshold: float = 0.35,
) -> SignatureCheckResult:
    now = datetime.utcnow()
    region = detect_signature_region(document_image_path, signature_zone)
    if region is None:
        return SignatureCheckResult(
            signature_present=False, flagged_for_human_review=True, checked_at=now,
            explanation="No signature-like ink region was found. A clerk should inspect the original.",
        )
    if reference_signature_path is None:
        return SignatureCheckResult(
            signature_present=True, flagged_for_human_review=False, checked_at=now,
            explanation="A signature-like region is present. No reference signature was supplied, so no match was attempted.",
        )
    score = compare_signatures(region, _load_grayscale(reference_signature_path))
    flagged = score < match_threshold
    return SignatureCheckResult(
        signature_present=True, match_score=score, flagged_for_human_review=flagged, checked_at=now,
        explanation=(
            f"Keypoint similarity to the reference is {score:.2f} (threshold {match_threshold}). "
            + ("Below threshold -- flagged for manual comparison by a clerk." if flagged
               else "Above threshold. This is a similarity score, not proof of authorship.")
        ),
    )
