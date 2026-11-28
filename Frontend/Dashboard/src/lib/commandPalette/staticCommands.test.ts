import { describe, expect, it, vi } from "vitest";
import { buildStaticCommands } from "./staticCommands";
import { SETTINGS_NAV } from "@/data/settingsNav";

const deps = { theme: "light" as const, toggleTheme: vi.fn(), startTour: vi.fn(), setNotifOpen: vi.fn(), openCopilotWithQuery: vi.fn(), openPalette: vi.fn(), logout: vi.fn() };

function destinationOf(id: string) {
  const command = buildStaticCommands(deps).find((entry) => entry.id === id);
  const navigate = vi.fn();
  void command?.perform({ navigate, close: vi.fn() });
  return navigate.mock.calls[0]?.[0];
}

describe("settings commands", () => {
  it("sends Team Members to the real route (was a dead /team-members link)", () => {
    expect(destinationOf("settings-team")).toBe("/dashboard/settings/team");
  });

  it("reaches every settings menu page from the palette, without duplicate ids", () => {
    const commands = buildStaticCommands(deps);
    const destinations = new Set<string>();
    for (const command of commands.filter((entry) => entry.category === "settings")) {
      const navigate = vi.fn();
      void command.perform({ navigate, close: vi.fn() });
      if (navigate.mock.calls[0]) destinations.add(navigate.mock.calls[0][0]);
    }
    for (const item of SETTINGS_NAV.flatMap((group) => group.items)) expect(destinations).toContain(item.to);
    const ids = commands.map((command) => command.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(destinationOf("settings-page-preferences")).toBe("/dashboard/settings/preferences");
  });
});
