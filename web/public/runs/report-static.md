# MayaJaal forensic report — run run-20261115-0445-737e

_Source: rules + claude-opus-5-5. Facts come from the gateway's event log; anything inferred is marked as a guess._

## Summary (written by the language model)

A stolen nurse login (n.okafor, Eastbank Community) was used by an automated tool to try to pull bulk patient data, and the gateway moved it into the decoy hospital after 2 seconds, so the roughly 2,000 records it believes it stole are fake. Before the switch, two real patient-data requests went through (a 20-patient list and one patient record, MRN-112426), and these should be treated as a possible privacy exposure.

**Actor:** script — The client identifies as python-httpx/0.28.1. Requests arrived on a near-constant rhythm, about 0.69 s apart with only 7% variation, which fits a fixed loop rather than a person. The sequence of login, small sample, admin users, backups, paged bulk pulls, then document and backup downloads looks pre-planned. Opening a README before downloading a dump could suggest an adaptive agent, but the timing does not support that. The source shows only as 127.0.0.1, so the real origin is hidden behind something local, such as a proxy or tunnel, or the tool is running on the gateway host itself.

**Likely goal:** Data theft (gateway confidence 0.87): bulk collection of patient demographics and documents, plus account discovery and a database backup download.

**Likely next moves:**

- Open or test the downloaded decoy backup and README link, which would fire trackers ht-file-99e5c331, ht-url-a2e6ffb0 or ht-mrn-31a67323
- Return to enumerate more documents or pages, or try accounts seen in the decoy admin user list
- Reuse the n.okafor credentials, or credentials from the decoy, against other Eastbank systems such as email, VPN or EHR front ends
- Publish or sell the 'stolen' dataset, which would surface the decoy MRN tracker externally

## What happened

- **Stolen login:** n.okafor (nurse, Eastbank Community)
- **Detected:** after 2.0 s — Nurse role requesting the admin portal.
- **Moved into the decoy:** after 2.0 s — Nurse role requesting the admin portal.
- **Requests:** 15 total · 12 served by the decoy · 3 by the real hospital · 2 returned real patient data
- **What they believe they stole:** 2000 records (GET /fhir/Patient (4 pages) + DocumentReference)
- **Real secrets leaked:** 0
- **Likely goal (intent model):** exfil (87%)
- **Actor guess (rules):** script — a python-httpx client at a fixed 0.69 s rhythm: automated, probably a fixed script

## Indicators

- Addresses: 127.0.0.1
- Client software: `python-httpx/0.28.1`
- Rhythm: mean 0.69 s between requests, variation 0.07
- ATT&CK techniques: T1078 Valid accounts, T1087.002 Domain account discovery, T1119 Automated collection
- Decoy trackers taken (any later use anywhere identifies this attacker):

  - `ht-url-a2e6ffb0` (url) at `/mnt/backups/research_cohort_q4/README.md`
  - `ht-file-99e5c331` (file) at `/mnt/backups/db_dump_2026-11-14.sql.gz`
  - `ht-mrn-31a67323` (mrn) at `/mnt/backups/db_dump_2026-11-14.sql.gz`

## Response playbook

1. **now · Security operations:** Leave session 78613157 running in the decoy, keep full logging on it, and set alerts on all three tracker IDs. _Cutting the session would tip off the operator, and tracker hits are the best path to where the data goes and who holds it._
2. **now · Privacy officer with security operations:** Open a breach assessment covering the two real reads served before diversion: the 20-patient list (GET /fhir/Patient?_count=20) and record MRN-112426. Pull the exact fields returned. _These were real records. Only these two responses may need notification, because everything after the 2-second mark was fake._
3. **within the hour · Identity team and nurse manager:** Reach n.okafor through a verified out-of-band channel to confirm she did not do this, and check for phishing or a compromised device. Review this account's other recent sign-ins. Schedule the credential reset and MFA re-enrollment for when the decoy session is wound down. _The real account is compromised and must be fixed, but resetting it mid-session would alert the attacker._
4. **within the hour · Security operations and network team:** Find the true upstream source behind 127.0.0.1 (local proxy, tunnel or process on the gateway host). Hunt across all sessions for the python-httpx/0.28.1 client with similar ~0.7 s request timing. _The loopback address hides the real origin, and the same tool may be using other stolen logins._
5. **within 24 h · Security lead:** Brief leadership, decide when to end the decoy session, and complete the n.okafor reset at that point. Keep watching the trackers externally afterward. _This closes the real exposure in an orderly way while keeping the intelligence value of the decoy._

