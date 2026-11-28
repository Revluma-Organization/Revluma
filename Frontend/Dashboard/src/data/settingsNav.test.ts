import { afterEach, describe, expect, it } from "vitest";
import {
  LAST_APP_ROUTE_KEY, SETTINGS_NAV, canSeeSettingsItem, findSettingsLocation, readLastAppRoute,
  rememberAppRoute, resolveSettingsCrumbs, visibleSettingsNav,
} from "./settingsNav";

const ids = (role?: string | null, query?: string) => visibleSettingsNav(role, query).flatMap((group) => group.items.map((item) => item.id));
const item = (id: string) => SETTINGS_NAV.flatMap((group) => group.items).find((entry) => entry.id === id)!;

describe("settings navigation model", () => {
  afterEach(() => window.sessionStorage.clear());

  it("lists only built pages, never placeholder routes", () => {
    expect(ids("owner")).toEqual([
      "profile", "preferences", "notifications", "active-sessions",
      "organization", "team", "roles", "branding", "automation", "billing",
      "danger-zone",
    ]);
    for (const placeholder of ["api-keys", "webhooks", "audit-log", "security", "email", "sms", "ai"]) {
      expect(ids("owner")).not.toContain(placeholder);
    }
  });

  it("hides entries only when the role is known to be too low", () => {
    expect(ids("member")).not.toContain("billing");
    expect(ids("member")).not.toContain("danger-zone");
    expect(ids("Admin")).toContain("billing");
    expect(ids("admin")).not.toContain("danger-zone");
    // "unknown" is the store's placeholder while a session verifies: show everything.
    expect(ids("unknown")).toContain("danger-zone");
    expect(ids(undefined)).toContain("billing");
    expect(canSeeSettingsItem(item("profile"), "member")).toBe(true);
  });

  it("filters by label, group and keywords, dropping empty groups", () => {
    expect(ids("owner", "invoice")).toEqual(["billing"]);
    // Danger zone matches too: its keyword is "delete workspace".
    expect(ids("owner", "WORKSPACE")).toHaveLength(7);
    expect(ids("owner", "2fa")).toEqual(["profile"]);
    expect(visibleSettingsNav("owner", "zzz")).toEqual([]);
  });

  it("maps aliases and billing tab pages to their menu entry", () => {
    expect(findSettingsLocation("/dashboard/settings/invoice-history").item?.id).toBe("billing");
    expect(findSettingsLocation("/dashboard/settings/payment-methods").item?.id).toBe("billing");
    expect(findSettingsLocation("/dashboard/settings/notification").item?.id).toBe("notifications");
    expect(findSettingsLocation("/dashboard/settings/api-keys").item).toBeUndefined();
  });

  it("builds the Settings breadcrumb trail", () => {
    expect(resolveSettingsCrumbs("/dashboard/overview")).toBeUndefined();
    expect(resolveSettingsCrumbs("/dashboard/settings/roles")).toEqual([
      { label: "Dashboard", to: "/dashboard/overview" },
      { label: "Settings", to: "/dashboard/settings" },
      { label: "Roles & permissions" },
    ]);
    expect(resolveSettingsCrumbs("/dashboard/settings")?.at(-1)).toEqual({ label: "Settings" });
  });

  it("remembers the last app page for Back, ignoring settings and foreign URLs", () => {
    expect(readLastAppRoute()).toBe("/dashboard/overview");
    rememberAppRoute("/dashboard/rev-intell?c=42");
    expect(readLastAppRoute()).toBe("/dashboard/rev-intell?c=42");
    window.sessionStorage.setItem(LAST_APP_ROUTE_KEY, "/dashboard/settings/profile");
    expect(readLastAppRoute()).toBe("/dashboard/overview");
    window.sessionStorage.setItem(LAST_APP_ROUTE_KEY, "https://evil.example/phish");
    expect(readLastAppRoute()).toBe("/dashboard/overview");
  });
});
