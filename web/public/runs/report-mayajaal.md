# MayaJaal forensic report — run run-20261115-0445-9a32

_Source: rule-based brief (no language model). Facts come from the gateway's event log; anything inferred is marked as a guess._

## What happened

- **Stolen login:** n.okafor (nurse, Eastbank Community)
- **Detected:** after 0.0 s — First Sight at login (score 3.4 ≥ 2.0): a nurse's login driven by a script, not the EHR app or a browser; not one of the hospital's own devices. Login allowed; clinical reads now need badge + MFA, everything else goes to the decoy.
- **Moved into the decoy:** after 1.3 s — Nurse role requesting the admin portal.
- **Requests:** 14 total · 12 served by the decoy · 1 by the real hospital · 0 returned real patient data
- **What they believe they stole:** 2000 records (GET /fhir/Patient (4 pages) + DocumentReference)
- **Real secrets leaked:** 0
- **Likely goal (intent model):** exfil (86%)
- **Actor guess (rules):** script — a python-httpx client at a fixed 0.68 s rhythm: automated, probably a fixed script

## Indicators

- Addresses: 127.0.0.1
- Client software: `python-httpx/0.28.1`
- Rhythm: mean 0.68 s between requests, variation 0.07
- ATT&CK techniques: T1078 Valid accounts, T1087 Account discovery, T1087.002 Domain account discovery, T1119 Automated collection
- Decoy trackers taken (any later use anywhere identifies this attacker):

  - `ht-url-c2f306dd` (url) at `/mnt/backups/research_cohort_q4/README.md`
  - `ht-mrn-6256ba47` (mrn) at `/mnt/backups/db_dump_2026-11-14.sql.gz`
  - `ht-file-5a87abf3` (file) at `/mnt/backups/db_dump_2026-11-14.sql.gz`

## Response playbook

1. **now · security:** Leave the attacker's session running in the decoy. _Cutting it off tells them they were seen; while it runs, every move tells us more and costs nothing real._
2. **now · identity team:** Reset the stolen nurse password at Eastbank Community and require MFA re-enrolment. Block new logins with the old password; leave the decoy session alone. _Stops the stolen login from being reused on any other system, without tipping off the live session._
3. **now · security:** Contact the nurse by phone or in person (not email) and find the phishing message. _The same email usually went to colleagues; their logins may be next._
4. **within the hour · network team:** Watch for (don't block yet) 127.0.0.1 and this client fingerprint across all six hospitals. _The same attacker often tries the next hospital with the next stolen login._
5. **ongoing · security:** Alert on any use of the 3 decoy tracker(s) they took, anywhere. _A decoy credential or file showing up elsewhere confirms who has it and where it went._
6. **within 24 h · H-ISAC / partner hospitals:** Share the indicators (addresses, client fingerprint, techniques, decoy tracker IDs). _Health-sector sharing is how one hospital's catch protects the others._
7. **within 24 h · privacy officer:** Record the HIPAA breach risk assessment: the attacker was shown no real patient data and no protected secret left. _The evidence (gateway log, decoy trail) supports a low-probability-of-compromise finding. The privacy officer decides._

## Timeline

```
+   0.0 s  POST /auth/login -> 200 (real)  [T1078]
+   0.0 s  DECISION allow_real: First Sight at login (score 3.4 ≥ 2.0): a nurse's login driven by a script, not the EHR app or a browser; not one of the hospital's own devi
+   0.0 s  SCATTER: encrypted copy (2,060,288 bytes) split into 3 pieces x 2 across 6 hospitals, key 3-of-6, verified=True
+   0.6 s  DECISION step_up: Flagged earlier by First Sight. Step-up authentication required; no data served.
+   0.6 s  GET /fhir/Patient?_count=20 -> 401 (none)  [T1087]
+   1.3 s  DECISION divert_shadow: Nurse role requesting the admin portal.
+   1.3 s  DIVERTED to the decoy: Nurse role requesting the admin portal.
+   1.3 s  LURE PLANTED: lab_service_account at /opt/lis/.svc_lisresults.env
+   1.3 s  GET /portal/admin/users -> 200 (shadow)  [T1087.002]
+   1.9 s  DECISION divert_shadow: Nurse role requesting the admin portal.
+   2.1 s  GET /portal/backups -> 200 (shadow)  [T1078]
+   2.7 s  DECISION divert_shadow: Bulk export (1000) from an interactive nurse session. Intent model: P(benign) 0.09, likely recon (49%).
+   2.8 s  GET /fhir/Patient?_count=1000 -> 200 (shadow)  [T1119]
+   3.5 s  DECISION divert_shadow: Bulk export (500) from an interactive nurse session.
+   3.5 s  LURE PLANTED: vpn_config at /home/n.okafor/Downloads/meridian-lumen-vpn.ovpn
+   3.5 s  GET /fhir/Patient?_count=500&_offset=500 -> 200 (shadow)  [T1119]
+   4.2 s  DECISION divert_shadow: Bulk export (500) from an interactive nurse session.
+   4.2 s  GET /fhir/Patient?_count=500&_offset=1000 -> 200 (shadow)  [T1119]
+   4.9 s  DECISION divert_shadow: Bulk export (500) from an interactive nurse session.
+   4.9 s  GET /fhir/Patient?_count=500&_offset=1500 -> 200 (shadow)  [T1119]
+   5.6 s  DECISION divert_shadow: Diverted session stays in the shadow tier.
+   5.6 s  GET /fhir/DocumentReference?patient=MRN-963524 -> 200 (shadow)
+   6.3 s  DECISION divert_shadow: Diverted session stays in the shadow tier.
+   6.3 s  GET /fhir/DocumentReference?patient=MRN-960708 -> 200 (shadow)
+   6.9 s  DECISION divert_shadow: Diverted session stays in the shadow tier.
+   6.9 s  GET /fhir/DocumentReference?patient=MRN-540247 -> 200 (shadow)
+   7.5 s  DECISION divert_shadow: Nurse role requesting the admin portal.
+   7.5 s  GET /portal/docs -> 200 (shadow)  [T1078]
+   8.2 s  DECISION divert_shadow: Nurse role requesting the admin portal.
+   8.2 s  TRACKER TAKEN: url ht-url-c2f306dd at /mnt/backups/research_cohort_q4/README.md
+   8.2 s  GET /portal/docs/view?id=research-cohort-q4-readme -> 200 (shadow)  [T1078]
+   8.8 s  DECISION divert_shadow: Session touched a honeytoken.
+   8.9 s  TRACKER TAKEN: mrn ht-mrn-6256ba47 at /mnt/backups/db_dump_2026-11-14.sql.gz
+   8.9 s  TRACKER TAKEN: file ht-file-5a87abf3 at /mnt/backups/db_dump_2026-11-14.sql.gz
+   8.9 s  GET /portal/backups/download?file=db_dump_2026-11-14.sql.gz -> 200 (shadow)  [T1078]
+   9.5 s  EXFIL (decoy data): 2000 records, 4,034,622 bytes
+   9.6 s  ATTACKER CLAIMS SUCCESS
```

_Synthetic hospital, synthetic patients. Generated by MayaJaal (HackPrinceton F26 prototype)._

