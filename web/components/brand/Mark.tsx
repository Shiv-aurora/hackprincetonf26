import { useId } from "react";
import { MARK } from "./glyphs";

const TEAL = "#2de2d0";
const CYAN = "#7cf3ff";
const VIOLET = "#8b5cf6";
const MAGENTA = "#d946ef";
const [TL, TR] = MARK.threadLines;

export interface MarkProps {
  className?: string;
  /** Draw on an ink tile (app icon / favicon look). */
  tile?: boolean;
  /** "duo" = brand colours, "mono" = currentColor. */
  tone?: "duo" | "mono";
  title?: string;
}

/** The MayaJaal mark: the J hanging from a knot where two net threads meet. */
export function Mark({ className, tile = false, tone = "duo", title = "MayaJaal" }: MarkProps) {
  const uid = useId().replace(/:/g, "");
  const duo = tone === "duo";
  const j = duo ? `url(#mk-j-${uid})` : "currentColor";
  return (
    <svg viewBox={MARK.viewBox} className={className} role="img" aria-label={title} fill="none"
      strokeLinecap="round" strokeLinejoin="round">
      <title>{title}</title>
      {duo && (
        <defs>
          <linearGradient id={`mk-j-${uid}`} gradientUnits="userSpaceOnUse" x1="35" y1="22" x2="20" y2="56">
            <stop offset="0" stopColor={CYAN} />
            <stop offset="0.5" stopColor={TEAL} />
            <stop offset="1" stopColor={VIOLET} />
          </linearGradient>
          <linearGradient id={`mk-tl-${uid}`} gradientUnits="userSpaceOnUse" x1={TL[0]} y1={TL[1]} x2={TL[2]} y2={TL[3]}>
            <stop offset="0" stopColor={VIOLET} stopOpacity="0.1" />
            <stop offset={MARK.knotAt} stopColor={MAGENTA} />
            <stop offset="1" stopColor={MAGENTA} stopOpacity="0" />
          </linearGradient>
          <linearGradient id={`mk-tr-${uid}`} gradientUnits="userSpaceOnUse" x1={TR[0]} y1={TR[1]} x2={TR[2]} y2={TR[3]}>
            <stop offset="0" stopColor={TEAL} stopOpacity="0.1" />
            <stop offset={MARK.knotAt} stopColor={CYAN} />
            <stop offset="1" stopColor={CYAN} stopOpacity="0" />
          </linearGradient>
          <radialGradient id={`mk-k-${uid}`}>
            <stop offset="0" stopColor="#fff" />
            <stop offset="0.6" stopColor={CYAN} />
            <stop offset="1" stopColor={TEAL} />
          </radialGradient>
        </defs>
      )}
      {tile && <rect x="0" y="0" width="64" height="64" rx="14" fill="#05070c" />}
      <path d={MARK.threads[0]} stroke={duo ? `url(#mk-tl-${uid})` : "currentColor"} strokeWidth={MARK.stroke * 0.42} />
      <path d={MARK.threads[1]} stroke={duo ? `url(#mk-tr-${uid})` : "currentColor"} strokeWidth={MARK.stroke * 0.42} />
      <path d={MARK.j} stroke={j} strokeWidth={MARK.stroke} />
      <circle cx={MARK.knot.x} cy={MARK.knot.y} r={MARK.knot.r} fill={duo ? `url(#mk-k-${uid})` : "currentColor"} />
    </svg>
  );
}
