# MayaJaal

*The breach is real. The data isn't.*

A simulated city network of hospitals that assumes it has already been breached. Attackers (including
AI agents) who drift into attacker behaviour are moved, without being told, into a self-consistent
shadow hospital, while protected records stay behind independent controls and lab services keep
running. Built solo at HackPrinceton Fall 2026.

- `vision.md` — the original idea
- `DESIGN.md` — what we are building
- `PLAN.md` — how it is being built (parallel agents, branches, timeline)
- `contracts/` — the event contract every part shares

## Run it

```bash
scripts/dev.sh --mock   # UI + hub replaying a scripted demo attack
scripts/dev.sh          # full stack
```

Web: http://localhost:3000 · Hub: http://localhost:8002/health
