// Small MathML helpers for the research slides. Chrome renders MathML Core natively; the font is STIX Two Math
// (bundled with macOS), so the equations look like the paper's and stay sharp at any projector size.

import type { ReactNode } from "react";
import { cn } from "@/components/ui";

/** A typeset formula, sized for a projector (36 px unless overridden). */
export function Tex({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <math className={cn("text-[36px] leading-none text-fg", className)} style={{ fontFamily: '"STIX Two Math", math' }}>
      {children}
    </math>
  );
}

/** ( … ) at text size. */
export function P({ children }: { children: ReactNode }) {
  return <mrow><mo stretchy="false">(</mo>{children}<mo stretchy="false">)</mo></mrow>;
}

/** p_b, the belief that the session is benign (upright b, as in the paper). */
export function Pb() {
  return <msub><mi>p</mi><mi mathvariant="normal">b</mi></msub>;
}
