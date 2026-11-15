// Every number on the explainer slides, with its source. Nothing here is invented: each entry was checked
// against the linked page (Nov 14 2026). Keep the copy short; the presenter talks over it.
//
// THREAT
//  80–90%  Anthropic, Nov 13 2025 — https://www.anthropic.com/news/disrupting-AI-espionage
//  200+    Help Net Security, Nov 3 2026 (CrowdStrike: "ARTEX", 200+ orgs, 14+ countries, 11 days)
//          https://www.helpnetsecurity.com/2026/11/03/ai-powered-cyberattacks-artex-cyberstrikeai/
//  ~$50    The Next Web, Oct 19 2026 (Cairn: ~$5,000 in tokens, 100+ companies breached)
//          https://thenextweb.com/news/ai-agents-hacker-cairn-100-sites-deere-norforge
//  UMMC    HIPAA Journal — https://www.hipaajournal.com/ummc-ransomware-attack/
//  Brockton SecurityWeek, Apr 8 2026 — https://www.securityweek.com/massachusetts-hospital-diverts-ambulances-as-cyberattack-causes-disruption/
//  UNM     Albuquerque Journal, Oct 27 2026 — https://www.yahoo.com/news/us/articles/unm-health-system-targeted-cyberattack-030900998.html
// DATA
//  Prices  Flare, Jun 15 2026 (vendor estimate) — https://flare.io/learn/resources/blog/stolen-medical-records-fuel-black-market-fraud-identity-theft-patient-harm
//  $6.64M  IBM Cost of a Data Breach 2026 via HIPAA Journal — https://www.hipaajournal.com/2026-cost-data-breach-study-ibm/
// DOWNTIME
//  Synnovis Infosecurity Magazine, Jun 26 2025 — https://www.infosecurity-magazine.com/news/patient-death-linked-nhs-cyber/

export interface Incident { date: string; who: string; what: string }

export const THREAT = {
  stats: [
    { value: "80–90%", label: "of a state hacking campaign done by an AI agent (2025)" },
    { value: "200+", label: "organizations hit in 11 days by one AI attack framework" },
    { value: "~$50", label: "in AI costs per company broken into" },
  ],
  incidents: [
    { date: "Feb 2026", who: "UMMC, Mississippi", what: "Records system down. Paper charts, surgeries cancelled." },
    { date: "Apr 2026", who: "Brockton Hospital, MA", what: "Ambulances diverted, chemotherapy cancelled." },
    { date: "Oct 26, 2026", who: "UNM Health, New Mexico", what: "Appointments cancelled at 30+ clinics." },
  ] as Incident[],
  sources: "Anthropic (Nov 2025) · Help Net Security (Nov 3 2026) · The Next Web (Oct 19 2026) · HIPAA Journal · SecurityWeek · Albuquerque Journal",
};

export const DATA = {
  price: { record: "$250–1,000", card: "~$5", cardPct: 2, source: "Flare (2026, market estimates)" },
  breach: { value: "$6.64M", label: "average cost of a healthcare breach. The highest of any industry.", source: "IBM Cost of a Data Breach 2026" },
};

export const DOWNTIME = {
  case: { name: "Synnovis lab, London", when: "June 2024", source: "NHS England figures via Infosecurity Magazine (2025)" },
  impacts: [
    { value: "10,152", label: "outpatient appointments postponed" },
    { value: "1,710", label: "operations and procedures postponed" },
    { value: "1", label: "patient death linked to a delayed blood test" },
  ],
};
