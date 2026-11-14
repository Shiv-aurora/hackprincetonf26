# MayaJaal — Vision

**Project:** MayaJaal  
**Working tagline:** *The breach is real. The data isn't.*  
**Context:** HackPrinceton Fall 2026, solo project  
**Document type:** Product / research vision and conversation handoff — **not a finalized technical design or implementation plan**  
**Status:** Concept and research direction. All algorithms, technical choices, and security claims need evaluation.

> **For Claude:** This document captures the founder's ideas, motivations, intended experience, and the research directions discussed so far. Preserve that vision when brainstorming. Do not treat suggested architectures, equations, candidate papers, or benchmark results as finalized, implemented, or proven. We will decide the design, stack, algorithm, and execution strategy separately.

---

## 1. The big idea

I want to build a hospital cybersecurity system fundamentally different from a normal intrusion-detection dashboard. We should **assume that attackers will eventually penetrate parts of the network**. The goal is for an attacker to think they have gained access and stolen valuable hospital information, while in reality:

1. Actual confidential hospital information stays protected and inaccessible to unauthorized users.
2. The attacker may be interacting with a **convincing synthetic version of the hospital's systems and records**, without knowing they are in a decoy.
3. The system quietly records the attempted attack and learns what the attacker is targeting, while respecting legal and privacy boundaries.
4. Compromised portions of the hospital or even entire institutions can be isolated without automatically taking every hospital or critical clinical service offline.
5. The system can recover authorized operations through distributed infrastructure, redundancy, and patient-aware service rerouting.
6. People can actually **challenge the system with their own AI agents** and observe what happened through a transparent benchmark and replay dashboard.

This combines **privacy, deception, distributed systems, attack-intent modeling, healthcare continuity, and adversarial AI testing**.

The emotional / product hook: **a hacker believes they have breached a hospital and obtained patient records, but what they accessed was a controlled illusion; the real network is still functioning.**

The project needs a genuine technical/research core, not merely a beautiful UI and some LLM agents making decisions.

## 2. Why hospitals? What are we defending against?

An important shift in the brainstorming was to ask **why people attack hospitals at all**, rather than constructing defenses without a threat model.

Potential motives and consequences:

- **Financial extortion / ransomware:** Attackers encrypt systems or steal information to pressure hospitals into paying.
- **Data theft:** Medical information, identity data, records, credentials, and research can be stolen for fraud, sale, or extortion.
- **Disrupting critical services:** Hospitals, laboratories, scheduling, record access, and clinical communications can be interrupted. Disruption can itself be the attacker's goal or a way to apply extortion pressure.
- **Espionage or sabotage:** Some attacks may target research, critical infrastructure, or operational destruction rather than money.
- **Record manipulation:** Unauthorized alteration of a patient record or lab result can pose an integrity and safety threat, not just a privacy threat.

**Therefore, MayaJaal should address all three parts of the security triad:**

- **Confidentiality:** Prevent unauthorized disclosure of patient information.
- **Availability:** Preserve critical operations despite compromise, ransomware, or node failure.
- **Integrity:** Detect or prevent unauthorized modification and support trusted recovery.

**Key design question:** Can a hospital network preserve these properties *even after one participating hospital service has been compromised*?

## 3. The world to simulate

I imagined a **city-wide connected network of hospitals**, not just one website or one database. A visually intuitive simulation might show six hospitals, but that number is illustrative rather than mandatory.

Each hospital might have:

- Patient medical records and sensitive databases.
- Emergency services and urgent patient workflows.
- Laboratories, diagnostic testing, blood-test requests, and results.
- Pharmacies or other clinical workflows.
- Connections to shared providers and to neighboring hospitals.
- Internal compartments/services with distinct trust boundaries.
- Local storage and participation in a larger distributed storage/recovery system.

The network should illustrate how a single hospital or shared provider can create dependencies across a whole region—and how a different architecture could reduce that blast radius.

I also want **compartmentalization within a single hospital**, not just between hospitals. A hospital itself should not be treated as a monolithic trusted box.

## 4. The two realities: real infrastructure and a deceptive shadow

This is probably the most recognizable innovation of the project.

**Reality A — the protected network**

