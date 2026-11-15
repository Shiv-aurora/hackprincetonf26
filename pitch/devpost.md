# MayaJaal — Devpost submission text

**Tagline (one line):** Protecting critical hospitals from AI cyberattacks. Without stopping the attacks.

**Links:** live site https://mayajaal-gamma.vercel.app · guided demo https://mayajaal-gamma.vercel.app/demo ·
paper https://mayajaal-gamma.vercel.app/mirage.pdf · code https://github.com/Shiv-aurora/hackprincetonf26

---

## Inspiration

Hospitals can't switch off when they're attacked. In 2024, Change Healthcare was breached through one
stolen login and US pharmacies and claims stalled for weeks. The same year, a ransomware attack on Synnovis
took down the lab that serves several London hospitals, and urgent blood tests had nowhere to go. AI agents
make this cheaper: an agent with a phished nurse password can enumerate a hospital faster than any person.

The usual answer is to block the intruder. But a block tells them they were seen, and they come back through
another door. We wanted a defense that lets the attack carry on, just not against anything real.

## What it does

MayaJaal is a gateway in front of a hospital's FHIR API and IT portal. When a signed-in session starts acting
like an attacker:

1. **First Sight catches it at login.** A sequential test (CUSUM) adds up weak signals that no single rule
   would act on: a nurse's password used from a script instead of the hospital's EHR app, no hospital device
   certificate, a new address, failed passwords, machine-regular pace.
2. **We swap reality instead of blocking.** Every non-clinical request (admin, backups, bulk export) is
   served by a decoy hospital generated fresh for that attacker. Real patient charts ask for badge + MFA.
   We never fake clinical data, so a nurse flagged by mistake still gets real care data.
3. **MIRAGE learns what they want.** A Bayesian filter tracks the attacker's likely goal on every request, and
   a planner plants the lure (a fake backup, a VPN file, a service password) that tells us most without
   raising their suspicion, two lures ahead. Every fake item is a tracker.
4. **Scatter locks the real data down.** The moment they're caught, an encrypted copy of the real database is
   cut into pieces and spread across the hospital network. The key is split so any three of six hospitals
   are needed. Sensitive fields are already encrypted at rest under a key that is split the same way.
5. **The incident brief and forensic report tell the hospital what to do.** Who it probably is (script, AI
   agent or person, and why), how we noticed, ATT&CK techniques, indicators, which trackers they took, what
   they believe they stole, and a response playbook. It downloads as a forensic report with the full timeline.
6. **VitalSwitch keeps care running.** If the attack takes a shared lab down, urgent tests are rerouted to
   labs that still work.

**Results, recorded on the running system with the same scripted attack under each defense:**
- Real patients shown to the attacker: **1,202 with no defense, 20 with a static decoy, 0 with MayaJaal**.
- Caught **at login**, versus request 3 for static rules.
- Two attackers shared **0%** of their decoy, versus 100% for a static honeypot.
- The attacker reported success every time.
- In a simulated lab outage, **15/16** urgent tests were on time instead of 0/16.

## How we built it

- **Backend** (Python 3.12, FastAPI, uv):
  - the real tier (gateway, policy, First Sight, device trust, vault, Scatter);
  - a separate shadow process that generates the decoy hospital from a per-session HMAC seed (it can never import or read the real tier);
  - the MIRAGE intent filter and lure planner;
  - Shamir secret sharing over GF(256) with AES-256-GCM;
  - an event hub that streams every request, decision and tracker to the UI over WebSocket.
- **Analyst:** the Anthropic Python SDK (`claude-opus-5-5`) with structured outputs, plus a rule-based layer that always runs.
- **Investigator:** a LangChain Deep Agent with three sub-agents and read-only tools over the event log.
- **Frontend:** Next.js 16 + React 19 + Tailwind on Vercel. A guided 3-minute demo plays on top of the real dashboard, replaying recorded runs.
- **Tests:** 267 tests, covering policy rules, gateway behaviour, First Sight, device tokens, vault encryption, Scatter rebuilds, MIRAGE and the analyst.
- **Paper:** a 3-page LaTeX paper on MIRAGE-S, with its numbers generated from the recorded runs.

## Challenges we ran into

- **Never faking clinical data, while still never refusing.** The answer was to divert everything non-clinical and step up authentication on real charts.
- **False alarms.** Our first First Sight version flagged simulated clinicians, because the EHR app bursts and polls. Timing now only counts for browsers and scripts, and the fan-out limit sits above a whole ward.
- **Honesty about what is measured.** Every number on screen comes from a recorded run or is labelled as a simulation.

