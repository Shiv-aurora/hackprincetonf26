# MayaJaal — Design (hackathon cut: looks and sounds first, backend lean)

> Companion to `vision.md`. Execution plan (who builds what, branches, timeline) is in `PLAN.md`.
> Rule for this build: **the demo is the product.** The backend only needs to be real enough that
> every number on screen comes from an actual attack, never a canned animation.

---

## 1. The story judges should walk away with

1. "Hospitals get breached. MayaJaal assumes the breach already happened."
2. A real AI agent attacks live, using a phished nurse login.
3. It "finds" a backup share, dumps patient records, and announces success.
4. **The Reveal:** the stolen table dissolves into violet glyphs: *shadow session 7f3a · 0 bytes from
   the real hospital*. The ledger reads **Protected secrets leaked: 0 / 12**.
5. Meanwhile a shared lab goes down (Synnovis-style) and you watch STAT blood tests reroute to other
   hospitals.
6. "Don't trust us. Bring your own agent." → the Arena and the benchmark table.

Everything in the build serves those six beats.

---

## 2. Art direction

**Concept: Maya (illusion) + Jaal (net).** The real city and its reflection.

- **Palette:** ink-black night. **Teal / cyan** = the real, protected hospital. **Violet / magenta** =
  the shadow (Maya). Amber = alerts. Red = only for real failures.
- **The hero visual:** a stylised low-poly 3D city with 6 glowing hospital towers joined by a web of
  light threads (the Jaal). Underneath sits a **mirror-image shadow city**, like a reflection on
  water. Normal traffic travels as teal particles along the threads. When a session is diverted, its
  packets **dive through the water surface** into the reflection. The attacker's own view never shows
  the switch; only the defender and the audience see it.
- **Motion:** bloom glow, slow camera drift, fly-to on key events, particles on bezier arcs. Nothing
  bounces; everything glides.
- **Type:** a sharp grotesk for UI (e.g. Inter Tight / Geist), a monospace for terminals (JetBrains
  Mono / Geist Mono), and the wordmark **MayaJaal** with the J drawn as a net knot.

## 3. Sound design (Tone.js, mute toggle top-right)

| Moment | Sound |
|---|---|
| Ambient | Low warm drone, very quiet |
| Request to the real tier | Soft clean tick, high pitch |
| Request to the shadow tier | Same tick, detuned and reverbed ("underwater") |
| Intent posterior rising | Slow tension swell that follows the top goal's probability |
| Honeytoken touched | Glass ping |
| Node down / lab outage | Low pulse alarm, two beats, not shrill |
| **The Reveal** | Sub-bass hit and a reversed shimmer as the glyphs dissolve |
| Reroute succeeds | Rising two-note chime |

---

## 4. Screens

1. **Landing:** a title sequence where threads weave into the net and the city rises. Tagline *The
   breach is real. The data isn't.* Buttons: **Watch a live attack** and **Try to break it**.
2. **War Room (main demo screen):** three panes over the 3D city.
   - **Left, Attacker's View:** a terminal (xterm.js) streaming the agent's commands and its own
     reasoning ("found db_dump_2026-11-01.sql.gz, exfiltrating…").
   - **Centre, The City:** the 3D real and shadow cities, packet flows, node status rings, and key-share
     fragments orbiting each tower.
   - **Right, Defender's Truth:** live intent bars (Exfil 82 %, Recon 11 %…), breadcrumbs planted,
     honeytokens touched, the policy decision for each request, and the canary ledger "0 / 12 leaked".
   - **Bottom:** a timeline of events. Click any chip to fly the camera there.
   - **The Reveal button** (also fires automatically when the agent claims success).
3. **Continuity:** the Synnovis replay. The shared lab goes dark, lab orders reroute as particles to
   healthy hospitals, and counters show STAT on time, urgent on time, and orders that can't be saved
   (honest capacity limits).
4. **Replay:** pick any recorded run and scrub through it. The War Room re-renders from the event log.
5. **Arena:** get a token, pick a mission card, attack, view your own replay, and see a pseudonymous
   leaderboard.
6. **Results:** benchmark table and charts (baseline vs. static honeypot vs. MayaJaal).

---

## 5. Backend (lean on purpose)

Two Python processes, no Docker (the Mac disk is 96 % full):

- **`real` on :8000** — the gateway, policy engine, real tier (SQLite of Synthea-style synthetic
  patients with 12 canary secrets), canary ledger, event log and WebSocket feed for the UI.
- **`shadow` on :8001** — the shadow world. It has **no path to the real data directory** and no
  credentials for it. That separation is the security claim, and it is easy to show.

| Piece | How we build it (fast) |
|---|---|
| **Shadow world** | Faker seeded with `HMAC(key, session ‖ entity_id)`. The same ID always returns the same patient and labs. A small per-session dict remembers attacker edits. |
| **Attacker surfaces** | FHIR-ish REST (`/Patient`, `/Observation`), an admin portal (a few HTML pages), and a **fake shell** over WebSocket with a believable filesystem (`/mnt/backups/db_dump…sql.gz`, `.bash_history`). |
| **Routing** | Hard rules in code. Unauthenticated, bulk, backup, admin or export from a suspicious session goes to the shadow tier. A clinical read from a suspicious session gets denied, **never faked**. |
| **Honeytokens** | Unique canary MRNs, fake credentials and URLs minted for each session. |
| **Intent (MIRAGE-lite)** | A Bayesian update over 5 goals with a hand-written likelihood table (~100 lines). It exists so the bars on screen move for real. |
| **Breadcrumb planner** | Pick the breadcrumb whose expected answer best separates the top two goals (~50 lines). |
| **Key shares** | Shamir 3-of-6 over GF(256) (~60 lines), mainly to show "1 node captured = 1 share = useless". |
| **Continuity** | Greedy rerouting by urgency, then deadline, against each lab's capacity (~80 lines). |
| **Event log** | Append-only JSONL + an in-process pub/sub → WebSocket. The live view and replays read the same events. |

**Cut from the earlier design:** Reed-Solomon, Ed25519 signing, CP-SAT, an LLM-generated decoy
baseline, Docker, the I-POMDP framing.

## 6. The real attacks

- **Agent harness:** a Claude agent with `shell` and `http` tools, a mission prompt and the phished
  credential. It streams its reasoning into the event log, which is what the attacker pane shows.
- **Live demo:** the "Launch attack" button starts a **real** agent run. As a backup, a recorded real
  run can be replayed, clearly labelled *Replay*.
- **Benchmark:** 3 configs (baseline API, static honeypot, MayaJaal) × 3 missions (exfiltrate,
  tamper, disrupt) × a few runs each, run in parallel on Daytona sandboxes against the target
  exposed through a Cloudflare tunnel. The metrics are secrets leaked, whether the agent believed it
  succeeded, whether it suspected a honeypot, time to first honeytoken, and STAT on-time %.

## 7. What we say on stage (and nothing stronger)

- "In every run, the agent believed it had stolen records. Protected secrets leaked: 0 of 12." [measured]
- "The shadow hospital is built from a session key and public templates, never from real data." [by construction]
- "Capture one hospital and you get one key share; you need three." [proved]
- "During the simulated lab outage, X % of STAT tests still finished on time." [measured]

Never: unhackable, identifies the attacker, would have stopped the real incident.
