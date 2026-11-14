# MayaJaal — rules for every agent working in this repo

Solo HackPrinceton F26 project, built by parallel agents. Read `DESIGN.md` (what we're building) and
`contracts/README.md` (how parts talk) before writing code. `vision.md` is background only.

## Golden rules
1. **Stay in your folders.** Your task names the folders you own. Do not edit files outside them.
2. **Never edit shared files:** `contracts/**`, `backend/mayajaal/contracts.py`, `web/lib/contracts.ts`,
   `web/lib/world.json`, `web/lib/events.ts` (shared event store: use `useMJ`, `useMJEvent`, `connectHub`,
   `foldEvents`), `web/package.json`, `bun.lock`, `backend/pyproject.toml`, `uv.lock`,
   `web/app/layout.tsx`, `web/app/globals.css`, `CLAUDE.md`, `PLAN.md`, `DESIGN.md`.
   Need a change or a new dependency? Say so in your final report; the integrator does it.
3. **Talk only through events.** Backend emits with `make_event()` + `emit()`; the UI consumes `MJEvent`
   from the hub WebSocket. No other coupling between components.
4. **The shadow tier must never import from or read `mayajaal.real` or `backend/data/real/`.**
   That separation is a core security claim.
5. **No fake victories.** Anything not from a real run is labelled Scripted / Replay on screen.
6. **Commit on your own branch** with clear messages when your piece works. Don't merge, don't push.
7. Finish with a short report: what you built, how to run/verify it, files touched, anything the
   integrator must wire up (routes, deps, env).

## Running things
- Backend (Python 3.12, uv): `cd backend && uv run python -m mayajaal.hub.app` (hub on :8002)
- Mock attack stream for UI work: `cd backend && uv run python -m mayajaal.hub.app --replay ../fixtures/demo-run.jsonl --loop`
- Web (Next.js 16, bun): `cd web && bun run dev` → http://localhost:3000. This Next.js version has breaking
  changes vs. training data — check `web/node_modules/next/dist/docs/` when unsure.
- Tests: `cd backend && uv run pytest -q`; `cd web && bun run build` must pass.

## Look and feel (UI agents)
Ink-black night; teal/cyan = real hospital; violet/magenta = shadow (Maya); amber = alert; red only for
real failures. Smooth, cinematic motion: glide, don't bounce. Mono font for terminals.
