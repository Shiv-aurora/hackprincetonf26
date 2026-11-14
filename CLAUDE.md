# MayaJaal — rules for every agent working in this repo

Solo HackPrinceton F26 project, built by parallel agents. Read `DESIGN.md` (what we're building) and
`contracts/README.md` (how parts talk) before writing code. `vision.md` is background only.

## Golden rules
1. **Stay in your folders.** Your task names the folders you own. Do not edit files outside them.
2. **Never edit shared files:** `contracts/**`, `backend/mayajaal/contracts.py`, `backend/mayajaal/world_api.py`, `backend/mayajaal/hub/**`, `web/lib/contracts.ts`,
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

## Look and feel (UI agents) — Vercel/Geist monochrome, minimal
- Use the tokens in `web/app/globals.css` and the primitives in `web/components/ui` (Logo, SiteHeader, Button,
  ButtonLink, Card, Badge, Dot, Stat, Label, Kbd, cn). Light and dark both work via the system setting.
- Neutral greys, white/near-black backgrounds, 1px hairline borders, rounded-md/lg, Geist Sans + Geist Mono.
- **No** glow, neon, gradients, blur, bloom, particles, 3D, scan lines or "hacker" styling. Generous whitespace.
- Real tier = plain neutral text. Shadow tier = the one accent (`text-shadow`, `bg-shadow-bg`), used sparingly.
  Amber (`alert`) for warnings. Red (`danger`) ONLY when a protected secret actually leaked or a real failure.
- Motion: short, subtle fades/slides (150–250 ms). Nothing bounces, nothing loops for decoration.
- Typography does the work: clear hierarchy, tabular numbers for stats, sentence case, no ALL-CAPS labels.
- The attacker never has a shell; the product surfaces are the FHIR API and the IT portal over HTTP.
