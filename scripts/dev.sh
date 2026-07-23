#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PYTHON="${ONTOLOGYOPS_PYTHON:-$ROOT/backend/.venv/bin/python}"
RUNTIME_DIR="$ROOT/data/runtime"

if [[ -f "$ROOT/.env" ]]; then
  set -a
  source "$ROOT/.env"
  set +a
fi

cleanup() {
  [[ -n "${BACKEND_PID:-}" ]] && kill "$BACKEND_PID" 2>/dev/null || true
  [[ -n "${FRONTEND_PID:-}" ]] && kill "$FRONTEND_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

mkdir -p "$RUNTIME_DIR"
(cd "$ROOT/backend" && PYTHONPATH="$ROOT/backend" "$PYTHON" -m app.seed.factory_seed --data-dir "$RUNTIME_DIR")

(cd "$ROOT/backend" && ONTOLOGYOPS_DATA_DIR="$RUNTIME_DIR" ONTOLOGYOPS_METADATA_PATH="$RUNTIME_DIR/metadata.db" PYTHONPATH="$ROOT/backend" "$PYTHON" -m uvicorn app.main:app --host 127.0.0.1 --port 8000) &
BACKEND_PID=$!
(cd "$ROOT/frontend" && npm run dev -- --host 127.0.0.1 --port 5173) &
FRONTEND_PID=$!

echo "OntologyOps: http://127.0.0.1:5173"
wait
