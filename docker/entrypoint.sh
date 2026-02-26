#!/bin/sh
set -eu

MAX_WAIT_SECONDS=600
SLEEP_SECONDS=5
ELAPSED=0

echo "[entrypoint] Waiting for database availability (max ${MAX_WAIT_SECONDS}s)..."

while true; do
  if npm run prisma:migrate:deploy >/dev/null 2>&1; then
    break
  fi

  if [ "$ELAPSED" -ge "$MAX_WAIT_SECONDS" ]; then
    echo "[entrypoint] Database not available after ${MAX_WAIT_SECONDS}s."
    exit 1
  fi

  sleep "$SLEEP_SECONDS"
  ELAPSED=$((ELAPSED + SLEEP_SECONDS))
done

echo "[entrypoint] Database is available."
echo "[entrypoint] Migrations completed."

exec "$@"
