import { Logo } from "@/components/ui";

export interface WordmarkProps {
  className?: string;
}

/** The MayaJaal wordmark: mark + name, exactly as drawn by the shared `Logo`. */
export function Wordmark({ className }: WordmarkProps) {
  return <Logo className={className} />;
}

export const BRAND = {
  name: "MayaJaal",
  tagline: "The breach is real. The data isn't.",
} as const;
