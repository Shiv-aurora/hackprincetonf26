// A small Markdown renderer for the investigator's own files (headings, lists, tables, code, bold, code
// spans). The content is model-written text about attacker-chosen strings, so it's rendered as text
// only: no HTML is ever injected.
import type { ReactNode } from "react";
import { cn } from "@/components/ui";

function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0, i = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) out.push(text.slice(last, m.index));
    const t = m[0];
    out.push(t.startsWith("**")
      ? <strong key={`${key}-${i++}`} className="font-semibold text-fg">{t.slice(2, -2)}</strong>
      : <code key={`${key}-${i++}`} className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[0.85em]">{t.slice(1, -1)}</code>);
    last = m.index! + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const cells = (row: string) => row.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());

export function Markdown({ text, className }: { text: string; className?: string }) {
  const lines = (text || "").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const k = `b${i}`;
    if (line.startsWith("```")) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) body.push(lines[i++]);
      i++;
      blocks.push(<pre key={k} className="overflow-x-auto rounded-lg border border-border bg-surface p-3 font-mono text-[12px] leading-relaxed">{body.join("\n")}</pre>);
      continue;
    }
    if (line.trim().startsWith("|") && lines[i + 1]?.trim().match(/^\|?[\s:-]+\|/)) {
      const head = cells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith("|")) rows.push(cells(lines[i++]));
      blocks.push(
        <div key={k} className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-left text-[13px]">
            <thead className="bg-surface text-fg-muted">
              <tr>{head.map((h, j) => <th key={j} className="px-3 py-2 font-medium">{inline(h, `${k}h${j}`)}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri} className="border-t border-border align-top">
                  {r.map((c, j) => <td key={j} className="px-3 py-2">{inline(c, `${k}${ri}${j}`)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>);
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)/);
    if (h) {
      const lvl = h[1].length;
      blocks.push(<p key={k} className={cn("font-semibold tracking-[-0.01em] text-fg",
        lvl <= 1 ? "text-[18px]" : lvl === 2 ? "mt-2 text-[15px]" : "text-[14px]")}>{inline(h[2], k)}</p>);
      i++;
      continue;
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const items: string[] = [];
      const ordered = /^\s*\d+\./.test(line);
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*([-*]|\d+\.)\s+/, ""));
      const L = ordered ? "ol" : "ul";
      blocks.push(<L key={k} className={cn("space-y-1 pl-5", ordered ? "list-decimal" : "list-disc")}>
        {items.map((t, j) => <li key={j}>{inline(t, `${k}${j}`)}</li>)}</L>);
      continue;
    }
    if (line.trim()) blocks.push(<p key={k}>{inline(line, k)}</p>);
    i++;
  }
  return <div className={cn("space-y-3 text-[14px] leading-relaxed text-fg-muted", className)}>{blocks}</div>;
}
