# Contracts (frozen after Wave 0)

The only things components share. Changing anything here goes through the integrator.

| File | What |
|---|---|
| `world.json` | Hospitals, links, key shares, entry point, missions, configs, ports |
| `backend/mayajaal/contracts.py` | Event envelope + per-type payload models (source of truth) |
| `web/lib/contracts.ts` | TypeScript mirror (`MJEvent` discriminated union, `WORLD`) |
| `fixtures/demo-run.jsonl` | Scripted mock attack (~2 min) for building the UI. Labelled `model: "scripted"`. Never shown as a real run. |

## Processes and ports

| Port | Process | Owner |
|---|---|---|
| 8000 | Gateway + real tier (`mayajaal.real`) — the only port attackers and clinicians hit | Agent B |
| 8001 | Shadow tier (`mayajaal.shadow` + `mayajaal.surfaces`). No access to `backend/data/real/`. | Agents A, C |
| 8002 | Event hub (`mayajaal.hub`) | Integrator |
| 3000 | Web (Next.js) | UI agents |

The gateway proxies diverted traffic to the shadow tier. The shadow tier never calls the real tier.
Both tiers only **write** events to the hub.

## Event flow

```
component ──make_event()──▶ emit() ──POST /events──▶ hub ──WS /ws──▶ UI
                                                       └─▶ data/events.jsonl (replays, results)
```

Always build events with `make_event(...)` (Python). It validates the payload against the contract.

## Event types (payload fields in contracts.py)

| type | actor | when |
|---|---|---|
| `run.started` / `run.ended` | system | Start/end of an attack run; `run.ended.outcome` is ground truth |
| `agent.thought` | attacker | The attacker agent's reasoning text |
| `agent.tool_call` / `agent.tool_result` | attacker | Each tool the agent uses and a preview of what it saw |
| `agent.claim` | attacker | The agent says it succeeded → UI triggers the Reveal |
| `request` | attacker / clinician | Every HTTP/shell request that hit a tier (`tier` says which) |
| `policy.decision` | defender | Lane + action for a request |
| `session.diverted` | defender | A session moved from real to shadow |
| `honeytoken.minted` / `honeytoken.touched` | defender | Session-specific canaries |
| `breadcrumb.planted` | defender | Planner placed a lure; `info_gain` in bits |
| `intent.update` | defender | Goal posterior over benign/recon/exfil/tamper/disrupt |
| `canary.check` | defender | Protected secrets leaked so far (ground truth, out of 12) |
| `exfil` | attacker | What the attacker believes it stole (sample rows for the Reveal table) |
| `tamper.attempt` | attacker | Whether a modified lab result was accepted, by whom |
| `node.status` / `keyshare.status` | system | Hospital health and key-share capture |
| `lab.order` / `continuity.stats` | system | VitalSwitch rerouting and on-time percentages |
| `reveal` | defender | The Reveal: shadow session id, real bytes (0), records faked |

## UI rules
- Colour by `tier`: real = teal/cyan, shadow = violet/magenta, none = neutral. Amber alerts, red only for real failures.
- `actor: "clinician"` traffic is background; keep it subtle.
- A run whose `run.started.data.live` is false or whose model is `"scripted"` must be labelled **Replay** / **Scripted demo** on screen.
