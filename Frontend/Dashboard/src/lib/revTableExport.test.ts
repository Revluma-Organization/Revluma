import { afterEach, describe, expect, it, vi } from "vitest";
import { copyTextToClipboard, plainCellText, tableToCsv, tableToMarkdown } from "./revTableExport";

describe("tableToCsv", () => {
  it("escapes commas, quotes and newlines per RFC 4180", () => {
    expect(tableToCsv([
      ["Product", "Note"],
      ['Widget, blue', 'He said "hi"'],
      ["Multi\nline", "plain"],
    ])).toBe('Product,Note\n"Widget, blue","He said ""hi"""\n"Multi\nline",plain');
  });

  it("carries rendered values, stripping emphasis markers", () => {
    expect(tableToCsv([["Value"], ["**1571.90 USD**"], ["`code`"], ["*emphasis*"]]))
      .toBe("Value\n1571.90 USD\ncode\nemphasis");
  });

  it("returns an empty string for an empty table", () => {
    expect(tableToCsv([])).toBe("");
  });
});

describe("plainCellText", () => {
  it("leaves plain text untouched", () => {
    expect(plainCellText("1571.90 USD")).toBe("1571.90 USD");
  });
});

describe("tableToMarkdown", () => {
  it("joins the original source lines verbatim", () => {
    const lines = ["| A | B |", "| --- | --- |", "| 1 | 2 |"];
    expect(tableToMarkdown(lines)).toBe(lines.join("\n"));
  });
});

describe("copyTextToClipboard", () => {
  afterEach(() => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    vi.restoreAllMocks();
  });

  it("resolves true when the async clipboard confirms the write", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    await expect(copyTextToClipboard("x")).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("x");
  });

  it("resolves false when the clipboard rejects — callers must not claim success", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });
    await expect(copyTextToClipboard("x")).resolves.toBe(false);
  });

  it("resolves false when no clipboard API exists at all", async () => {
    await expect(copyTextToClipboard("x")).resolves.toBe(false);
  });
});
