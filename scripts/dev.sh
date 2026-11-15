#!/usr/bin/env bash
# Start the whole stack locally. Usage: scripts/dev.sh [--mock]
#   (default) hub :8002, shadow (decoy) :8001, gateway + real tier :8000, web :3000
#   --mock    hub replays fixtures/demo-run.jsonl on a loop (no real/shadow tiers)
# Gateway, shadow and hub share one random admin key for this run (never printed).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/backend"
trap 'kill 0' EXIT
if [[ "${1:-}" == "--mock" ]]; then
  uv run python -m mayajaal.hub.app --replay ../fixtures/demo-run.jsonl --loop &
else
  export MJ_ADMIN_KEY="${MJ_ADMIN_KEY:-$(python3 -c 'import secrets; print(secrets.token_hex(16))')}"
  uv run python -m mayajaal.hub.app &
  uv run uvicorn mayajaal.shadow_app:app --port 8001 --log-level warning &
  uv run uvicorn mayajaal.real.app:app --port 8000 --log-level warning &
fi
cd "$ROOT/web" && bun run dev
