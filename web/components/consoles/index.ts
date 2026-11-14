// War Room consoles. Client components that read the shared store (web/lib/events.ts).
// Call connectHub() once in a top-level client component before rendering these.

export { AttackerTerminal, type AttackerTerminalProps } from "./AttackerTerminal";
export { DefenderPanel, type DefenderPanelProps } from "./DefenderPanel";
export { EventTimeline, keyEvents, type EventTimelineProps, type KeyEvent } from "./EventTimeline";
export { TheReveal, type TheRevealProps } from "./TheReveal";
export { ContinuityHUD, useHasContinuity, type ContinuityHUDProps } from "./ContinuityHUD";
export { WarRoomSound, SoundButton, playRevealCue } from "./Sound";
export {
  RunBadge, StreamStatus, ColumnHeading, runHonesty, useAttackerFacts, clock, formatBytes, hospitalName, hospitalShort,
} from "./ui";
