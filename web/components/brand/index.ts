// MayaJaal brand kit.
//   <Wordmark />            SVG wordmark (tone "duo" | "mono", animate to weave it in)
//   <Mark tile? />          J-knot icon
//   <Hero background={…} /> landing title sequence; `background` is the slot for the 3D city
//   <JaalCanvas />          the woven-net canvas on its own (imperative pulse("real" | "shadow"))
//   <LiveChip />            hub status / "Scripted demo" label
export { Wordmark, BRAND } from "./Wordmark";
export type { WordmarkProps } from "./Wordmark";
export { Mark } from "./Mark";
export type { MarkProps } from "./Mark";
export { Hero, PrimaryCTA, SecondaryCTA } from "./Hero";
export type { HeroProps } from "./Hero";
export { JaalCanvas } from "./JaalCanvas";
export type { JaalHandle, JaalCanvasProps } from "./JaalCanvas";
export { LiveChip, useRunLabel } from "./LiveChip";
export { Story } from "./Story";