## Accomplishments we're proud of

- 0 real patients shown to the attacker, on the running system.
- A decoy that is different for every attacker, so publishing one doesn't burn the next.
- Detection at login, plus a response that saves the data before the attacker does anything.

## What we learned

Deception beats blocking when you can't afford downtime. The hard part isn't the fake data. It's deciding,
on every request, what to show next without tipping the attacker off.

## What's next

- Run real AI-agent red teams through the arena; we only report a scripted attacker today.
- Replace the device-token stand-in with mTLS client certificates.
- Real ASN and geolocation signals.
- Put Scatter's pieces on separate hospitals' storage instead of one machine.
- A pilot in front of a real FHIR sandbox.

## Built with

python, fastapi, uv, pydantic, cryptography, anthropic, claude, langchain, deep-agents, langgraph, next.js, react, typescript, tailwind, bun,
vercel, fhir, latex

---

## Sponsor tracks

### Arlequin AI — AI-driven forensics

Every attacker session produces an **incident brief** and a **downloadable forensic report**
(`/analyst/brief`, `/analyst/report`). They are shown in the live dashboard and the guided demo.

- **Facts** come straight from the gateway's event log:
  - how and when we noticed (First Sight's evidence);
  - the stolen login;
  - client software, address and request rhythm;
  - ATT&CK techniques;
  - every decoy tracker taken and where;
  - what they believe they stole;
  - whether anything real left.
- **Judgement calls** (actor type, likely goal, next moves, which response steps matter most) come from Claude via structured outputs. The attacker's own strings (paths, user agents) are wrapped as untrusted data, and the model has no tools: it can only write the brief.
- **Response playbook:** keep them in the decoy; reset the stolen password and leave the decoy session running; phone the nurse to find the phishing email; watch the indicators across all hospitals; alert on tracker reuse; share with H-ISAC; give the privacy officer the evidence for the HIPAA risk assessment.
- **Honesty:** the brief says "rule-based" when no model wrote it, and never states a fact that isn't in the events.

### Peri — forward deployed engineer

- **Working deployment:** https://mayajaal-gamma.vercel.app (landing page, guided demo, paper, recorded runs and reports).
- **Deployable by design:** MayaJaal sits as a gateway in front of a standard FHIR API and IT portal. A hospital puts it in front of its existing EHR; nothing in the EHR changes. Clinicians keep using their client; the gateway reads device certificates and request patterns.
- **The full stack** (gateway, decoy, hub) runs with one script (`scripts/dev.sh`) and is shown live from a laptop.
- **Honesty:** the FHIR server, hospitals and patients in the demo are synthetic.

### LangChain — best use of Deep Agents

The **MayaJaal Investigator** (`backend/mayajaal/investigator.py`, hub `POST /investigate`) is a Deep Agent
that works an incident the way an analyst would:

1. **Plans:** it writes its own investigation plan to `/plan.md`.
2. **Delegates** with the `task` tool to three sub-agents:
   - **timeline-analyst** reconstructs the attack as an ATT&CK kill chain, with times;
   - **indicator-hunter** extracts addresses, client software, the stolen login and tracker ids, and searches every *other* recorded session for each one ("has this attacker been here before?");
   - **response-planner** turns the findings into ordered steps with owners.
3. **Writes the case file** on its virtual filesystem: `/findings/*.md` from each sub-agent and `/report.md` at the end.

Why it's a deep agent and not one prompt: the investigation needs many tool calls across the timeline,
decisions, trackers, intent history and other sessions, and the sub-agents keep each line of inquiry in its
own context.

It's safe on hostile material. Every tool is read-only over the event log, and the filesystem is the
in-memory `StateBackend` (no disk, no shell). Prompts mark every attacker-supplied string as evidence, never
instructions. MayaJaal's detection and decoy don't depend on it: the investigator only reads and recommends.

### Amazon — best practical AI innovation

MayaJaal is an agent loop that runs on every request:

1. **Observe:** every request through the gateway.
2. **Reason:** update a belief over the attacker's goal and kill-chain stage.
3. **Plan:** choose the next lure, weighing what it reveals against how suspicious it would make them, two steps ahead.
4. **Act:** plant it in that attacker's decoy.
5. **Adapt:** a fresh decoy per attacker; Scatter and the brief when they're caught.

It's practical because nothing has to stop. Clinicians keep working, the lab keeps running, and the
attacker keeps believing. To be precise: MIRAGE is a planning model (Bayesian filter + lookahead planner), and
the language model is used where language is the output, in the incident brief.
