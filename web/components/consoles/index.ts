// War Room consoles. All are client components that read the shared store (web/lib/events.ts).
// Call connectHub() once in a top-level client component before rendering these.

export { AttackerTerminal, type AttackerTerminalProps } from "./AttackerTerminal";
export { DefenderPanel, SessionBadge, CanaryLedger, type DefenderPanelProps } from "./DefenderPanel";
export { EventTimeline, chipFor, type EventTimelineProps, type TimelineChip } from "./EventTimeline";
export { TheReveal, useRevealTrigger, type TheRevealProps, type RevealPhase, type RevealTriggerOptions } from "./TheReveal";
export { ContinuityHUD, type ContinuityHUDProps } from "./ContinuityHUD";
export { RunBadge, runHonesty, Glass } from "./ui";
