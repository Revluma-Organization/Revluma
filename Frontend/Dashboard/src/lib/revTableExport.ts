/**
 * Table export helpers (ChatGPT-UI study §5 "Tables": Copy as CSV / Copy as
 * Markdown, the merchant-relevant affordance for order and period tables).
 *
 * CSV escaping follows RFC 4180: a cell containing a comma, quote, CR or LF
 * is wrapped in double quotes, and embedded quotes are doubled. Emphasis
 * markers are stripped so the CSV carries the *rendered* value ("1571.90
 * USD", not "**1571.90 USD**").
 */

/** Strip inline markdown emphasis/code so exports carry rendered text. */
export function plainCellText(cell: string): string {
  return cell
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1");
}

function escapeCsvCell(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

/** Rows are already-parsed cell matrices: [head, ...body]. */
export function tableToCsv(rows: string[][]): string {
  return rows
    .map(row => row.map(cell => escapeCsvCell(plainCellText(cell))).join(","))
    .join("\n");
}

/** The original markdown source lines of the table, verbatim. */
export function tableToMarkdown(sourceLines: string[]): string {
  return sourceLines.join("\n");
}

/**
 * Clipboard write with honest degradation: resolves true only when the
 * platform confirmed the write. Callers surface "Copy failed" rather than
 * pretending — the same never-fake-success rule the backend lives by.
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    return false;
  }
  try {
    if (typeof document !== "undefined" && typeof document.execCommand === "function") {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(area);
      return ok;
    }
  } catch {
    return false;
  }
  return false;
}
