// MayaJaal UI primitives — Vercel/Geist monochrome. Owned by the integrator.
// Use these everywhere instead of hand-rolled styles. No glow, no gradients, no blur.
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...a: Parameters<typeof clsx>) {
  return twMerge(clsx(...a));
}

/** The illusion eye. Artwork: "Mangekyou Sharingan Itachi.svg" by ShounenSuki, CC BY-SA 3.0, via
 *  Wikimedia Commons (https://commons.wikimedia.org/wiki/File:Mangekyou_Sharingan_Itachi.svg).
 *  Converted to JSX with a viewBox; shapes and colours unchanged. Credited in the landing footer. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 300 300" aria-hidden="true" focusable="false" className={cn("size-5 shrink-0", className)}>
      <defs>
        <radialGradient id="mj-sharingan-gr">
          <stop offset="0" stopColor="#660000" />
          <stop offset="0.5" stopColor="#c30000" />
          <stop offset="1" stopColor="#a00000" />
        </radialGradient>
      </defs>
      <circle cx="150" cy="150" r="145" fill="url(#mj-sharingan-gr)" stroke="#000" strokeWidth={10} />
      <path fill="#000" d="M 177.6,10.7 C 135,68.4 155.4,100.7 179.8,118.5 C 260.9,160.6 274.8,214.5 255.9,244.9 C 237.3,191.9 198,172.4 158.5,194.9 C 86.9,238.6 40.7,231.2 15.7,196.6 C 58.2,203.1 109.1,193.5 107.9,128.3 C 109.5,97.6 111.5,16.6 177.6,10.7 z" />
      <circle cx="150" cy="150" r="20" fill="#a00000" />
    </svg>
  );
}

/** The mark plus the name, set in Geist. */
export function Logo({ className }: { className?: string; label?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2 text-[15px] font-semibold tracking-[-0.02em] text-fg", className)}>
      <LogoMark />
      MayaJaal
    </span>
  );
}

const NAV = [
  { href: "/#how", label: "How it works" },
  { href: "/demo", label: "Demo" },
  { href: "/war-room", label: "Live" },
  { href: "/mirage.pdf", label: "Paper" },
];

/** Landing navigation: a floating rounded bar, centered. Hairline border, no blur, no shadow glow. */
export function FloatingNav({ cta }: { cta?: ReactNode }) {
  return (
    <div className="pointer-events-none fixed inset-x-0 top-4 z-40 flex justify-center px-4">
      <nav className="pointer-events-auto flex h-12 w-full max-w-[680px] items-center gap-1 rounded-full border border-border bg-background/95 pr-1.5 pl-5">
        <Link href="/" aria-label="MayaJaal home"
          className="mr-3 inline-flex items-center gap-2 text-[15px] font-semibold tracking-[-0.02em] text-fg">
          <LogoMark />
          MayaJaal
        </Link>
        <div className="hidden items-center sm:flex">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href}
              className="rounded-full px-3 py-1.5 text-[13px] text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg">
              {n.label}
            </Link>
          ))}
        </div>
        <div className="ml-auto">{cta}</div>
      </nav>
    </div>
  );
}

/** Top bar used on every page. `right` is for page-specific controls (status dot, sound toggle). */
export function SiteHeader({ active, right, className }: { active?: string; right?: ReactNode; className?: string }) {
  return (
    <header className={cn("sticky top-0 z-30 border-b border-border bg-background/95", className)}>
      <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-6 px-4 sm:px-6">
        <Link href="/" aria-label="MayaJaal home"><Logo /></Link>
        <nav className="hidden items-center gap-1 md:flex">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href}
              className={cn("rounded-md px-2.5 py-1.5 text-sm text-fg-muted transition-colors hover:text-fg",
                active === n.href && "text-fg")}>
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3">{right}</div>
      </div>
    </header>
  );
}

type BtnVariant = "primary" | "secondary" | "ghost";
const BTN: Record<BtnVariant, string> = {
  primary: "bg-fg text-background hover:opacity-90",
  secondary: "border border-border bg-background text-fg hover:bg-surface-2",
  ghost: "text-fg-muted hover:text-fg hover:bg-surface-2",
};

