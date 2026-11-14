# MayaJaal — Build plan (12 hours, parallel agents)

## How the machine works

- **One integrator (the main Claude session).** It owns `main`, the shared contracts, and all shared
  files. It is the only one who merges.
- **Builder agents** each run in their **own git worktree on their own branch**, own one set of
  folders, and never touch anyone else's. When done, they commit on their branch and report back.
- **Contracts first.** Before anyone builds, the integrator freezes the event schema and a recorded
  mock attack (`fixtures/demo-run.jsonl`). The UI agents build against the mock stream, so they never
  wait for the backend. Integration is mostly swapping the mock feed for the live WebSocket.
- **`main` is always runnable.** After each wave: merge → smoke test → push → tag.

## Git

- Yes, branches. Each agent gets a worktree branch (`wt/<agent>`) made by the Agent tool's worktree
  isolation.
- Merges are `git merge --no-ff wt/<agent>` into `main`, backend branches first, then UI.
- Conflicts are avoided by **folder ownership** (below), plus three rules:
  1. Only the integrator edits `package.json`, lockfiles, `pyproject.toml`, `web/app/layout.tsx`,
     `web/app/war-room/page.tsx` (composition) and `backend/mayajaal/main.py` (route wiring).
  2. All frontend dependencies are installed up front in Wave 0. An agent that needs a new package
     names it in its report instead of installing it.
  3. Contracts (`contracts/`) are frozen after Wave 0. A change goes through the integrator.
- Push to GitHub after every wave. Tags `demo-1`, `demo-2`, `submit`. The timestamped commits also
  show the code was written during the event.

## Folder ownership

```
contracts/                       integrator   event schema, API contract, mission specs
fixtures/                        integrator   recorded mock attack stream
backend/mayajaal/real/           B            gateway, policy, real tier, canary ledger, event log + WS
backend/mayajaal/shadow/         A            seeded shadow world, honeytokens, session overlay
backend/mayajaal/surfaces/       C            fake shell (WS), admin portal pages, FHIR-ish routes
backend/mayajaal/mirage/         H            intent filter + breadcrumb planner
backend/mayajaal/continuity/     I            Shamir shares + lab rerouting + Synnovis scenario
bench/                           G            agent harness, Daytona runner, results JSON
web/components/city/             D            3D real + shadow city, packets, camera
web/components/consoles/         E            attacker terminal, defender panel, timeline, reveal
web/app/(landing)/ web/lib/sound/ web/styles/   F   brand, landing title sequence, sound, design tokens
web/app/{arena,replay,results,continuity}/   J   the other pages
pitch/                           K            deck, demo script, Devpost text, README
```

## Waves (T = hours from kickoff)

### Wave 0 — integrator alone (T+0 → T+1)
- Monorepo scaffold: Next.js app in `web/` (bun), Python package in `backend/` (uv).
- Install every frontend dependency up front: three, @react-three/fiber, drei, postprocessing,
  framer-motion, xterm, recharts, tone, tailwind, shadcn/ui.
- `contracts/events.schema.json` plus generated `web/lib/contracts.ts` and `backend/.../contracts.py`.
- `fixtures/demo-run.jsonl`: a hand-written, realistic 3-minute attack event stream, plus a mock WS
  server that replays it.
- First commit on `main`, push.

### Wave 1 — 6 agents in parallel (T+1 → T+4)
| Agent | Builds | Done when |
|---|---|---|
| **A Shadow** | Seeded world, honeytokens, overlay | Same ID → same patient across 1,000 calls; no import of real/ |
| **B Real + gateway** | Policy lanes, synthetic real tier with 12 canaries, ledger, event log, WS | A curl attack produces the right events on the WS |
| **C Surfaces** | Fake shell with filesystem, admin portal, FHIR routes on the shadow side | An agent can `ls /mnt/backups` and download a believable dump |
| **D City** | The 3D hero: towers, Jaal threads, mirror city, packet particles, bloom, fly-to | Plays the mock stream at 60 fps on the M1 |
| **E Consoles** | Attacker terminal, defender panel, timeline, **the Reveal** | Mock stream drives all three panes; the Reveal looks stunning |
| **F Brand + sound** | Tokens, wordmark, landing title sequence, Tone.js sound engine | Landing plays end to end; sounds fire from mock events |

### Integration 1 (T+4 → T+5) → tag `demo-1`
Wire the live WS into the War Room, run a curl attack end to end, fix seams.

### Wave 2 — 4 agents (T+5 → T+8)
| Agent | Builds |
|---|---|
| **G Bench** | Attacker harness on the **Claude Code CLI** (`claude -p --output-format stream-json`), locked to a `hospital-net` MCP server with only `http_request` + `shell` tools (built-in tools disallowed, empty temp dir). Streams thoughts/tool calls into the hub, a "Launch attack" endpoint, a local runner for 3–5 parallel runs, a static-honeypot config and a baseline config |
| **H Mirage** | Intent filter + breadcrumb planner feeding live events (bars move for real) |
| **I Continuity** | Shamir shares (shown orbiting the towers), lab rerouting, Synnovis scenario events |
| **J Pages** | Continuity, Replay, Arena (token + missions + leaderboard), Results pages |

### Integration 2 (T+8 → T+9) → tag `demo-2`
Live Claude attack from the button. Open a Cloudflare tunnel and **start the benchmark sweep in the
background** (local CLI runs).

### Wave 3 — 3 agents (T+9 → T+11)
| Agent | Builds |
|---|---|
| **K Pitch** | Deck, 2-minute demo script, Devpost write-up, README with honest claims |
| **L Results** | Results page and charts fed by the real benchmark output |
| **M QA + polish** | Performance, sound mix, edge cases, a fallback replay if the network fails, browser checks |

### Freeze (T+11 → T+12) → tag `submit`
Rehearse, record a backup demo video, submit on Devpost.

**Peak parallelism:** 6 agents at once. 13 builder agents over the whole build.

## Compute (from compute-pool/README.md)

| Need | Where | Why |
|---|---|---|
| GPU | **None** | Every model is called through an API; nothing is trained or hosted. |
| Dev servers, UI, the live demo | **This Mac** (M1 Max) | Light. No Docker, because the disk is 96 % full (40 GB free). |
| Benchmark attack runs | **This Mac**, Claude Code CLI on the user's subscription, 3–5 runs at once | No API key or extra cost. Runs after Wave 2 so it doesn't compete with builder agents for rate limits. Can switch to an API key + Daytona later without changing the harness interface. |
| Public endpoint for the Arena | **Cloudflare tunnel** from this Mac | `cloudflared` is installed and free. No AWS needed. |
| MacBook Air | Skip | Not reachable right now. |
| Kaggle / Colab / AWS | Not needed | — |

No API key needed: attacker agents run on the Claude Code CLI. Expect Claude to sometimes refuse
attack missions; the mission prompt states the authorized sandbox scope, and refusals are recorded as results.
