import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { api } from "@/lib/api";
import { useThemeStore } from "@/store/themeStore";
import { Topbar } from "./Topbar";

vi.mock("../WorkspaceSelection", () => ({ WorkspaceSelection: () => null }));

function renderTopbar(theme: "light" | "dark") {
  vi.spyOn(api, "get").mockResolvedValue({ ok: true, status: 200, data: { data: { count: 0 } } } as never);
  useThemeStore.setState({ theme, preference: theme });
  render(<MemoryRouter><Topbar section="Overview" lightWorkspace /></MemoryRouter>);
  return document.querySelector("header")!.className;
}

// The Command Center used to force a white top bar even in dark mode. Dark
// mode now applies to every dashboard screen, so the light skin is light-only.
describe("Topbar theme", () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("uses the light Command Center skin in light mode", () => {
    const header = renderTopbar("light");
    expect(header).toContain("bg-white");
  });

  it("follows the shared dark tokens in dark mode, even on the Command Center", () => {
    const header = renderTopbar("dark");
    expect(header).not.toContain("bg-white");
    expect(header).toContain("bg-bg");
  });
});
