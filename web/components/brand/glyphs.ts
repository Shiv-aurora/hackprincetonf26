// Geometry for the MayaJaal wordmark: a monoline, geometric face drawn as single threads with round
// caps, so every letter can literally be "woven" in (stroke-draw animation).
//
// Grid: cap height 0..100, x-height 36..100, descender to 132. Stroke 8. The J hangs from a knot in
// the net: two hairline threads meet in a knot above its stem.

export const STROKE = 8;
export const VIEWBOX = { x: -6, y: -34, w: 572, h: 176 };

const bowlA = (cx: number) =>
  // single-storey a: bowl (counter-clockwise from 3 o'clock) + stem
  `M${cx + 28} 68 A28 28 0 1 0 ${cx - 28} 68 A28 28 0 1 0 ${cx + 28} 68 M${cx + 28} 40 V96`;

export const JX = 372; // J stem x
export const KNOT = { x: JX, y: 2 };

/** Letters of "Maya" and "aal" (the J is separate). Order = draw order. */
export const LETTERS: { id: string; d: string; group: "maya" | "jaal" }[] = [
  { id: "M", d: "M4 96 V6 L40 70 L76 6 V96", group: "maya" },
  { id: "a1", d: bowlA(128), group: "maya" },
  { id: "y", d: "M180 40 L207 97 M234 40 L192 132", group: "maya" },
  { id: "a2", d: bowlA(286), group: "maya" },
  { id: "a3", d: bowlA(424), group: "jaal" },
  { id: "a4", d: bowlA(504), group: "jaal" },
  { id: "l", d: "M556 4 V96", group: "jaal" },
];

/** The J stem + hook, starting at the knot. */
export const J_PATH = `M${JX} ${KNOT.y + 8} V74 A22 22 0 0 1 ${JX - 44} 74`;

/** Two hairline net threads crossing at the knot (they fade out away from it). [x1, y1, x2, y2] */
export const J_THREAD_LINES: [number, number, number, number][] = [
  [JX - 34, KNOT.y - 32, JX + 12, KNOT.y + 11.3],
  [JX + 34, KNOT.y - 32, JX - 12, KNOT.y + 11.3],
];
/** Where along each thread the knot sits (0..1), for gradients. */
export const KNOT_AT = 46.7 / 63.2;
export const J_THREADS = J_THREAD_LINES.map(([x1, y1, x2, y2]) => `M${x1} ${y1} L${x2} ${y2}`);

// ---------------------------------------------------------------- mark (icon), 64 × 64 grid

/** Standalone J-knot mark. Same construction, scaled to an icon. */
export const MARK = {
  viewBox: "0 0 64 64",
  threads: ["M14 6 L41.4 26.9", "M56 6 L28.6 26.9"],
  threadLines: [[14, 6, 41.4, 26.9], [56, 6, 28.6, 26.9]] as [number, number, number, number][],
  knotAt: 26.4 / 34.4,
  knot: { x: 35, y: 22, r: 4.2 },
  j: "M35 27 V44 A10.5 10.5 0 0 1 14 44",
  stroke: 5.2,
};
