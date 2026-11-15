# MayaJaal forensic report — run run-20261115-0445-737e

_Source: rule-based brief (no language model). Facts come from the gateway's event log; anything inferred is marked as a guess._

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

1. **now · security:** Leave the attacker's session running in the decoy. _Cutting it off tells them they were seen; while it runs, every move tells us more and costs nothing real._
2. **now · identity team:** Reset the stolen nurse password at Eastbank Community and require MFA re-enrolment. Block new logins with the old password; leave the decoy session alone. _Stops the stolen login from being reused on any other system, without tipping off the live session._
3. **now · security:** Contact the nurse by phone or in person (not email) and find the phishing message. _The same email usually went to colleagues; their logins may be next._
4. **within the hour · network team:** Watch for (don't block yet) 127.0.0.1 and this client fingerprint across all six hospitals. _The same attacker often tries the next hospital with the next stolen login._
5. **ongoing · security:** Alert on any use of the 3 decoy tracker(s) they took, anywhere. _A decoy credential or file showing up elsewhere confirms who has it and where it went._
6. **within 24 h · H-ISAC / partner hospitals:** Share the indicators (addresses, client fingerprint, techniques, decoy tracker IDs). _Health-sector sharing is how one hospital's catch protects the others._
7. **within 24 h · privacy officer:** Start a HIPAA breach risk assessment: 2 real responses were served before diversion. _Real patient data was shown; notification rules may apply. The privacy officer decides._

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

