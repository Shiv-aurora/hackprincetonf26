import { Logo, cn } from "@/components/ui";

export interface MarkProps {
  className?: string;
}

/** The MayaJaal mark on its own (a 3×3 net in a rounded square). Monochrome, inherits currentColor.
 *  Kept for older imports; new code should use `<Logo label={false} />` from components/ui. */
export function Mark({ className }: MarkProps) {
  return <Logo label={false} className={cn("[&>svg]:size-full", className)} />;
}