export function Button({ variant = "secondary", size = "md", className, ...p }:
  ComponentProps<"button"> & { variant?: BtnVariant; size?: "sm" | "md" }) {
  return (
    <button {...p} className={cn(
      "inline-flex items-center justify-center gap-2 rounded-md font-medium transition-[background,opacity,color] disabled:pointer-events-none disabled:opacity-50",
      size === "sm" ? "h-8 px-3 text-[13px]" : "h-10 px-4 text-sm", BTN[variant], className)} />
  );
}

export function ButtonLink({ href, variant = "secondary", size = "md", className, children }:
  { href: string; variant?: BtnVariant; size?: "sm" | "md"; className?: string; children: ReactNode }) {
  return (
    <Link href={href} className={cn(
      "inline-flex items-center justify-center gap-2 rounded-md font-medium transition-[background,opacity,color]",
      size === "sm" ? "h-8 px-3 text-[13px]" : "h-10 px-4 text-sm", BTN[variant], className)}>
      {children}
    </Link>
  );
}

/** Bordered surface. `title` renders a small header row. */
export function Card({ title, action, className, bodyClassName, children }:
  { title?: ReactNode; action?: ReactNode; className?: string; bodyClassName?: string; children: ReactNode }) {
  return (
    <section className={cn("flex min-h-0 flex-col rounded-lg border border-border bg-background", className)}>
      {title !== undefined && (
        <div className="flex h-10 shrink-0 items-center justify-between border-b border-border px-4">
          <h3 className="text-[13px] font-medium text-fg">{title}</h3>
          {action}
        </div>
      )}
      <div className={cn("min-h-0 flex-1 p-4", bodyClassName)}>{children}</div>
    </section>
  );
}

type Tone = "neutral" | "shadow" | "alert" | "danger" | "ok";
const BADGE: Record<Tone, string> = {
  neutral: "border-border text-fg-muted",
  shadow: "border-shadow/30 bg-shadow-bg text-shadow",
  alert: "border-alert/30 bg-alert-bg text-alert",
  danger: "border-danger/40 text-danger",
  ok: "border-ok/30 text-ok",
};

export function Badge({ tone = "neutral", className, children }: { tone?: Tone; className?: string; children: ReactNode }) {
  return (
    <span className={cn("inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium", BADGE[tone], className)}>
      {children}
    </span>
  );
}

export function Dot({ tone = "neutral", pulse, className }: { tone?: Tone; pulse?: boolean; className?: string }) {
  const c = { neutral: "bg-fg-subtle", shadow: "bg-shadow", alert: "bg-alert", danger: "bg-danger", ok: "bg-ok" }[tone];
  return (
    <span className={cn("relative inline-flex size-2", className)}>
      {pulse && <span className={cn("absolute inline-flex size-full animate-ping rounded-full opacity-60", c)} />}
      <span className={cn("relative inline-flex size-2 rounded-full", c)} />
    </span>
  );
}

/** Big number with a label. Use tabular numbers. */
export function Stat({ label, value, sub, tone = "neutral", className }:
  { label: ReactNode; value: ReactNode; sub?: ReactNode; tone?: Tone; className?: string }) {
  const v = { neutral: "text-fg", shadow: "text-shadow", alert: "text-alert", danger: "text-danger", ok: "text-ok" }[tone];
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <span className="text-[13px] text-fg-muted">{label}</span>
      <span className={cn("text-3xl font-semibold tracking-[-0.03em] tabular-nums", v)}>{value}</span>
      {sub && <span className="text-xs text-fg-subtle">{sub}</span>}
    </div>
  );
}

/** Small uppercase-free section label, Geist style. */
export function Label({ className, children }: { className?: string; children: ReactNode }) {
  return <p className={cn("text-[13px] font-medium text-fg-muted", className)}>{children}</p>;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-border bg-surface px-1.5 font-mono text-[11px] text-fg-muted">{children}</kbd>;
}
