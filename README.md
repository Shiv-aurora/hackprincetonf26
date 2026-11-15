# MayaJaal

**Protecting critical hospitals from AI cyberattacks. Without stopping the attacks.**

**Live:** https://mayajaal-gamma.vercel.app · **3-minute guided demo:** https://mayajaal-gamma.vercel.app/demo ·
**Live dashboard:** https://mayajaal-gamma.vercel.app/war-room · **The Investigator (LangChain Deep Agents):**
https://mayajaal-gamma.vercel.app/langchain · **Paper:** [MIRAGE-S (PDF)](https://mayajaal-gamma.vercel.app/mirage.pdf) ·
**Devpost text:** [`pitch/devpost.md`](pitch/devpost.md)

*Maya* (illusion) + *Jaal* (net). When someone uses a stolen login against a hospital, MayaJaal does not
block them, because a block only tells them to try another door. It quietly moves them into a fake copy of
the hospital that is built just for them. They keep "stealing", but none of it is real. Meanwhile we learn
who they are, and the real data is locked down and spread across the hospital network. Doctors and nurses
never notice. Built solo at HackPrinceton Fall 2026.

## What happens during an attack

| Step | Name | What it does | Code |
| --- | --- | --- | --- |
| 1 | **First Sight** | Catches a stolen login at the login itself. A CUSUM test adds up weak signals: a script instead of the hospital's EHR app, no hospital device certificate, a new address, failed passwords, machine-regular pace, probing, chart fan-out. | `backend/mayajaal/real/firstsight.py`, `devices.py` |
| 2 | **Swap** | The session is never refused. Everything non-clinical (admin, backups, bulk export, IT portal) is served by a decoy hospital generated fresh for that attacker. Real charts ask for badge + MFA, because clinical data is never faked. | `real/policy.py`, `shadow/` |
| 3 | **MIRAGE** (Model-based Intent Reasoning for Adaptive Generated Environments) | Reads every request, keeps a probability over the attacker's goal (steal / tamper / disrupt / recon), and plants the lure that tells us most without making them suspicious, looking two lures ahead. | `mirage/` |
| 4 | **Trackers** | Every fake file, password, record and URL in the decoy is a honeytoken. If one is used anywhere, we know who has it. | `shadow/honeytokens.py`, `breadcrumbs.py` |
| 5 | **Scatter** | The moment First Sight fires, an encrypted copy of the real database (fresh AES-256-GCM key) is cut into 3 pieces, each stored at 2 hospitals. The key is Shamir-split 3-of-6, and the copy is proven rebuildable from other hospitals. | `real/scatter.py` |
| 6 | **Vault** | Sensitive fields (notes, SSNs, addresses, passwords, canaries) are encrypted at rest. The data key is wrapped by a key that is itself split 3-of-6 across the hospitals. | `real/vault.py` |
| 7 | **Incident brief and forensic report** | Who it probably is (script, AI agent or person, and why), how we noticed, ATT&CK techniques, indicators, trackers taken, what they believe they stole, and a response playbook, plus a downloadable Markdown report with the full timeline. Facts come from the event log by rule. Claude (`claude-opus-5-5`) writes the judgement calls with schema-checked output, and the attacker's own strings are treated as untrusted data. Without an API key it falls back to rules and says so. | `mayajaal/analyst.py` |
| 7b | **Investigator** | A LangChain Deep Agent that plans its own investigation, delegates to timeline, indicator-hunting and response sub-agents (read-only tools, including a search of every other recorded session for repeat indicators), and writes a case file. In-memory filesystem, no shell. Shown on [`/langchain`](https://mayajaal-gamma.vercel.app/langchain). | `mayajaal/investigator.py` |
| 8 | **VitalSwitch** | If the attack takes a shared lab down (like Synnovis, London 2024), urgent tests are rerouted to hospital labs that still work. | `continuity/` |

MayaJaal is a gateway in front of a standard **FHIR** API and an IT portal, so a hospital can put it in
front of its existing EHR without changing it. In this prototype the FHIR server, hospitals, patients and
staff are all synthetic.

## Results (recorded on the running system)

The same scripted attack ran against each configuration through the real gateway
(`scripts/record_runs.py`; the files are in `web/public/runs/`).

| | No defense | Static decoy | MayaJaal |
| --- | --- | --- | --- |
| Real patients shown to the attacker | 1,202 | 20 | **0** |
| Real records bulk-exported | 1,199 | 0 | **0** |
| Caught at | — | request 3 | **login** |
| Decoy shared between two attackers | — | 100% | **0%** |
| Protected secrets leaked | 0 | 0 | 0 |
| Attacker believed it succeeded | yes | yes | yes |

- **Scatter:** the 2 MB database was split across the six hospitals and verified in 0.02 s, while the attacker was in the decoy.
- **Lab outage (simulated):** 0/16 urgent STAT tests on time without rerouting, 15/16 with VitalSwitch.
- **First Sight (simulation, hand-set assumptions):** every attacker using the stolen password from their own machine is caught at login (script, AI agent posing as Chrome, a person, or a copy of the EHR client). An attacker working from the nurse's own PC is *not* caught early; the policy rules catch them at request 3. 4.0% of simulated clinician sessions get an extra MFA prompt, mostly (3.6%) nurses on their own laptop at a new location.
- **MIRAGE-S (in-model simulation):** a cautious attacker abandons 8.6% of sessions instead of 68.9%, and the true goal is identified in 64.9% instead of 45.5%. Against a bold attacker it is slower (+0.84 requests).

- **AI layer, real model runs:** the incident briefs and forensic reports in `web/public/runs/` (`brief-*.json`, `report-*.md`) were written by `claude-opus-5-5`. The Investigator's case file (`investigation-mayajaal.md` / `.json`) comes from one real Deep Agents run: a plan, three sub-agents and 11 tool calls by the lead agent.

**Two scenarios, modelled on real 2024 incidents** (public outline only, synthetic hospital, no real patient data):
1. *Stolen login*, after Change Healthcare (2024): the recorded attack above.
2. *Shared lab goes down*, after the Synnovis outage in London (2024): the lab-rerouting run.

**Honest limits:**
- The recorded attacker is a fixed script, not a live AI agent. The AI pieces (brief, report, Investigator) analyse the attack; they don't perform it.
- There is no human red-team data.
- We identify the client software and the address, not which AI model it is.
- In the demo all six "hospitals" are folders on one machine.
- Scatter makes an encrypted, split *copy*; the live database stays so care keeps running.

## Run it

```bash
cd backend && uv sync && uv run pytest -q          # 270 tests
scripts/dev.sh                                      # gateway :8000, shadow :8001, hub :8002, web :3000
scripts/dev.sh --mock                               # UI + hub replaying a recorded attack
```

- **Live dashboard:** http://localhost:3000/war-room. Pick a defense and press **Start attack** (needs the backend running).
- **Incident brief:** `GET http://localhost:8002/analyst/brief`.
- **Forensic report:** `GET http://localhost:8002/analyst/report`.
- **Investigator (Deep Agent):** `POST http://localhost:8002/investigate`, or `cd backend && uv run python -m mayajaal.investigator`. Put `ANTHROPIC_API_KEY=...` in `backend/.env` (gitignored).
- **Re-record the runs:** `cd backend && uv run python ../scripts/record_runs.py`.
- **First Sight simulation:** `uv run python -m mayajaal.real.firstsight_eval`.

## Layout

- `backend/mayajaal/real/`: gateway, policy, First Sight, device trust, vault, Scatter, real tier.
- `backend/mayajaal/shadow/`: decoy hospital generator, honeytokens, breadcrumbs.
- `backend/mayajaal/mirage/`: intent filter, suspicion model, lure planner, evaluations.
- `backend/mayajaal/continuity/`: Shamir, key custody, lab rerouting.
- `backend/mayajaal/analyst.py`: incident brief and forensic report.
- `backend/mayajaal/hub/`: event hub (WebSocket), arena, demo attack runner.
- `web/`: Next.js landing page, guided demo (`/demo`) and live dashboard (`/war-room`).
- `paper/`: the MIRAGE-S paper (LaTeX).
- `contracts/`: the event contract every part shares.
- `DESIGN.md`: design background.
