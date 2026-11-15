// A small Markdown renderer for the investigator's own files: headings, paragraphs, ordered and bulleted
// lists (numbering survives blank lines, indented items nest), tables, code blocks, bold, italics and code
// spans. The content is model-written text about attacker-chosen strings, so it is rendered as text only:
// no HTML is ever injected.
import type { ReactNode } from "react";
import { cn } from "@/components/ui";

function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|(?<![\w*])_[^_\n]+_(?![\w])|(?<![\w*])\*[^*\n]+\*(?![\w*]))/g;
  let last = 0, i = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) out.push(text.slice(last, m.index));
    const t = m[0], k = `${key}-${i++}`;
    if (t.startsWith("**")) out.push(<strong key={k} className="font-semibold text-fg">{t.slice(2, -2)}</strong>);
    else if (t.startsWith("`")) out.push(<code key={k} className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[0.85em] text-fg">{t.slice(1, -1)}</code>);
    else out.push(<em key={k}>{t.slice(1, -1)}</em>);
    last = m.index! + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const cells = (row: string) => row.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
const LIST = /^(\s*)([-*]|\d+\.)\s+(.*)$/;

interface Item { text: string; children: string[] }

/** Collect a list starting at lines[i]. Blank lines between items of the same kind keep the list going;
 *  items indented under another become its children. Returns the items and the next line index. */
function collectList(lines: string[], i: number) {
  const first = lines[i].match(LIST)!;
  const ordered = /\d/.test(first[2]);
  const start = ordered ? parseInt(first[2], 10) : 1;
  const baseIndent = first[1].length;
  const items: Item[] = [];
  while (i < lines.length) {
    const m = lines[i].match(LIST);
    if (m) {
      const indent = m[1].length;
      if (indent > baseIndent && items.length) items[items.length - 1].children.push(m[3]);
      else if (/\d/.test(m[2]) === ordered) items.push({ text: m[3], children: [] });
      else break;
      i++;
      continue;
    }
    if (!lines[i].trim()) {                                  // blank: continue only if the list resumes
      let j = i;
      while (j < lines.length && !lines[j].trim()) j++;
      const n = lines[j]?.match(LIST);
      if (n && (n[1].length > baseIndent || /\d/.test(n[2]) === ordered)) { i = j; continue; }
    }
    break;
  }
  return { items, ordered, start, next: i };
}

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
      blocks.push(<pre key={k} className="overflow-x-auto rounded-lg border border-border bg-surface p-3 font-mono text-[12px] leading-relaxed text-fg">{body.join("\n")}</pre>);
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
      blocks.push(<p key={k} className={cn("font-semibold text-fg",
        lvl <= 1 ? "text-[20px] tracking-[-0.025em]" : lvl === 2 ? "pt-2 text-[16px] tracking-[-0.02em]" : "text-[14px]")}>
        {inline(h[2], k)}</p>);
      i++;
      continue;
    }
    if (LIST.test(line)) {
      const { items, ordered, start, next } = collectList(lines, i);
      const L = ordered ? "ol" : "ul";
      blocks.push(
        <L key={k} start={ordered ? start : undefined} className={cn("space-y-1.5 pl-5 marker:text-fg-subtle", ordered ? "list-decimal" : "list-disc")}>
          {items.map((it, j) => (
            <li key={j} className="pl-1">
              {inline(it.text, `${k}${j}`)}
              {it.children.length > 0 && (
                <ul className="mt-1.5 list-[circle] space-y-1 pl-5">
                  {it.children.map((c, ci) => <li key={ci}>{inline(c, `${k}${j}c${ci}`)}</li>)}
                </ul>
              )}
            </li>
          ))}
        </L>);
      i = next;
      continue;
    }
    if (line.trim()) blocks.push(<p key={k}>{inline(line, k)}</p>);
    i++;
  }
  return <div className={cn("space-y-3 text-[14px] leading-relaxed text-fg-muted", className)}>{blocks}</div>;
}
