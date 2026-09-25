"""
Central configuration for LexIntel.

Everything that varies between dev / staging / a real court deployment
lives here, loaded from environment variables (see .env.example).
Nothing about legal outcomes, verdicts, or deception scoring is
configurable here on purpose -- see docs/DESIGN_DECISIONS.md.
"""

from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", protected_namespaces=("settings_",))

    app_name: str = "LexIntel"
    environment: str = "development"
    secret_key: str = "change-me"
    cors_origins: str = "http://localhost:3005"

    # --- Local AI (app/ai/). Everything runs on this server; no cloud AI. ---
    # Writing model (research drafts, case briefs), served by the Ollama
    # container. "none" switches drafting off; every other AI feature keeps
    # working because it uses the small task models below.
    llm_provider: str = "ollama"             # ollama | none
    ollama_base_url: str = "http://ollama:11434"
    ollama_model: str = "qwen2.5:1.5b-instruct"
    ollama_keep_alive: str = "5m"            # unload the writing model after this much idle time
    llm_context_tokens: int = 4096
    # Seconds to wait for the next streamed token (the first one includes
    # loading the model and reading the prompt on CPU).
    llm_timeout_seconds: int = 240
    # Drafts that may wait for the model at once; beyond this, callers get
    # their non-AI result immediately with "the model is busy".
    llm_max_waiting: int = 3
    # Task models (embeddings, speech-to-text) unload after this long unused
    # so an idle system gives memory back.
    model_idle_unload_seconds: int = 600
    embeddings_enabled: bool = True
    # Where other processes get embeddings from, so only ONE process holds the
    # model (~500 MB each). The worker points this at the API; empty = in-process.
    embeddings_url: str = ""

    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 480  # one court shift
    login_max_attempts: int = 5
    login_lockout_minutes: int = 15
    min_password_length: int = 10
    # Emirates ID numbers are stored only as a keyed hash (plus last 4 digits
    # for display). Falls back to secret_key when unset.
    emirates_id_pepper: str = ""

    postgres_url: str = "postgresql://lexintel:lexintel@localhost:5432/lexintel"
    mongo_url: str = "mongodb://localhost:27017/lexintel"
    elasticsearch_url: str = "http://localhost:9200"
    elasticsearch_enabled: bool = True

    neo4j_url: str = "bolt://localhost:7687"
    neo4j_user: str = "neo4j"
    neo4j_password: str = ""
    neo4j_enabled: bool = True

    faiss_index_path: str = "./data/faiss_uae_law_index"
    # Multilingual (Arabic + English). MiniLM needs ~470 MB instead of the
    # ~1.1 GB of paraphrase-multilingual-mpnet-base-v2; changing this later
    # automatically re-indexes the Law Library (see app/tasks.py).
    embedding_model: str = "paraphrase-multilingual-MiniLM-L12-v2"
    spacy_model: str = "en_core_web_sm"
    redis_url: str = "redis://localhost:6379/0"
    celery_enabled: bool = True

    upload_dir: str = "/data/uploads"
    max_document_mb: int = 25
    max_law_pdf_mb: int = 80
    max_recording_mb: int = 600
    max_ocr_pages: int = 40

    whisper_enabled: bool = True
    whisper_model: str = "base"             # tiny | base | small | medium
    whisper_compute_type: str = "int8"

    # How long a dependency's up/down state is cached before re-probing, so a
    # dead service costs one short timeout per window instead of one per request.
    probe_ttl_seconds: int = 20

    public_complaints_per_hour: int = 10

    # Case-prioritization weights (Module 4). These are the ONLY numbers
    # an AI component in this system is allowed to influence directly --
    # a priority label + explanation, never a verdict. Tune per court policy.
    priority_weights: dict = {
        "public_safety_flag": 0.30,
        "days_to_statutory_deadline": 0.25,
        "vulnerable_victim": 0.20,
        "missing_critical_evidence": -0.15,
        "days_case_open": 0.10,
    }


@lru_cache
def get_settings() -> Settings:
    return Settings()
