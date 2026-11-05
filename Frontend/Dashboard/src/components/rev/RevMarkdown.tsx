import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Check, Copy, X } from "lucide-react";
import { revTokens, type RevTone } from "@/lib/revTokens";
import { copyTextToClipboard, tableToCsv, tableToMarkdown } from "@/lib/revTableExport";

/**
 * Small, dependency-free renderer for the markdown Rev is allowed to return.
 * It never injects HTML: every node is constructed from plain text and only
 * http(s) links are clickable.
 *
 * v2 (ChatGPT-UI study adoption):
 * - fence-aware block splitting, so fenced code renders as a code surface
 *   (language label + copy) instead of raw backticks, even when a block
 *   contains blank lines or the closing fence never arrived;
 * - table toolbar with Copy CSV / Copy Markdown (rendered-value CSV, RFC 4180
 *   escaping; verbatim markdown source) — merchants export order tables;
 * - `streaming` suppresses every interactive affordance until the answer is
 *   complete (interactions-disabled-while-streaming pattern);
 * - per-block memoization: unchanged blocks skip re-render entirely when the
 *   host re-renders (tail-only work — the streaming-renderer discipline).
 */

function safeUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    return ["https:", "http:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function inline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let index = 0;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const token = match[0];
    const key = `${keyPrefix}-${index++}`;
    if (token.startsWith("**")) {
      nodes.push(<strong key={key} style={{ fontWeight: 650 }}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("*")) {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    } else if (token.startsWith("`")) {
      nodes.push(
        <code key={key} data-rev-inline-code style={{
          fontFamily: "ui-monospace, SFMono-Regular, monospace",
          background: "rgba(31,6,172,0.08)", padding: "1px 5px",
          borderRadius: 4, fontSize: "0.88em",
        }}>{token.slice(1, -1)}</code>,
      );
    } else {
      const linkMatch = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      const href = linkMatch ? safeUrl(linkMatch[2]) : null;
      if (linkMatch && href) {
        nodes.push(
          <a key={key} href={href} target="_blank" rel="noopener noreferrer"
            style={{ color: "inherit", textDecoration: "underline", textUnderlineOffset: 2 }}>
            {linkMatch[1]}
          </a>
        );
      } else {
        nodes.push(token);
      }
    }
    last = match.index + token.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

interface Props {
  text: string;
  tone?: RevTone;
  /** True while the turn is still running: interactive affordances stay hidden. */
  streaming?: boolean;
}

/**
 * Split text into top-level blocks on blank lines, but treat fenced code as
 * one atomic block: a code sample containing blank lines must not shatter
 * into paragraphs, and an unclosed fence (a truncated answer) still renders
 * as code rather than raw backticks.
 */
export function splitRevBlocks(text: string): string[] {
  const blocks: string[] = [];
  let current: string[] = [];
  let inFence = false;
  const flush = () => {
    if (current.length) blocks.push(current.join("\n"));
    current = [];
  };
  for (const line of text.split("\n")) {
    if (/^\s*```/.test(line)) {
      if (!inFence) {
        flush();
        inFence = true;
        current.push(line);
      } else {
        current.push(line);
        inFence = false;
        flush();
      }
      continue;
    }
    if (inFence) {
      current.push(line);
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    current.push(line);
  }
  flush();
  return blocks;
}

function isTableBlock(lines: string[]): boolean {
  if (lines.length < 2) return false;
  return lines[0].includes("|") && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[1]);
}

/** Honest copy button: reports "Copied" only when the platform confirmed the write. */
function CopyButton({ value, label, tone }: { value: string; label: string; tone: RevTone }) {
  const t = revTokens(tone);
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<number | null>(null);
  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
  }, []);
  const onClick = () => {
    void copyTextToClipboard(value).then(ok => {
      setState(ok ? "copied" : "failed");
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setState("idle"), 2000);
    });
  };
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="inline-flex min-h-11 items-center gap-1"
      style={{
        fontSize: "0.68rem", fontWeight: 650, color: t.muted,
        background: "transparent", border: "none", cursor: "pointer", padding: "0 4px",
      }}
    >
      {state === "idle" ? <Copy size={12} aria-hidden="true" />
        : state === "copied" ? <Check size={12} aria-hidden="true" />
        : <X size={12} aria-hidden="true" />}
      {state === "idle" ? label : state === "copied" ? "Copied" : "Copy failed"}
    </button>
  );
}

/** Fenced code: header bar (language label + copy) over a scrolling <pre>. */
function CodeBlock({ lines, tone, streaming }: { lines: string[]; tone: RevTone; streaming: boolean }) {
  const t = revTokens(tone);
  const lang = (lines[0] ?? "").replace(/^\s*```/, "").trim();
  let body = lines.slice(1);
  if (body.length && /^\s*```\s*$/.test(body[body.length - 1])) body = body.slice(0, -1);
  const code = body.join("\n");
  return (
    <figure data-rev-code-block style={{
      margin: 0, border: `1px solid ${t.border}`, borderRadius: 10,
      overflow: "hidden", background: t.codeBg,
    }}>
      <figcaption className="flex items-center gap-2" style={{
        padding: "0 10px", background: t.codeHeaderBg, borderBottom: `1px solid ${t.border}`,
      }}>
        <span style={{ fontSize: "0.68rem", fontWeight: 700, color: t.muted }}>{lang || "code"}</span>
        {!streaming && (
          <span style={{ marginLeft: "auto" }}>
            <CopyButton value={code} label="Copy code" tone={tone} />
          </span>
        )}
      </figcaption>
      <pre style={{ margin: 0, padding: "10px 12px", overflowX: "auto" }}>
        <code style={{
          fontFamily: "ui-monospace, SFMono-Regular, monospace",
          fontSize: "0.8rem", lineHeight: 1.6, color: t.codeFg, whiteSpace: "pre",
        }}>{code}</code>
      </pre>
    </figure>
  );
}

const Block = memo(function Block({ block, tone, streaming }: { block: string; tone: RevTone; streaming: boolean }) {
  const t = revTokens(tone);
  const rawLines = block.split("\n");
  if (/^\s*```/.test(rawLines[0])) {
    return <CodeBlock lines={rawLines} tone={tone} streaming={streaming} />;
  }
  const lines = rawLines.filter((line) => line.trim());
  if (!lines.length) return null;
  const first = lines[0];

  if (first.startsWith("### ")) {
    return (
      <h4 style={{ color: t.body, fontSize: "0.88rem", fontWeight: 650, margin: 0 }}>
        {inline(first.slice(4), "h4")}
      </h4>
    );
  }
  if (first.startsWith("## ")) {
    return (
      <div>
        <h3 style={{
          color: t.body, fontSize: "0.95rem", fontWeight: 700,
          margin: "0 0 6px",
        }}>
          {inline(first.slice(3), "h3")}
        </h3>
        {lines.slice(1).length > 0 && (
          <div className="flex flex-col gap-2" style={{ color: t.body, fontSize: "0.95rem", lineHeight: 1.65 }}>
            {lines.slice(1).map((line, index) => (
              <p key={index} style={{ margin: 0 }}>{inline(line, `p-${index}`)}</p>
            ))}
          </div>
        )}
      </div>
    );
  }
  if (first.startsWith("# ")) {
    return (
      <h2 style={{
        color: t.body, fontSize: "1.12rem", fontWeight: 750,
        letterSpacing: "-0.01em", margin: 0,
      }}>
        {inline(first.slice(2), "h2")}
      </h2>
    );
  }
  if (isTableBlock(lines)) {
    const rows = lines
      .filter((line, index) => index !== 1)
      .map((line) => line.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((cell) => cell.trim()));
    const [head, ...body] = rows;
    return (
      <div>
        {!streaming && (
          <div className="flex flex-wrap items-center gap-1" data-rev-table-toolbar style={{ marginBottom: 2 }}>
            <CopyButton value={tableToCsv(rows)} label="Copy CSV" tone={tone} />
            <CopyButton value={tableToMarkdown(lines)} label="Copy Markdown" tone={tone} />
          </div>
        )}
        <div style={{ overflowX: "auto", border: `1px solid ${t.border}`, borderRadius: 10 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
            <thead>
              <tr style={{ background: t.tableHeadBg }}>
                {head.map((cell, index) => (
                  <th key={index} scope="col" style={{ textAlign: "left", padding: "9px 12px", color: t.muted, fontWeight: 650 }}>
                    {cell}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {body.map((row, rowIndex) => (
                <tr key={rowIndex} style={{ borderTop: `1px solid ${t.border}` }}>
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex} style={{ padding: "9px 12px", color: t.body }}>
                      {inline(cell, `cell-${rowIndex}-${cellIndex}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }
  if (lines.every((line) => /^\s*[-*]\s+/.test(line))) {
    return (
      <ul style={{ margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 6 }}>
        {lines.map((line, index) => (
          <li key={index} style={{ color: t.body, fontSize: "0.95rem", lineHeight: 1.65 }}>
            {inline(line.replace(/^\s*[-*]\s+/, ""), `li-${index}`)}
          </li>
        ))}
      </ul>
    );
  }
  if (lines.every((line) => /^\s*\d+[.)]\s+/.test(line))) {
    return (
      <ol style={{ margin: 0, paddingLeft: 22, display: "flex", flexDirection: "column", gap: 8 }}>
        {lines.map((line, index) => (
          <li key={index} style={{ color: t.body, fontSize: "0.95rem", lineHeight: 1.65 }}>
            {inline(line.replace(/^\s*\d+[.)]\s+/, ""), `oli-${index}`)}
          </li>
        ))}
      </ol>
    );
  }
  if (lines.every((line) => line.startsWith("> "))) {
    return (
      <blockquote style={{
        margin: 0, padding: "10px 14px", borderLeft: `3px solid ${t.accent}`,
        background: t.accentSoft,
        borderRadius: "0 8px 8px 0", color: t.body, fontSize: "0.93rem", lineHeight: 1.6,
      }}>
        {lines.map((line, index) => (
          <p key={index} style={{ margin: index ? "6px 0 0" : 0 }}>
            {inline(line.replace(/^>\s+/, ""), `q-${index}`)}
          </p>
        ))}
      </blockquote>
    );
  }
  return (
    <div className="flex flex-col gap-2" style={{ color: t.body, fontSize: "0.95rem", lineHeight: 1.7 }}>
      {lines.map((line, index) => {
        if (/^\s*[-*]\s+/.test(line)) {
          return (
            <div key={index} style={{ display: "flex", gap: 8 }}>
              <span style={{ color: t.accent, flexShrink: 0, marginTop: 2 }}>•</span>
              <span>{inline(line.replace(/^\s*[-*]\s+/, ""), `mix-${index}`)}</span>
            </div>
          );
        }
        return <p key={index} style={{ margin: 0 }}>{inline(line, `plain-${index}`)}</p>;
      })}
    </div>
  );
});

export function RevMarkdown({ text, tone = "light", streaming = false }: Props) {
  const blocks = useMemo(() => splitRevBlocks(text), [text]);

  return (
    <div className="flex flex-col gap-4" data-testid="rev-markdown">
      {blocks.map((block, blockIndex) => (
        <Block key={blockIndex} block={block} tone={tone} streaming={streaming} />
      ))}
    </div>
  );
}

export default RevMarkdown;