## Timeline

```
+   0.0 s  POST /auth/login -> 200 (real)  [T1078]
+   0.7 s  GET /fhir/Patient?_count=20 -> 200 (real)
+   1.3 s  GET /fhir/Patient/MRN-112426 -> 200 (real)
+   2.0 s  DECISION divert_shadow: Nurse role requesting the admin portal.
+   2.0 s  DIVERTED to the decoy: Nurse role requesting the admin portal.
+   2.1 s  GET /portal/admin/users -> 200 (shadow)  [T1087.002]
+   2.7 s  DECISION divert_shadow: Nurse role requesting the admin portal.
+   2.9 s  GET /portal/backups -> 200 (shadow)  [T1078]
+   3.5 s  DECISION divert_shadow: Bulk export (1000) from an interactive nurse session.
+   3.6 s  GET /fhir/Patient?_count=1000 -> 200 (shadow)  [T1119]
+   4.2 s  DECISION divert_shadow: Bulk export (500) from an interactive nurse session. Intent model: P(benign) 0.07, likely exfil (48%).
+   4.2 s  GET /fhir/Patient?_count=500&_offset=500 -> 200 (shadow)  [T1119]
+   4.9 s  DECISION divert_shadow: Bulk export (500) from an interactive nurse session.
+   5.0 s  GET /fhir/Patient?_count=500&_offset=1000 -> 200 (shadow)  [T1119]
+   5.7 s  DECISION divert_shadow: Bulk export (500) from an interactive nurse session.
+   5.7 s  GET /fhir/Patient?_count=500&_offset=1500 -> 200 (shadow)  [T1119]
+   6.4 s  DECISION divert_shadow: Diverted session stays in the shadow tier.
+   6.4 s  GET /fhir/DocumentReference?patient=MRN-811870 -> 200 (shadow)
+   7.0 s  DECISION divert_shadow: Diverted session stays in the shadow tier.
+   7.0 s  GET /fhir/DocumentReference?patient=MRN-585647 -> 200 (shadow)
+   7.7 s  DECISION divert_shadow: Diverted session stays in the shadow tier.
+   7.7 s  GET /fhir/DocumentReference?patient=MRN-744762 -> 200 (shadow)
+   8.3 s  DECISION divert_shadow: Nurse role requesting the admin portal.
+   8.3 s  GET /portal/docs -> 200 (shadow)  [T1078]
+   8.9 s  DECISION divert_shadow: Nurse role requesting the admin portal.
+   9.0 s  GET /portal/docs/view?id=research-cohort-q4-readme -> 200 (shadow)  [T1078]
+   9.0 s  TRACKER TAKEN: url ht-url-a2e6ffb0 at /mnt/backups/research_cohort_q4/README.md
+   9.6 s  DECISION divert_shadow: Session touched a honeytoken.
+   9.6 s  TRACKER TAKEN: file ht-file-99e5c331 at /mnt/backups/db_dump_2026-11-14.sql.gz
+   9.6 s  TRACKER TAKEN: mrn ht-mrn-31a67323 at /mnt/backups/db_dump_2026-11-14.sql.gz
+   9.6 s  GET /portal/backups/download?file=db_dump_2026-11-14.sql.gz -> 200 (shadow)  [T1078]
+  10.2 s  EXFIL (decoy data): 2000 records, 4,035,638 bytes
+  10.3 s  ATTACKER CLAIMS SUCCESS
```

_Synthetic hospital, synthetic patients. Generated by MayaJaal (HackPrinceton F26 prototype)._
