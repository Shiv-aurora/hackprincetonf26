// Every number on the explainer slides, with its source. Nothing here is invented: each entry was checked
// against the linked page (Nov 14 2026). Keep the copy short; the presenter talks over it.
//
// NEWS     each item carries its own URL below
// DOWNTIME UMMC — https://www.hipaajournal.com/ummc-ransomware-attack/
//          Brockton — SecurityWeek, Apr 8 2026 — https://www.securityweek.com/massachusetts-hospital-diverts-ambulances-as-cyberattack-causes-disruption/
//          UNM — Albuquerque Journal, Oct 27 2026 — https://www.yahoo.com/news/us/articles/unm-health-system-targeted-cyberattack-030900998.html
// DATA
//  Prices  Flare, Jun 15 2026 (vendor estimate) — https://flare.io/learn/resources/blog/stolen-medical-records-fuel-black-market-fraud-identity-theft-patient-harm
//  $6.64M  IBM Cost of a Data Breach 2026 via HIPAA Journal — https://www.hipaajournal.com/2026-cost-data-breach-study-ibm/
// DOWNTIME
//  Synnovis Infosecurity Magazine, Jun 26 2025 — https://www.infosecurity-magazine.com/news/patient-death-linked-nhs-cyber/

export interface NewsItem { outlet: string; date: string; target: string; headline: string; what: string; url: string }

// Recent attacks on software and AI tooling (all opened and checked Nov 14 2026). Headlines are our own
// short summaries of each report, not the outlet's wording.
export const NEWS: NewsItem[] = [
  { outlet: "BleepingComputer", date: "Nov 14, 2026", target: "AI coding tools",
    headline: "Cursor breach ships a backdoored Claude Code extension",
    what: "Up to 5,000 developers installed it.",
    url: "https://bleepingcomputer.com/news/security/cursor-confirms-security-breach-led-to-malicious-claude-code-extension" },
  { outlet: "The Hacker News", date: "Nov 12, 2026", target: "GitHub · PyPI · npm",
    headline: "4,837 hijacked GitHub accounts plant a CI secret stealer",
    what: "1,806+ repositories; steals PyPI and npm publish tokens.",
    url: "https://thehackernews.com/2026/11/4837-hijacked-github-accounts-ran-ci.html" },
  { outlet: "BleepingComputer", date: "Nov 10, 2026", target: "Railway",
    headline: "Railway breach: $740,000 in fraudulent AI charges",
    what: "Up to 100,000 workspaces may be exposed.",
    url: "https://www.bleepingcomputer.com/news/apple/railway-breach-leads-to-740-000-in-fraudulent-ai-charges/" },
  { outlet: "Help Net Security", date: "Nov 3, 2026", target: "AI attack agents",
    headline: "An AI agent framework hits 200+ organizations in 11 days",
    what: "China-linked group, per CrowdStrike.",
    url: "https://www.helpnetsecurity.com/2026/11/03/ai-powered-cyberattacks-artex-cyberstrikeai/" },
  { outlet: "BleepingComputer", date: "Oct 31, 2026", target: "Northflank",
    headline: "Northflank breached; customers' AI API keys abused",
    what: "One of 9+ AI dev platforms hit in a month (Wiz).",
    url: "https://www.bleepingcomputer.com/news/security/northflank-security-breach-leads-to-abuse-of-customers-ai-api-keys/" },
  { outlet: "The Hacker News", date: "Oct 21, 2026", target: "PyPI",
    headline: "LiteLLM on PyPI hijacked to ship a credential stealer",
    what: "Supply-chain attack with a backdoor.",
    url: "https://thehackernews.com/2026/10/litellm-compromised-in-supply-chain.html" },
  { outlet: "The Hacker News", date: "Oct 19, 2026", target: "OpenCode",
    headline: "OpenCode Console breach may have exposed AI API keys",
    what: "OpenAI, Anthropic and Google keys at risk.",
    url: "https://thehackernews.com/2026/10/opencode-console-breach-may-have.html" },
  { outlet: "The Next Web", date: "Oct 19, 2026", target: "AI attack agents",
    headline: "One hacker's AI agents break into 100+ companies, ~$50 each",
    what: "Researcher's findings; not independently verified by TNW.",
    url: "https://thenextweb.com/news/ai-agents-hacker-cairn-100-sites-deere-norforge" },
];

export const DATA = {
  price: { record: "$250–1,000", card: "~$5", cardPct: 2, source: "Flare (2026, market estimates)" },
  breach: { value: "$6.64M", label: "average cost of a healthcare breach. The highest of any industry.", source: "IBM Cost of a Data Breach 2026" },
};

export const DOWNTIME = {
  hospitals: [
    { date: "Jun 2024", who: "Synnovis lab, London", what: "10,152 appointments postponed. A death linked to a delayed blood test." },
    { date: "Feb 2026", who: "UMMC, Mississippi", what: "Records system down. Paper charts, surgeries cancelled." },
    { date: "Apr 2026", who: "Brockton Hospital, MA", what: "Ambulances diverted, chemotherapy cancelled." },
    { date: "Oct 26, 2026", who: "UNM Health, New Mexico", what: "Appointments cancelled at 30+ clinics." },
  ],
  sources: "NHS England via Infosecurity Magazine (2025) · HIPAA Journal · SecurityWeek (Apr 2026) · Albuquerque Journal (Oct 2026)",
};
