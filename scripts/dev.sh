#!/usr/bin/env bash
# Start the whole stack locally. Usage: scripts/dev.sh [--mock]
#   --mock   hub replays fixtures/demo-run.jsonl on a loop (no real/shadow tiers)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/backend"
if [[ "${1:-}" == "--mock" ]]; then
  uv run python -m mayajaal.hub.app --replay ../fixtures/demo-run.jsonl --loop &
else
  uv run python -m mayajaal.hub.app &
  # Wired in by the integrator as tiers land:
  # uv run uvicorn mayajaal.real.app:app --port 8000 &
  # uv run uvicorn mayajaal.shadow.app:app --port 8001 &
fi
cd "$ROOT/web" && bun run dev
