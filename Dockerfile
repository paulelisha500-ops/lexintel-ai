# All-in-one image: the whole platform in one container, for a single server or
# a Hugging Face Docker Space (docker-compose.yml is the multi-container setup). One container runs everything: nginx on 7860 serves the built
# frontend and proxies /api to the API, and Postgres, MongoDB, Redis and Ollama
# run beside it on 127.0.0.1. Elasticsearch, Neo4j and the Celery worker are
# switched off; the app falls back to its built-in search, relationship view
# and in-process jobs. See deploy/docker/start.sh.

# --- Frontend: static build, same-origin API ---
FROM node:22-bookworm-slim AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
ENV VITE_API_BASE_URL=/api/v1
RUN npm run build

# --- Ollama binary without the GPU libraries (CPU-only Space) ---
FROM ollama/ollama:latest AS ollama
RUN rm -rf /usr/lib/ollama/cuda* /usr/lib/ollama/rocm* /usr/lib/ollama/vulkan*

# --- Runtime ---
FROM python:3.11-slim-bookworm

RUN apt-get update && apt-get install -y --no-install-recommends \
        tesseract-ocr tesseract-ocr-ara libgl1 libglib2.0-0 poppler-utils \
        postgresql redis-server nginx curl gnupg ca-certificates libstdc++6 libgomp1 \
    && curl -fsSL https://www.mongodb.org/static/pgp/server-7.0.asc \
        | gpg --dearmor -o /usr/share/keyrings/mongodb-server-7.0.gpg \
    && echo "deb [ signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] http://repo.mongodb.org/apt/debian bookworm/mongodb-org/7.0 main" \
        > /etc/apt/sources.list.d/mongodb-org-7.0.list \
    && apt-get update && apt-get install -y --no-install-recommends mongodb-org-server \
    && rm -rf /var/lib/apt/lists/*

COPY --from=ollama /usr/bin/ollama /usr/bin/ollama
COPY --from=ollama /usr/lib/ollama /usr/lib/ollama

ENV PIP_DEFAULT_TIMEOUT=120
COPY backend/requirements.txt backend/requirements-extra.txt /tmp/
RUN pip install --no-cache-dir --retries 10 -r /tmp/requirements.txt -r /tmp/requirements-extra.txt

# Bake the models into the image so the Space starts without downloading them.
ENV HF_HOME=/opt/models/hf \
    OLLAMA_MODELS=/opt/models/ollama
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('paraphrase-multilingual-MiniLM-L12-v2')" \
    && python -c "from faster_whisper import WhisperModel; WhisperModel('base', device='cpu', compute_type='int8')" \
    && (ollama serve >/tmp/ollama.log 2>&1 &) \
    && for i in $(seq 1 30); do ollama list >/dev/null 2>&1 && break; sleep 1; done \
    && ollama pull qwen2.5:1.5b-instruct \
    && chmod -R a+rwX /opt/models

# Spaces run the container as uid 1000.
RUN useradd -m -u 1000 user
COPY --chown=user backend/ /app/backend/
COPY --chown=user deploy/docker/ /app/deploy/
COPY --from=web --chown=user /web/dist /app/static
RUN chmod +x /app/deploy/start.sh

USER user
ENV HOME=/home/user \
    ENVIRONMENT=production \
    CORS_ORIGINS=* \
    LLM_PROVIDER=ollama \
    OLLAMA_BASE_URL=http://127.0.0.1:11434 \
    OLLAMA_MODEL=qwen2.5:1.5b-instruct \
    POSTGRES_URL=postgresql://lexintel:lexintel@127.0.0.1:5432/lexintel \
    MONGO_URL=mongodb://127.0.0.1:27017/lexintel \
    REDIS_URL=redis://127.0.0.1:6379/0 \
    ELASTICSEARCH_ENABLED=false \
    NEO4J_ENABLED=false \
    CELERY_ENABLED=false \
    WHISPER_MODEL=base

EXPOSE 7860
CMD ["/app/deploy/start.sh"]
