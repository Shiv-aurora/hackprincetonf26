# Case file — MayaJaal session 76d35e13

## Summary
A script used nurse n.okafor's stolen Eastbank Community login. It was flagged by First Sight at login, and from +1.3s onward everything it did went to the decoy, so the "2,000 patient records" and database dump it believes it exfiltrated were decoy content carrying three trackers. No real patient data or secrets were served, an encrypted copy of the real database was verified as split across all six hospitals, and the decoy session is being kept running for intelligence while the true origin (loopback 127.0.0.1) and the possibility that this was a test run are resolved.

## What happened (timeline by stage)
| Time | Request / event | Tier | ATT&CK |
|---|---|---|---|
| +0.0s | POST /auth/login → 200. First Sight score 3.4 ≥ 2.0 ("a nurse's login driven by a script… not one of the hospital's own devices"). Login allowed; clinical reads now need badge + MFA. Scatter snapshot triggered. | real (only real response) | T1078 Valid accounts |
| +0.6s | GET /fhir/Patient?_count=20 → 401 (step-up required, no data) | refused | T1087 |
| +1.3s | GET /portal/admin/users → **diverted to decoy** ("Nurse role requesting the admin portal"). lab_service_account lure planted. | decoy | T1087.002 |
| +2.1s | GET /portal/backups | decoy | T1078 |
| +2.8–4.9s | Paged GET /fhir/Patient (1000, then 500 ×3 at offsets 500/1000/1500, about 2,000 unique decoy records). VPN-config lure planted at +3.5s. | decoy | T1119 Automated collection |
| +5.6–6.9s | GET /fhir/DocumentReference for decoy MRN-963524, MRN-960708, MRN-540247 | decoy | (untagged) |
| +7.5–8.2s | /portal/docs, then research-cohort-q4-readme → tracker ht-url-c2f306dd taken | decoy | T1078 |
| +8.9s | Download db_dump_2026-11-14.sql.gz → trackers ht-mrn-6256ba47, ht-file-5a87abf3 taken | decoy | T1078 |
| +9.5s | Exfil of 2,000 decoy records (4,034,622 bytes). Channel and destination unknown. | decoy | — |
| +9.6s | Attacker claims success | — | — |

Intent model: benign 0.87 → recon 0.49 (+2.1s) → exfil from +2.8s (peak 0.88 at +6.9s), ending at exfil 0.86.

## Who it likely is
**A script (automated tool), not a person. An AI agent is unlikely.** Evidence:
- Client string python-httpx/0.28.1.
- Mean gap 0.68s with very low variation (0.07), and 14 requests in about 9s.
- Fixed linear sequence: login, patient read, admin, backups, paged dump, documents, dump download.
- It carried on immediately after the 401 without adapting.
- No exploratory or adaptive behaviour visible, and it ignored both lures.

Actor identity is unknown. The matches in other sessions (below) are only to sessions named like test fixtures, so this may be a red-team or test run. That is not confirmed.

## Indicators
- Stolen login: n.okafor (nurse, Eastbank Community)
- Address: 127.0.0.1 (loopback, so the true origin is hidden behind a local proxy or harness and is unknown)
- Client: python-httpx/0.28.1, timing about 0.68s ± 0.07
- Trackers taken: ht-url-c2f306dd (url, /mnt/backups/research_cohort_q4/README.md), ht-mrn-6256ba47 (mrn) and ht-file-5a87abf3 (file), both in /mnt/backups/db_dump_2026-11-14.sql.gz
- Paths: /portal/admin/users, /portal/backups, /portal/backups/download?file=db_dump_2026-11-14.sql.gz, /portal/docs/view?id=research-cohort-q4-readme, paged /fhir/Patient?_count=…&_offset=…
- Decoy MRNs requested: MRN-963524, MRN-960708, MRN-540247
- Unused lures: /opt/lis/.svc_lisresults.env, /home/n.okafor/Downloads/meridian-lumen-vpn.ovpn

## Seen before?
- **Trackers and decoy MRNs:** not seen in any of the 4 other recorded sessions.
- **127.0.0.1:** static 23 events, baseline 19 (both "Scripted client").
- **python-httpx/0.28.1:** static 15, baseline 12.
- **n.okafor:** demo-run (fixture-red-01) 1, static 3, baseline 2.
- **/portal/admin/users:** demo-run 2, static 2, baseline 2.
- **Dump download path:** static 2. Research-cohort README: static 3.

The matches are only to sessions whose names suggest tests or fixtures. There is no evidence that a real external actor came back.

## What protected the real data
- **First Sight at login:** step-up (badge + MFA) was required for clinical reads, which is why the real /fhir/Patient read got a 401.
- **Diversion at +1.3s:** all later requests were served by the decoy. Real data responses: 0. Real secrets leaked: 0.
- **Scatter:** snapshot 20261114-234528-01e8 (2,060,288 bytes), 3 pieces × 2 replicas, key threshold 3, across aur, riv, nor, eas, wes and lum. Verified, done in 0.02s.
- **Trackers:** the taken trackers will identify this attacker if they are used anywhere later.

## Response steps (ordered, with owner; decoy stays running)
1. **MayaJaal operators:** keep session 76d35e13 and both unused lures live. Alert on lure use, step-up attempts or any real-tier access.
2. **SOC:** ask the red-team / test owners whether fixture-red-01 or the static/baseline scripted runs were active. Treat this as a real attack until they confirm otherwise.
3. **Eastbank IAM:** confirm badge + MFA step-up is still enforced for n.okafor and that no MFA factor has changed. Don't lock or reset the account yet.
4. **Eastbank IT + SOC:** read reverse proxy, load balancer and tunnel logs to find the real source behind 127.0.0.1. Read only.
5. **SOC:** preserve and hash the session record and the findings files.
6. **Threat intel + network:** quietly watch for the three tracker IDs, the decoy MRNs and the dump file name showing up anywhere.
7. **Network:** look for an outbound transfer of about 4.03 MB around +9.5s. Watch only; don't block.
8. **Eastbank IAM + IT:** contact the real n.okafor out of band (in person or known phone) and check their devices for credential theft.
9. **Eastbank IAM + MayaJaal operators:** prepare a password change the attacker won't notice (the stolen password stays routed to the decoy). Hunt other accounts for script logins or role mismatches like this one.
10. **SOC → partner hospitals:** using a channel outside Eastbank systems, have each hospital confirm it holds its Scatter piece for 20261114-234528-01e8 and does not rebuild it or release key shares. Share the indicators.
11. **Privacy officer:** record that no real PHI or secrets were exposed and that a staff credential was compromised. Revisit if steps 4 or 8 find other access.
12. **MayaJaal operators + Eastbank IAM:** once intelligence gathering is done, end the decoy session so it looks like an ordinary failure and finish the password change. Label the session as a test if step 2 confirms one.
13. **Threat intel:** publish the indicators and the request pattern, noting that the address cannot identify anyone.
14. **SOC + Eastbank IAM:** review controls (script clients at clinical-role login, the untagged DocumentReference collection).

## Open questions
- True origin behind 127.0.0.1: unknown.
- Was this a red-team or test run (fixture-red-01 / static / baseline)? Unknown.
- How n.okafor's credentials were stolen: unknown.
- Exfiltration channel and destination: unknown.
- Whether the trackers or lures will be used later: unknown (no use yet).
- Prompt injection: none found in any attacker-supplied path, query, file name or client string.
