/// <reference types="node" />
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import tailwindConfig from "../../../tailwind.config";
import { getSeverityMeta } from "./findingDisplay";
import { cc, palette, shell } from "./tokens";
import type { Finding } from "./types";

/**
 * Token-sync guards for the Revluma Master (design-system/revluma/MASTER.md).
 *
 * `palette` is the single source of truth. These tests lock:
 * 1. palette values (the actual hex),
 * 2. cc/shell literal class strings to their palette values (Tailwind's
 *    scanner and existing suites require literals, so sync is asserted
 *    instead of sharing references),
 * 3. severity meta + Tailwind theme derivation from palette,
 * 4. the no-raw-hex rule: every other command-center module must consume
 *    tokens (or stock Tailwind colors / white / transparent).
 */

describe("Master palette values", () => {
  it("pins the Revluma brand violet ramp", () => {
    expect(palette.brand.DEFAULT).toBe("#4438E8");
    expect(palette.brand.strong).toBe("#372CD1");
    expect(palette.brand.deep).toBe("#3525B8");
    expect(palette.brand.deeper).toBe("#1F06AC");
    expect(palette.brand.soft).toBe("#F0EDFF");
  });

  it("pins ink, surface, and hairline neutrals", () => {
    expect(palette.ink.DEFAULT).toBe("#17191F");
    expect(palette.ink.soft).toBe("#343844");
    expect(palette.ink.muted).toBe("#707582");
    expect(palette.surface.workspace).toBe("#F4F5F8");
    expect(palette.line.DEFAULT).toBe("#E7E9EF");
  });

  it("pins status and CTA gradient anchors", () => {
    expect(palette.success.DEFAULT).toBe("#067647");
    expect(palette.danger.DEFAULT).toBe("#B42318");
    expect(palette.warning.DEFAULT).toBe("#92400E");
    expect(palette.gradient.cta).toContain("#5146E5");
    expect(palette.gradient.cta).toContain(palette.brand.deeper);
  });
});

describe("cc/shell class strings stay in sync with palette", () => {
  it("derives brand classes from palette values", () => {
    expect(cc.primary).toContain(palette.brand.DEFAULT);
    expect(cc.secondary).toContain(palette.brand.DEFAULT);
    expect(cc.disclosure).toContain(palette.brand.DEFAULT);
    expect(cc.focus).toContain(palette.brand.DEFAULT);
  });

  it("derives status and body classes from palette values", () => {
    expect(cc.positive).toBe(`text-[${palette.success.DEFAULT}]`);
    expect(cc.negative).toBe(`text-[${palette.danger.DEFAULT}]`);
    expect(cc.warning).toBe(`text-[${palette.warning.DEFAULT}]`);
    expect(cc.body).toBe(`text-sm leading-6 text-[${palette.ink.soft}]`);
    expect(cc.muted).toContain(palette.ink.muted);
  });

  it("derives surface classes from palette values", () => {
    expect(cc.surface).toContain(palette.line.DEFAULT);
    expect(cc.intelligence).toContain(palette.brand.line);
    expect(cc.title).toContain(palette.ink.DEFAULT);
    expect(shell.workspace).toContain(palette.surface.workspace);
    expect(shell.sidebarActive).toContain(palette.brand.deeper);
  });
});

describe("severity meta reads palette", () => {
  const severities: Finding["severity"][] = ["critical", "high", "medium", "low"];

  it("anchors the critical base value", () => {
    expect(palette.severity.critical.base).toBe("#E5484D");
  });

  it.each(severities)("maps %s meta colors from palette", (severity) => {
    const meta = getSeverityMeta(severity);
    const source = palette.severity[severity];
    expect(meta.base).toBe(source.base);
    expect(meta.deep).toBe(source.deep);
    expect(meta.softBg).toBe(source.softBg);
    expect(meta.border).toBe(source.border);
  });
});

describe("Tailwind theme derives from palette", () => {
  const themeColors = (
    tailwindConfig as unknown as {
      theme: { extend: { colors: Record<string, Record<string, string> & { DEFAULT?: string }> } };
    }
  ).theme.extend.colors;

  it("maps theme colors to palette values", () => {
    expect(themeColors.brand.DEFAULT).toBe(palette.brand.DEFAULT);
    expect(themeColors.brand.deeper).toBe(palette.brand.deeper);
    expect(themeColors.ink.DEFAULT).toBe(palette.ink.DEFAULT);
    expect(themeColors.ink.muted).toBe(palette.ink.muted);
    expect(themeColors.line.soft).toBe(palette.line.soft);
    expect(themeColors.danger.limited).toBe(palette.danger.limited);
    expect(themeColors.warning.lineStrong).toBe(palette.warning.lineStrong);
    expect(themeColors.band.body).toBe(palette.band.body);
    expect(themeColors.severity.critical).toBe(palette.severity.critical.base);
    expect(themeColors.deck.ghost).toBe(palette.deck.ghost);
  });

  it("maps flat surface singletons to palette values", () => {
    const flat = themeColors as unknown as Record<string, string>;
    expect(flat.workspace).toBe(palette.surface.workspace);
    expect(flat.subtle).toBe(palette.surface.subtle);
    expect(flat.wash).toBe(palette.surface.wash);
    expect(flat.veil).toBe(palette.surface.veil);
    expect(flat.skeleton).toBe(palette.surface.skeleton);
    expect(flat.scrim).toBe(palette.band.bg);
    expect(flat.connected).toBe(palette.connected);
  });
});

describe("no raw hex outside tokens.ts", () => {
  it("keeps every other command-center module hex-free", () => {
    const dir = dirname(fileURLToPath(import.meta.url));
    const offenders: string[] = [];
    for (const file of readdirSync(dir)) {
      if (file === "tokens.ts" || file.endsWith(".test.tsx") || file.endsWith(".test.ts")) continue;
      if (!file.endsWith(".tsx") && !file.endsWith(".ts")) continue;
      const hits = readFileSync(join(dir, file), "utf8").match(/#[0-9A-Fa-f]{3,8}\b/g);
      if (hits) offenders.push(`${file}: ${[...new Set(hits)].join(", ")}`);
    }
    expect(offenders).toEqual([]);
  });
});