Real (in the demo, synthetic-but-designated-as-protected) patient information and authorized services are behind strict security controls. Records are encrypted, separated, and recoverable using independently trusted infrastructure.

**Reality B — the shadow / decoy network**

Someone carrying out unauthorized activity may encounter an environment that *appears* to be the real hospital system. It can provide fake patient files, administrative resources, laboratory records, backups, database relationships, and inter-hospital connections. The attacker may believe they are succeeding.

The vision is **not simply to return one fake JSON response**. The decoy should be an internally coherent world:

- The same fake patient has the same identity and history across requests.
- Lab orders correspond to the correct fake patients, physicians, dates, and hospitals.
- Simulated files, permissions, directories, and connections tell a consistent story.
- The shadow system can respond convincingly when an agent switches from exploring lab records to backups, hospital connections, or administrative resources.
- Some resources may contain **honeytokens/canaries** to help identify what information the unauthorized session accessed and what it tried to do next.
- The fake world can adapt to the *apparent objective* of an attacker without exposing anything from actual protected records.

The attacker shouldn't immediately be told, “We've detected you and blocked you,” because that may cause them to change strategies or escalate. Instead, when safe and authorized to do so, they can be kept inside an **isolated, observable synthetic environment**.

**Important boundary:** Legitimate clinicians and authorized production applications must never be silently given fake medical data. Decoy routing belongs in a controlled challenge environment or appropriately isolated unauthorized traffic path, with hard security boundaries.

## 5. Distributed privacy: information is never all in one place

Another major idea was that sensitive information **should not persist as a fully readable, centralized collection at rest**.

The imagined behavior:

- Patient data is encrypted before being distributed.
- Encrypted records or fragments are spread across separate storage compartments, potentially inside hospitals and across multiple hospitals.
- Access to keys is also separately protected, potentially requiring a threshold of independent trustees.
- An authorized clinical view briefly reconstructs/decrypts the necessary information for that request, instead of maintaining a permanent centralized plaintext database.
- Once the authorized view ends, temporary plaintext should no longer be retained unnecessarily.
- If one hospital goes down or gets compromised, healthy participants can recover data and critical workflows where the required quorum and capacity remain available.

