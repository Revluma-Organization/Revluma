import type { ReactNode } from "react";

/**
 * Small, dependency-free renderer for the markdown Rev is allowed to return.
 * It never injects HTML: every node is constructed from plain text and only
 * http(s) links are clickable.
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
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let index = 0;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const token = match[0];
    const key = `${keyPrefix}-${index++}`;
    if (token.startsWith("**")) {
      nodes.push(<strong key={key} style={{ fontWeight: 650 }}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("`")) {
      nodes.push(
        <code key={key} style={{
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
            style={{ color: "#1F06AC", textDecoration: "underline", textUnderlineOffset: 2 }}>
            {linkMatch[1]}
          </a>,
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
  tone?: "light" | "dark";
}

function isTableBlock(lines: string[]): boolean {
  if (lines.length < 2) return false;
  return lines[0].includes("|") && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[1]);
}

export function RevMarkdown({ text, tone = "light" }: Props) {
  const dark = tone === "dark";
  const bodyColor = dark ? "#E7EAF3" : "#101828";
  const mutedColor = dark ? "#9AA3B2" : "#667085";
  const ruleColor = dark ? "rgba(255,255,255,0.08)" : "#EAECF0";
  const blocks = text.split(/\n{2,}/).filter((block) => block.trim());

  return (
    <div className="flex flex-col gap-4" data-testid="rev-markdown">
      {blocks.map((block, blockIndex) => {
        const lines = block.split("\n").filter((line) => line.trim());
        if (!lines.length) return null;
        const first = lines[0];

        if (first.startsWith("### ")) {
          return (
            <h4 key={blockIndex} style={{ color: bodyColor, fontSize: "0.95rem", fontWeight: 700, margin: 0 }}>
              {inline(first.slice(4), `h4-${blockIndex}`)}
            </h4>
          );
        }
        if (first.startsWith("## ")) {
          return (
            <div key={blockIndex}>
              <h3 style={{
                color: bodyColor, fontSize: "0.82rem", fontWeight: 750,
                letterSpacing: "0.02em",
                textTransform: "uppercase", margin: "0 0 8px",
              }}>
                {inline(first.slice(3), `h3-${blockIndex}`)}
              </h3>
              {lines.slice(1).length > 0 && (
                <div className="flex flex-col gap-2" style={{ color: bodyColor, fontSize: "0.95rem", lineHeight: 1.65 }}>
                  {lines.slice(1).map((line, index) => (
                    <p key={index} style={{ margin: 0 }}>{inline(line, `p-${blockIndex}-${index}`)}</p>
                  ))}
                </div>
              )}
            </div>
          );
        }
        if (first.startsWith("# ")) {
          return (
            <h2 key={blockIndex} style={{
              color: bodyColor, fontSize: "1.35rem", fontWeight: 750,
              letterSpacing: "-0.01em", margin: 0,
            }}>
              {inline(first.slice(2), `h2-${blockIndex}`)}
            </h2>
          );
        }
        if (isTableBlock(lines)) {
          const rows = lines
            .filter((line, index) => index !== 1)
            .map((line) => line.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((cell) => cell.trim()));
          const [head, ...body] = rows;
          return (
            <div key={blockIndex} style={{ overflowX: "auto", border: `1px solid ${ruleColor}`, borderRadius: 10 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
                <thead>
                  <tr style={{ background: dark ? "rgba(255,255,255,0.04)" : "#F9FAFB" }}>
                    {head.map((cell, index) => (
                      <th key={index} style={{ textAlign: "left", padding: "9px 12px", color: mutedColor, fontWeight: 650 }}>
                        {cell}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {body.map((row, rowIndex) => (
                    <tr key={rowIndex} style={{ borderTop: `1px solid ${ruleColor}` }}>
                      {row.map((cell, cellIndex) => (
                        <td key={cellIndex} style={{ padding: "9px 12px", color: bodyColor }}>
                          {inline(cell, `cell-${blockIndex}-${rowIndex}-${cellIndex}`)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        if (lines.every((line) => /^\s*[-*]\s+/.test(line))) {
          return (
            <ul key={blockIndex} style={{ margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 6 }}>
              {lines.map((line, index) => (
                <li key={index} style={{ color: bodyColor, fontSize: "0.95rem", lineHeight: 1.65 }}>
                  {inline(line.replace(/^\s*[-*]\s+/, ""), `li-${blockIndex}-${index}`)}
                </li>
              ))}
            </ul>
          );
        }
        if (lines.every((line) => /^\s*\d+[.)]\s+/.test(line))) {
          return (
            <ol key={blockIndex} style={{ margin: 0, paddingLeft: 22, display: "flex", flexDirection: "column", gap: 8 }}>
              {lines.map((line, index) => (
                <li key={index} style={{ color: bodyColor, fontSize: "0.95rem", lineHeight: 1.65 }}>
                  {inline(line.replace(/^\s*\d+[.)]\s+/, ""), `oli-${blockIndex}-${index}`)}
                </li>
              ))}
            </ol>
          );
        }
        if (lines.every((line) => line.startsWith("> "))) {
          return (
            <blockquote key={blockIndex} style={{
              margin: 0, padding: "10px 14px", borderLeft: "3px solid #1F06AC",
              background: dark ? "rgba(31,6,172,0.16)" : "rgba(31,6,172,0.05)",
              borderRadius: "0 8px 8px 0", color: bodyColor, fontSize: "0.93rem", lineHeight: 1.6,
            }}>
              {lines.map((line, index) => (
                <p key={index} style={{ margin: index ? "6px 0 0" : 0 }}>
                  {inline(line.replace(/^>\s+/, ""), `q-${blockIndex}-${index}`)}
                </p>
              ))}
            </blockquote>
          );
        }
        return (
          <div key={blockIndex} className="flex flex-col gap-2" style={{ color: bodyColor, fontSize: "0.95rem", lineHeight: 1.7 }}>
            {lines.map((line, index) => {
              if (/^\s*[-*]\s+/.test(line)) {
                return (
                  <div key={index} style={{ display: "flex", gap: 8 }}>
                    <span style={{ color: "#1F06AC", flexShrink: 0, marginTop: 2 }}>•</span>
                    <span>{inline(line.replace(/^\s*[-*]\s+/, ""), `mix-${blockIndex}-${index}`)}</span>
                  </div>
                );
              }
              return <p key={index} style={{ margin: 0 }}>{inline(line, `plain-${blockIndex}-${index}`)}</p>;
            })}
          </div>
        );
      })}
    </div>
  );
}

export default RevMarkdown;
