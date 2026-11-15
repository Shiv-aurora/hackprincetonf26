// JSX types for the MathML Core elements the research slides use (Chrome renders MathML natively;
// @types/react ships no MathML intrinsics). Local to the slides; attributes are passed through as-is.

import type { DetailedHTMLProps, HTMLAttributes } from "react";

type Bool = "true" | "false";

type MathMLProps = DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
  display?: "block" | "inline";
  displaystyle?: Bool;
  scriptlevel?: string;
  mathvariant?: "normal";
  stretchy?: Bool;
  fence?: Bool;
  separator?: Bool;
  largeop?: Bool;
  movablelimits?: Bool;
  symmetric?: Bool;
  accent?: Bool;
  accentunder?: Bool;
  lspace?: string;
  rspace?: string;
  form?: "prefix" | "infix" | "postfix";
  linethickness?: string;
  width?: string;
};

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      math: MathMLProps;
      mrow: MathMLProps;
      mi: MathMLProps;
      mn: MathMLProps;
      mo: MathMLProps;
      mtext: MathMLProps;
      mspace: MathMLProps;
      msub: MathMLProps;
      msup: MathMLProps;
      msubsup: MathMLProps;
      mfrac: MathMLProps;
      msqrt: MathMLProps;
      mover: MathMLProps;
      munder: MathMLProps;
      munderover: MathMLProps;
      mstyle: MathMLProps;
      mpadded: MathMLProps;
      mtable: MathMLProps;
      mtr: MathMLProps;
      mtd: MathMLProps;
    }
  }
}
