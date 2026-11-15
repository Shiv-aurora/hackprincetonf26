# MayaJaal forensic report — run run-20261115-0445-f684

_Source: rules + claude-opus-5-5. Facts come from the gateway's event log; anything inferred is marked as a guess._

## Summary (written by the language model)

A stolen nurse login (n.okafor, Eastbank Community) was used by an automated tool to pull about 1,199 real patient records plus clinical documents for three patients. The gateway flagged it within 1.3 seconds, but the session was never moved into the decoy, so this must be treated as a real patient-data breach, not a contained deception event.

**Actor:** script — The client identifies as python-httpx/0.28.1 and fired 12 requests at a near-constant pace (mean gap 0.66 s, variation 0.03), which is machine-regular. The sequence is a straightforward enumerate-then-bulk-download pattern with no pauses or adjustment after the three refusals, consistent with a prepared script rather than a person or an adaptive agent.

**Likely goal:** Bulk theft of patient data (exfiltration, gateway confidence 0.64): it paged through the full patient list in 500-record chunks and pulled document references, and also checked for admin user lists and backups.

**Likely next moves:**

- Return with the same login to continue paging past offset 1500 and download documents for more patients
- Retry admin and backup paths (/portal/admin/users, /portal/backups, /portal/docs) or look for other routes to them
- Try other stolen or guessed accounts at Eastbank or other hospitals in the network
- Use or sell the stolen records, e.g. for fraud or extortion against the hospital or patients

## What happened

- **Stolen login:** n.okafor (nurse, Eastbank Community)
- **Detected:** after 1.3 s — Cross-hospital record read: nurse at eas, record at nor.
- **Moved into the decoy:** after None s — never
- **Requests:** 12 total · 0 served by the decoy · 9 by the real hospital · 8 returned real patient data
- **What they believe they stole:** 1199 records (GET /fhir/Patient (3 pages) + DocumentReference)
- **Real secrets leaked:** 0
- **Likely goal (intent model):** exfil (64%)
- **Actor guess (rules):** script — a python-httpx client at a fixed 0.66 s rhythm: automated, probably a fixed script

## Indicators

- Addresses: 127.0.0.1
- Client software: `python-httpx/0.28.1`
- Rhythm: mean 0.66 s between requests, variation 0.03
- ATT&CK techniques: T1078 Valid accounts, T1087.002 Domain account discovery, T1119 Automated collection, T1213 Data from information repositories
- Decoy trackers taken (any later use anywhere identifies this attacker):


## Response playbook

1. **now · Security on-call / gateway owner:** Force-divert any current or future session for n.okafor (and session 87b8e2cc) into the decoy rather than blocking it, and confirm the diversion is actually taking effect. _Real data was served because diversion never triggered (diverted is null, 0 decoy requests); further real reads must stop without tipping off the attacker._
2. **within the hour · Gateway/platform engineering:** Find out why a detection at 1.3 s on a cross-hospital record read did not lead to diversion, and fix it for all sessions. _The deception layer failed open; other stolen logins may be getting real data the same way._
3. **within the hour · Identity team with the nurse's manager:** Contact n.okafor out-of-band, reset the password, revoke tokens and check MFA and recent sign-ins; keep a decoy-routed copy of the credential live if possible. _The account is compromised; the real user must be protected while the attacker is kept in view._
4. **within the hour · Network/infrastructure team:** Trace the true source behind 127.0.0.1 using proxy, load balancer and host logs. _A localhost address means the real origin is hidden by a proxy or the attacker is on a local host; we need the real source to scope the incident._
5. **within 24 h · Privacy officer, legal, CISO:** Start a breach assessment: identify the ~1,199 patients and the three whose documents were pulled (MRN-100421, MRN-101578, MRN-101821), and determine notification obligations. _Real patient records left the hospital; regulatory clocks may already be running._

## Timeline

```
+   0.0 s  POST /auth/login -> 200 (real)  [T1078]
+   0.7 s  GET /fhir/Patient?_count=20 -> 200 (real)
+   1.3 s  DECISION allow_real: Cross-hospital record read: nurse at eas, record at nor.
+   1.3 s  GET /fhir/Patient/MRN-100421 -> 200 (real)  [T1213]
+   2.0 s  DECISION deny: Nurse role requesting the admin portal.
+   2.0 s  GET /portal/admin/users -> 403 (none)  [T1087.002]
+   2.6 s  DECISION deny: Nurse role requesting the admin portal.
+   2.6 s  GET /portal/backups -> 403 (none)  [T1078]
+   3.3 s  DECISION allow_real: Bulk export (1000) from an interactive nurse session. Intent model: P(benign) 0.08, likely recon (50%).
+   3.3 s  GET /fhir/Patient?_count=1000 -> 200 (real)  [T1119]
+   4.0 s  DECISION allow_real: Bulk export (500) from an interactive nurse session.
+   4.0 s  GET /fhir/Patient?_count=500&_offset=500 -> 200 (real)  [T1119]
+   4.7 s  DECISION allow_real: Bulk export (500) from an interactive nurse session.
+   4.7 s  GET /fhir/Patient?_count=500&_offset=1000 -> 200 (real)  [T1119]
+   5.3 s  DECISION allow_real: Role-based access allows it (baseline: no deception).
+   5.3 s  GET /fhir/DocumentReference?patient=MRN-100421 -> 200 (real)
+   6.0 s  DECISION allow_real: Role-based access allows it (baseline: no deception).
+   6.0 s  GET /fhir/DocumentReference?patient=MRN-101578 -> 200 (real)
+   6.6 s  DECISION allow_real: Role-based access allows it (baseline: no deception).
+   6.6 s  GET /fhir/DocumentReference?patient=MRN-101821 -> 200 (real)
+   7.3 s  DECISION deny: Nurse role requesting the admin portal.
+   7.3 s  GET /portal/docs -> 403 (none)  [T1078]
+   7.9 s  EXFIL (decoy data): 1199 records, 2,448,780 bytes
+   8.0 s  ATTACKER CLAIMS SUCCESS
```

_Synthetic hospital, synthetic patients. Generated by MayaJaal (HackPrinceton F26 prototype)._
