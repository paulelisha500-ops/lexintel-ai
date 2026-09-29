#!/bin/bash
# Starts every LexIntel service inside the Hugging Face Space container.
#
# Data lives in /data when the Space has persistent storage, otherwise in the
# home directory, which is wiped whenever the Space restarts. The demo
# accounts and records are (re)seeded on every start either way.
set -euo pipefail

if [ -d /data ] && [ -w /data ]; then DATA=/data/lexintel; else DATA=$HOME/data; fi
mkdir -p "$DATA"/{pg,mongo,redis,uploads,faiss,logs} /tmp/nginx
LOGS=$DATA/logs
export UPLOAD_DIR=$DATA/uploads
export FAISS_INDEX_PATH=$DATA/faiss/faiss_uae_law_index
export DEMO_PASSWORD=${DEMO_PASSWORD:-LexIntel@2026}

# Keep one signing key per data directory, so a restart with persistent
# storage doesn't sign everyone out or break complaint tracking codes.
if [ -z "${SECRET_KEY:-}" ]; then
    [ -s "$DATA/secret_key" ] || python -c "import secrets; print(secrets.token_hex(32))" > "$DATA/secret_key"
    export SECRET_KEY=$(cat "$DATA/secret_key")
fi

echo "[start] postgres"
PGBIN=$(ls -d /usr/lib/postgresql/*/bin | head -1)
if [ ! -s "$DATA/pg/PG_VERSION" ]; then
    "$PGBIN/initdb" -D "$DATA/pg" -U lexintel --auth=trust >"$LOGS/initdb.log"
fi
"$PGBIN/pg_ctl" -D "$DATA/pg" -l "$LOGS/postgres.log" -w start \
    -o "-c listen_addresses=127.0.0.1 -k /tmp -c shared_buffers=128MB -c max_connections=60"
"$PGBIN/createdb" -h 127.0.0.1 -U lexintel lexintel 2>/dev/null || true

echo "[start] mongodb"
mongod --dbpath "$DATA/mongo" --bind_ip 127.0.0.1 --wiredTigerCacheSizeGB 0.5 \
    --fork --logpath "$LOGS/mongod.log" >/dev/null

echo "[start] redis"
redis-server --bind 127.0.0.1 --dir "$DATA/redis" --appendonly yes \
    --maxmemory 256mb --maxmemory-policy noeviction --daemonize yes --logfile "$LOGS/redis.log"

echo "[start] ollama"
OLLAMA_HOST=127.0.0.1:11434 OLLAMA_KEEP_ALIVE=10m OLLAMA_NUM_PARALLEL=1 OLLAMA_MAX_LOADED_MODELS=1 \
    ollama serve >"$LOGS/ollama.log" 2>&1 &

echo "[start] api"
cd /app/backend
uvicorn app.main:app --host 127.0.0.1 --port 8005 --proxy-headers --forwarded-allow-ips 127.0.0.1 &
API_PID=$!

echo "[start] nginx on :7860"
nginx -c /app/deploy/nginx.conf -g 'daemon off;' &
NGINX_PID=$!

# Seed the demo once the API answers (it lends the seed its embedding model).
(
    for _ in $(seq 1 120); do
        curl -fs http://127.0.0.1:8005/health >/dev/null 2>&1 && break
        sleep 2
    done
    echo "[start] seeding demo data"
    python -m scripts.seed_demo --refresh && echo "[start] demo data ready" \
        || echo "[start] demo seeding failed (the app still runs)"
) &

# If the API or nginx exits, stop the container so the Space restarts it.
wait -n "$API_PID" "$NGINX_PID"
echo "[start] a core process exited; stopping"
exit 1
