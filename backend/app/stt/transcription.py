"""
Local speech-to-text with faster-whisper (CTranslate2, CPU, int8).

Used for the courtroom stand (short live chunks while someone speaks, then a
full-quality pass over the complete recording) and for audio/video evidence.
Audio never leaves the machine. Arabic and English are auto-detected.

If the package or model isn't available, `available()` is False and callers
keep the clerk-typed transcript path -- nothing breaks.
"""

from __future__ import annotations

import logging
import threading
from typing import Optional

from app.ai.slots import ModelSlot, ModelUnavailable
from app.core.config import get_settings

log = logging.getLogger("lexintel.stt")

_run_lock = threading.Lock()


def _load_whisper():
    from faster_whisper import WhisperModel

    settings = get_settings()
    return WhisperModel(settings.whisper_model, device="cpu", compute_type=settings.whisper_compute_type,
                        cpu_threads=4, num_workers=1)


slot = ModelSlot("speech_to_text", _load_whisper, get_settings().model_idle_unload_seconds,
                 enabled=lambda: get_settings().whisper_enabled,
                 description="Arabic/English speech-to-text (faster-whisper)")


def available() -> bool:
    try:
        import faster_whisper  # noqa: F401
    except Exception:
        return False
    return slot.available()


def status() -> dict:
    s = slot.status()
    return {
        "name": "speech_to_text",
        "available": available(),
        "loaded": s["loaded"],
        "model": get_settings().whisper_model,
        "error": s["error"] or (None if available() or not get_settings().whisper_enabled else "faster-whisper is not installed"),
    }


def warm_up() -> None:
    with slot.use():
        pass


def transcribe_file(path: str, language: Optional[str] = None, live: bool = False) -> dict:
    """Returns {text, language, language_probability, duration, segments}. Raises RuntimeError if STT is unavailable."""
    lang = language if language in ("ar", "en") else None
    try:
        with slot.use() as model, _run_lock:
            segments, info = model.transcribe(
                path,
                language=lang,
                beam_size=1 if live else 5,
                vad_filter=True,
                vad_parameters={"min_silence_duration_ms": 400},
                condition_on_previous_text=not live,
            )
            segment_list = [
                {"start": round(s.start, 2), "end": round(s.end, 2), "text": s.text.strip()}
                for s in segments if s.text.strip()
            ]
    except ModelUnavailable as exc:
        raise RuntimeError(str(exc) or "speech-to-text unavailable") from exc
    return {
        "text": " ".join(s["text"] for s in segment_list).strip(),
        "language": info.language,
        "language_probability": round(float(info.language_probability or 0), 3),
        "duration": round(float(info.duration or 0), 2),
        "segments": segment_list,
    }