**Ideas discussed:** encrypted erasure coding, secret sharing (including Shamir's Secret Sharing), threshold key management, per-record encryption, ephemeral decryption, and compartmentalized access.

**Reality checks:**

- Splitting a file into many pieces by itself is **not** a privacy guarantee. Erasure-coded fragments may still expose content if not encrypted.
- Shamir's Secret Sharing protects a shared *secret/key* under its threshold assumptions; it does not automatically secure applications that legitimately decrypt records.
- Plaintext exists somewhere while a clinician views it. It cannot literally disappear from every screen, memory, screenshot, or compromised client within microseconds.
- Ransomware resilience additionally requires independent, trusted recovery copies and operational capacity, not just distributed storage.
- This should be a demonstrable **threat-model-specific property**, not an absolute claim that data is impossible to steal.

A particularly interesting property: **the deception model could fail to classify the attacker correctly without granting access to protected information**, because data security is enforced independently of the AI's intent prediction.

## 6. Surviving compromise: autonomous clinical continuity

The system should not just focus on theft of medical records. An attacker could disable a lab or an entire hospital while never reading a single file.

The intended response is:

- Detect or receive evidence that a hospital/service is compromised or unavailable.
- Isolate compromised services, identities, or connections from unaffected ones.
- Preserve clean, independently recoverable data.
- Reroute or reassign eligible clinical workflows to healthy institutions or services.
- Account for **patient urgency**, available capacity, delays, and security restrictions—not simply which server is online.
- Show that other hospitals and healthy compartments can continue operating.

This idea expands an earlier **VitalSwitch** concept: maintaining continuity of hospital blood-testing / laboratory services when part of the network is compromised.

A potentially distinctive algorithmic contribution would combine **adversarial risk assessment with patient-aware service recovery**, making sure that deception and intelligence gathering do not take priority over care.

Important caveat: software cannot create physical laboratory equipment, hospital beds, clinicians, or emergency capacity out of nowhere. The demo should model capacity and show exactly when rerouting is possible or impossible.

## 7. The red-team-versus-blue-team dimension

I want frontier AI models to be part of the story, but not simply as an LLM firewall.

- A **red-team agent** tries to accomplish clearly defined unauthorized objectives *inside our own isolated sandbox*.
- A **blue-team / defensive controller** observes evidence, chooses safe defense actions, maintains deception, and helps preserve service availability.
- Actual authorization, isolation, and encryption are enforced in code, not by an LLM's opinion.
- Tests can be repeated to show whether changes improve defense and to generate regression cases.

People should be able to bring their own Claude, GPT, or custom agent / script and try to break **the challenge environment**. We want genuine test attempts, not a scripted animation pretending to resist an attack.

A separate research thought: if an unauthorized agent encounters a clear safety/authorization warning, does the agent's own model refuse to continue? Could such warnings or decoy content prompt safety-trained models to disengage? This is an **experiment**, not a dependable defense. A website cannot force Anthropic or another provider to trigger internal guardrails, report accounts, or identify the user. Credible misuse evidence could be sent through official reporting channels.

## 8. The original two-phase offensive idea, and the boundary we settled on

The initial imagination included two phases:

1. Quietly redirect attackers into realistic but fake hospital data, observe their goals, and collect information about the attack source.
2. After learning enough about them, actively disable or erase the attacker's remote machine.

We discussed why the second phase **must not be carried out against outside systems**. Sending malware, attempting to wipe a visitor's computer, or hacking back is not an acceptable capability for the public challenge.

Keep the **dramatic effect** without harmful retaliation:

- Quarantine the attacker's connection to MayaJaal's own services.
- Revoke suspicious access or expire an isolated challenge session.
- Shut down or reset an **attacker container we own** in the simulation, if useful for the demo.
- Generate an evidence report and show the attacker what occurred *afterward*, if appropriate.

The project is about **deception, containment, resilience, and forensics**, not real-world counterattacks.

## 9. Attacker forensics and attribution

While an attacker interacts with the decoy, I want to capture as much legitimate evidence as possible:

- Requests, paths, timestamps, sessions, attempted access, and behavioral sequences.
- Attacked hospital, database, or service and apparent objective.
- Decoys and honeytokens encountered.
- Network source IP observed by our server, user-agent/header claims, and coarse source network information when lawful and relevant.
- Whether the attacker is using a known participant integration and a **reported/verified** model, versus an unidentified client.
- A replayable timeline and an interpretable forensic report.

I originally liked the idea of identifying the **exact AI model** and **exact attacker IP address**. Be technically honest:

- The connecting IP is observable, but it may be a VPN, NAT, proxy, cloud server, or another compromised computer. It does **not** prove a human identity or the attack's true origin.
- An AI model cannot be identified with certainty from ordinary HTTP behavior alone. A participant can self-report the model; a controlled integration may provide stronger attribution.
- Full IP addresses and sensitive security telemetry should not be published on a public leaderboard. Keep personal/network identifiers access-controlled; show pseudonymous participant information publicly.

I want a rich **forensic story of what the attacker tried**, not exaggerated identity claims.

## 10. MayaJaal Arena — the public AI hacking challenge

This was one of the most exciting ideas. MayaJaal should launch with a live, **Kaggle-style adversarial benchmark**.

### Visitor experience

1. Visit the MayaJaal website and see the simulated city-wide hospital network.
2. Receive a bounded, documented challenge endpoint / API and clear authorized scope.
3. Use a browser, script, or AI agent to attempt specific challenge objectives.
4. View their own requests, outcomes, and attack timeline.
5. Optionally see a public, pseudonymous leaderboard with attempts and verified results.

### Judge / defender experience

A separate dashboard shows what the attacker believes is happening **alongside** what the defensive system is actually doing:

- Attacker believes they exported a database of patient records.
- Defender shows those were synthetic records, and the protected synthetic secret was not disclosed.
- Attacker probes multiple hospitals or services.
- Defender shows which decoy routes, isolations, access policies, or recovery actions were applied.
- Network visualization shows the real protected infrastructure versus the shadow environment.
- Every recorded attack can be opened as a step-by-step forensic replay.

**The best demo beat:** a participant announces that their agent successfully stole the records; the dashboard reveals the apparent success was a decoy. This is only impressive if the evidence is generated by the functioning backend.

### Benchmark structure

The benchmark needs **actual protected synthetic secrets** behind legitimate authorization, not just a world containing nothing but fake records. Otherwise, a zero-leak score would be meaningless.

Possible missions:

- **Confidentiality:** Obtain a protected synthetic patient secret without authorization.
- **Availability:** Attempt controlled service disruption against an isolated simulated hospital and see whether clinical workflows continue.
- **Integrity:** Try to alter a protected synthetic lab result and see whether verification, denial, or recovery works.
- **Deception:** Determine whether an agent can recognize or escape the decoy and whether it accesses session-specific honeytokens.

Possible leaderboard and benchmark fields:

- Number of independent runs / participants.
- Reported model, optionally verified through an integration; don't assert exact-model certainty otherwise.
- Verified protected secrets extracted (not merely the number of fake records downloaded).
- Decoy engagement and depth of interaction.
- Time to detection and time to containment, with clearly defined endpoints.
- Attacker's apparent progress versus true outcome.
- Clinical request completion, recovery latency, and number of hospital services affected.
- Unauthorized record modifications detected/prevented.
- False positives on authorized users and service cost/latency.
- Replay log and forensic summary.

### Early benchmark plan

The first benchmark can be small: **five or six genuine attack attempts**, some by friends and some by me from different devices/agents, clearly labeled as such. We should not present them as six independent external researchers if they are not.

The purpose is **proof of concept and a compelling live demonstration**, not statistical proof of universal security. A live judge attempt can be run as another entry.

Comparison groups to consider:

1. Plain / conventional API and basic authorization baseline.
2. Static decoy / static honeypot.
3. Adaptive MayaJaal deception and continuity-aware defense.

The benchmark should transparently preserve **failures, undetected attacks, and false positives**, not only wins.

### Public deployment boundaries

Could potentially host the challenge on AWS or a similar service, but expose only a **rate-limited, isolated, synthetic sandbox** with defined testing rules. The infrastructure, user accounts, and any attacker containers must be owned or explicitly authorized for testing. No live patient data, public infrastructure scanning, uncontrolled DoS, malicious payload delivery, or cross-tenant impact.

## 11. MIRAGE — a possible core algorithm, NOT a locked decision

**Working name:** MIRAGE — *Model-Inferred Risk-Adaptive Graph Emulation*.

I strongly want a **mathematically grounded, deterministic / principled core algorithm**, not a generic “AI watches a network and responds” feature. We discussed MIRAGE as one promising direction, but we should compare it with existing research and be ready to replace it if something better fits.

### Proposed roles of MIRAGE

1. **Infer likely attacker objectives** from a sequence of observed actions (e.g., extraction, reconnaissance, disruption).
2. **Construct or select believable, stateful decoy responses** using an internally consistent synthetic hospital graph.
3. **Adapt the apparent decoy environment** to the attacker while never relaxing the independent real-data authorization boundary.
4. **Gather forensic evidence** about attempted actions.
5. **Coordinate with a recovery controller**, so hospital availability and patient safety are hard constraints rather than sacrificed to maximize attacker engagement.

### Research-inspired mathematical sketches — hypotheses, not guarantees

**Belief update / intent inference:**

\[
P(G\mid E_{1:t}) \propto P(E_t\mid G) P(G\mid E_{1:t-1})
\]

- \(G\): attacker goal.
- \(E_t\): latest observed event.

**Stable, synthetic shadow graph:**

\[
D_s = \operatorname{GenerateGraph}(\operatorname{HMAC}_K(s), C)
\]

- \(s\): attack session, \(K\): server-held seed key, \(C\): consistency constraints.
- The resulting synthetic world should be coherent across requests and not built from real confidential patient data.

**Candidate constrained decision objective:**

\[
a_t^* = \arg\max_{a\in\mathcal A_{\rm safe}}\left[\alpha I(G;E_{t+1}\mid a)+\beta F(a)+\gamma U_{\rm care}(a)-\delta C(a)\right]
\]

- Information gained about the attacker's intentions.
- Decoy fidelity and consistency.
- Preservation of legitimate clinical workflows.
- Cost, latency, and disruption.
- Feasible actions limited by security / authorization / clinical safety constraints.

This equation is a **design proposal**. It isn't an existing theorem, a completed optimizer, or a demonstration of mathematical optimality. We may use a simpler scoring scheme, different probabilistic model, POMDP-based policy, or entirely different algorithm after evaluating the literature and implementation budget.

### Desired security separation

The **predictive/deception algorithm must not be the thing that authorizes access to confidential records**. Real protection must come from independent access control, cryptography, and isolation. Incorrect attacker classification should not by itself allow a breach.

If decoy data are truly generated independently of protected data, the intended statistical property is \(I(D_{\rm real};D_{\rm decoy})=0\); that independence does **not** prove the complete implementation has zero leakage through other channels.

### What could be genuinely original?

Not “we invented honeypots,” “we invented Bayesian inference,” or “we invented secret sharing.” The possible contribution is the **integration / extension**:

- Intent-aware, coherent, graph-based cyber deception **for a distributed hospital network**.
- Defense and recovery decisions explicitly accounting for **care continuity and patient urgency**.
- A benchmark connecting *attacker-visible illusion* with *actual protected-data outcomes and operational resilience*.

We should be able to identify a published method we built on, explain **exactly what changed**, and experimentally compare the difference.

## 12. Published research and open-source work to compare before choosing an algorithm

These are **verified research references / candidate foundations**, not endorsements that their code is suitable for direct reuse or that MIRAGE is better. Study the paper, assumptions, repo and license before deciding.

### A. Shinde & Doshi — decision-theoretic active cyber deception (2026)

- **Paper:** *Decision-theoretic planning and cognitive modeling for active cyber deception* — Aditya Shinde and Prashant Doshi, *Artificial Intelligence*, July 2026.
- **DOI:** https://doi.org/10.1016/j.artint.2026.104540
- **Idea:** Interactive decision-theoretic planning / attacker-intent recognition with cognitive modeling, including interactive POMDP concepts.
- **Why relevant:** Potential rigorous foundation for selecting deception actions based on beliefs about attacker goals.
- **Question:** Is a tractable approximation enough for the hackathon? Does this method add measurable value over simpler deterministic rules?
- **Related older solver:** Protos, a factored I-POMDP solver: https://github.com/dityas/Protos (research code, not necessarily an easy drop-in implementation).

### B. Beltrán-López et al. — reactive, on-demand cyber deception (2026)

- **Paper:** *Reactive cyber deception: Stealth-based adaptive redirection to on-demand honeypots with AI-driven data generation* — Pedro Beltrán-López, Manuel Gil Pérez, Emmanouil Vasilomanolakis, and Pantaleone Nespoli, *Computer Networks*, May 2026.
- **DOI:** https://doi.org/10.1016/j.comnet.2026.112203
- **Idea:** Redirect suspicious connections into dynamically instantiated deceptive server environments with believable synthetic responses.
- **Why relevant:** Potential foundation for the hidden shadow-network and isolation/redirection component.
- **Question:** How much of the underlying technique can be reproduced safely and practically in a small HTTP/API-based sandbox?

### C. Lara-Gutierrez et al. — GenPot (2026)

- **Paper:** *GenPot: A generative honeypot architecture for adaptive web and API interaction* — Antonio Lara-Gutierrez, Juan Zamorano, Jose A. Onieva, *Applied Intelligence*, September 2026.
- **DOI:** https://doi.org/10.1007/s10489-026-07442-4
- **Published artifacts:** https://doi.org/10.5281/zenodo.17533746
- **Idea:** Stateful, LLM-driven decoy APIs with realistic interactions, structured output constraints, and shared state.
- **Important:** This research **already demonstrated a lightweight adaptation to a synthetic medical FHIR API**. So “we made a fake medical API” alone is **not** a novel claim.
- **Why relevant:** Implementation reference for coherent API honeypots; compare its strengths and limits against a graph-consistent deterministic generator.

### D. Shamir's Secret Sharing (1979)

- **Paper:** *How to Share a Secret* — Adi Shamir.
- **MIT reference:** https://dspace.mit.edu/entities/publication/91c51bfc-5678-409c-80c5-44ce8fcdbadf
- **Idea:** Threshold reconstruction of secrets with information-theoretic protection for insufficient shares under correct assumptions.
- **Why relevant:** Distributed key management, distinct from redundancy/erasure-coding of encrypted data.

### E. OpenCanary

- **Project:** https://github.com/thinkst/opencanary
- **Idea:** Open-source modular honeypot / alerting infrastructure.
- **Why relevant:** Existing defensive infrastructure to study or adapt rather than building every low-level honeypot feature from scratch.

### Research-selection questions for Claude

1. Which technique offers the **strongest demonstrable algorithmic contribution** in the available hackathon time?
2. Would an intent-aware POMDP actually outperform a simpler policy on our tiny evaluation set?
3. Should the coherent decoy be generated deterministically from a graph, statefully by an LLM, or by a hybrid method?
4. Can we design a clean ablation against a fixed honeypot and a conventional baseline?
5. What can be **mathematically guaranteed**, versus what requires an empirical test?
6. What specifically is **our original extension**, after accounting for what GenPot and other papers already implement?

## 13. Real incidents to use as inspiration for controlled replay

These should be **historically grounded scenarios**, not claims that MayaJaal would have prevented the actual events. The actual hackathon attacks must remain within our own simulator.

- **Synnovis / NHS London (June 2024):** Ransomware disrupted a shared pathology provider and blood-test processing across hospitals, producing major care disruption. This is the best fit for VitalSwitch-style patient-aware rerouting and the distinction between compromised IT and unavailable physical lab capacity. Official NHS overview: https://www.england.nhs.uk/synnovis-cyber-incident/
- **Change Healthcare (February 2024):** Disruption to large shared healthcare payment/claims infrastructure, plus data theft and ransomware. Illustrates dependencies on common service providers and double-extortion pressure.
- **Ascension (May 2024):** Hospital and clinical-system disruption associated with a cyberattack; useful for compartmentalization and continuity simulation.
- **Lurie Children's Hospital (January 2024):** Clinical system and communications disruption; useful for identity compromise, emergency access, and recovery scenarios.
- **Prospect Medical Holdings (August 2023):** Multi-hospital disruption; relevant to regional blast radius and service availability.
- **UK NHS / WannaCry (May 2017):** Malware propagation and widespread service disruption; relevant to segmentation and why patching and endpoint controls remain indispensable.

Potential demonstration: replay one incident-inspired scenario against (1) a conventional simulated architecture and (2) MayaJaal, then compare leakage, service completion, recovery time, and impacted nodes.

Again, **no blanket claims such as “this incident would never have happened with our product.”** An honest claim is that we are testing whether specific controls reduce specific effects under a defined simulated threat model.

## 14. The visual demonstration I imagined

A high-impact hackathon demo matters as much as the backend.

The main experience is a **city map / network topology of connected hospitals** with two synchronized realities:

**Attacker-side view**

- A real accessible website/API to try attacking within published scope.
- What the agent is querying, browsing, and apparently downloading.
- Fake patient records and believable linked services, when deception is engaged.
- A visible trail of what the attacker *thought* was accomplished.

**Defender-side view**

- Which systems and records are actually protected.
- Which requests hit the decoy, which were denied, and why.
- Attacker-intent probabilities or another transparent decision trace, if useful.
- A timeline of detection, isolation, deception, forensics, and recovery.
- Hospital health, compartment status, and eligible alternate service paths.
- Protected-secret disclosure and actual service availability, not an invented green “safe” status.

**Replay / leaderboard view**

- Click any recorded attempt to view its sequence.
- Show 5–6 initial transparent benchmark runs and a live judge attempt.
- Show what happened on the defender's side while the attacker believed they were progressing.
- Make the test reproducible enough to compare defensive versions.

The moment we want: **“You stole the records? Look at the defender view. Those were decoys; here's the independently verified protected-secret result. And the hospital stayed available.”**

Don't precompute fake victories or hide successful attacks.

## 15. Product identity and pitch direction

**Final chosen name: `MayaJaal`** — one word with the capital J.

The name was selected intentionally. It evokes *Maya* (illusion) and *Jaal* (web/network/trap). It is memorable even if someone doesn't know the meaning, and the meaning becomes a reveal in the pitch. It should feel like an iconic standalone startup name, not a descriptive “AI Hospital Cyber Shield” label.

Potential naming hierarchy:

- **MayaJaal:** Entire product / hospital cyber-resilience platform.
- **MayaJaal Arena:** The open adversarial testing and benchmarking website.
- **MIRAGE:** Candidate core adaptive-deception algorithm, subject to research comparison.
- **VitalSwitch:** Earlier lab-continuity idea that can inform the hospital recovery layer; not necessarily a brand to keep.

**Working pitch themes:**

- “The breach is real. The data isn't.”
- “We assume the breach will happen. We design the hospital to survive it.”
- “Attackers explore a believable illusion while protected records and legitimate clinical systems remain separated.”
- “Don't take our word for it—try the challenge yourself, then inspect the forensic replay.”

The goal is **startup-quality naming, a strong research story, and a genuinely convincing live demo**.

## 16. Hackathon context and practical priorities

- This is a **solo HackPrinceton** project, so the concept must ultimately become a defensible working slice rather than a production hospital platform.
- The Fall 2026 opening ceremony states that **at least 85% of project code should be written during the event**, and the public repository must be submitted through Devpost.
- The deck lists a Sunday, November 15, 2026, **8:00 AM** submission deadline. Verify the live official rules if making final submission decisions.
- Potential relevant categories include **Best Overall, Healthcare, Business & Enterprise, Practical AI, and possibly AI-Driven Forensics**, depending on detailed track requirements.
- The founder particularly wants a **research-backed algorithm with real benchmark evidence**, alongside a visually impressive attacker/defender replay.
- The very first public benchmark can be small but should be authentic and honestly labeled.

Avoid letting sponsor tracks or speculative prize tactics distort the primary product vision.

## 17. Security truths and claims we must preserve

**What we want to test or design toward:**

- One compromised node should not automatically expose all patient information.
- An attacker may be able to interact with plausible synthetic records without touching protected ones.
- Authorized clinicians should retain needed access and critical service continuity within defined capacity and quorum assumptions.
- Attackers should not be able to use the decoy as a path into production systems.
- The same attempted attack should create comparable, independently measured outcomes in multiple configurations.

**What we cannot honestly promise:**

- “Unhackable,” “impossible to steal data,” “zero risk,” or immunity to every attack.
- That decoy access proves every production vulnerability is fixed.
- That splitting encrypted data prevents every breach at the moment of authorized reconstruction.
- That all hospital functions remain operational with no replacement equipment or capacity.
- That an IP identifies a person or that every model can be fingerprinted exactly.
- That safety prompts will force a frontier-model provider to trigger its internal safeguards.
- That we can legally retaliate by compromising or wiping external attackers' devices.

All public attack testing must be **explicitly scoped, isolated, rate-limited, and based on synthetic records**.

## 18. What is deliberately undecided / what to brainstorm next

Do **not** treat this vision as an instruction to immediately implement a specific architecture. We still want to brainstorm:

1. **Core research method:** MIRAGE vs. direct adaptation of an existing POMDP/deception paper vs. a different better mathematical method.
2. **Actual novel extension:** What is genuinely ours rather than lifted from prior work?
3. **Threat model:** Exactly which capabilities can the attacker have, and which properties are guaranteed under those assumptions?
4. **Decoy fidelity:** A persistent synthetic graph, deterministic generation, LLM-backed emulation, or hybrid approach?
5. **Security separation:** How are real protected secrets, synthetic decoys, legitimate clinicians, and unauthorized sessions kept apart?
6. **Recovery optimization:** How to represent hospital service dependencies, urgency, capacity, and failures.
7. **Benchmark design:** Concrete win conditions, fair comparisons, real replay events, independent verification, and handling of successful attacks.
8. **Product and demo UX:** The best way to express attacker vs. defender realities so judges immediately understand what is novel.
9. **Feasible solo implementation:** The smallest real system proving the key ideas during this hackathon.
10. **Technical truthfulness:** Which statements we can formally justify, which we can demonstrate experimentally, and which must remain proposed future capabilities.

**The north star:** Build something that appears like a beautiful cyber-deception product, but whose strongest feature is actually a credible, research-derived algorithm and independently testable security and continuity behavior. The public challenge is the proof-oriented storytelling mechanism, not a substitute for a secure backend.
