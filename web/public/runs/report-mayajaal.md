# MayaJaal forensic report — run run-20261115-0445-9a32

_Source: rules + claude-opus-5-5. Facts come from the gateway's event log; anything inferred is marked as a guess._

## Summary (written by the language model)

A script logged in with nurse n.okafor's real Eastbank Community password, was moved into the decoy hospital within about a second, and downloaded what it believes are 2,000 patient records and a database backup. All of that was fake: no real patient data or real secrets left the hospital, and three traceable trackers went with the stolen files.

**Actor:** script — The client identified itself as python-httpx/0.28.1, not the EHR app or a browser. Requests came every 0.68 seconds on average with very little variation (0.07), which points to automated pacing rather than a person or a model pausing to think. The sequence was efficient: admin users, backups, bulk patient paging, documents, then a backup download. That fits a pre-written collection script, though an agent driving the same tool cannot be fully ruled out.

**Likely goal:** Bulk data theft (exfiltration), assessed by the gateway at 86% confidence. The activity was patient record harvesting, document collection, a database dump download and a look at the user list.

**Likely next moves:**

- Use or check the stolen data offline, for example opening the research cohort README link or loading the database dump. That would fire the URL and file trackers.
- Try the accounts seen in the decoy admin user list to log in elsewhere or move laterally.
- Come back with n.okafor's login to pull more documents or more backups.
- Offer or sell the 'patient' data, which would surface the tracked MRN (ht-mrn-6256ba47) externally.

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

1. **now · SOC on-call:** Leave session 76d35e13 running in the decoy and do not block it. Put alerts on trackers ht-url-c2f306dd, ht-mrn-6256ba47 and ht-file-5a87abf3, and on any login attempt using decoy usernames. _Cutting the session off tells them they were caught. Tracker hits are the best way to learn where the data goes and who is behind it._
2. **within the hour · Identity team with the nurse manager:** Contact n.okafor out-of-band (in person or by phone, not email) to confirm she was not running this. Ask about recent phishing or password reuse. Prepare a password reset and MFA re-enrollment, timed with the SOC. _Her real password is compromised. A coordinated reset keeps her safe without tipping off the attacker too early._
3. **within the hour · SOC / network team:** Find the true source of the traffic. The gateway saw 127.0.0.1, so check the proxy, VPN and load balancer logs for the real origin of session 76d35e13. Look for the same python-httpx client on other accounts. _A loopback address hides the real origin, and the same script may be using other stolen logins._
4. **within 24 h · Privacy officer / compliance:** Record that no real PHI was served: 0 real records, 0 real secrets, and the one real FHIR read was refused with a 401. Keep the gateway facts and logs as evidence. _This supports a documented decision on breach notification and any law enforcement referral._
5. **ongoing · SOC:** Watch for tracker callbacks and any reuse of the decoy MRNs, file or URL outside the hospital. Share tracker hits with threat intel or law enforcement. _Tracker activity shows where the data went and helps attribution._

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
