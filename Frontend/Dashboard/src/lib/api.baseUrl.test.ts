import { describe, expect, it, vi } from "vitest";

describe("api base URL resolution", () => {
  it("appends /api/v1 when VITE_API_URL omits the prefix", async () => {
    vi.resetModules();
    vi.stubEnv("VITE_API_URL", "https://revluma-backend.onrender.com");
    const mod = await import("./api");
    expect(mod.api.baseUrl).toBe("https://revluma-backend.onrender.com/api/v1");
    vi.unstubAllEnvs();
  });

  it("does not double-append /api/v1", async () => {
    vi.resetModules();
    vi.stubEnv("VITE_API_URL", "https://revluma-backend.onrender.com/api/v1");
    const mod = await import("./api");
    expect(mod.api.baseUrl).toBe("https://revluma-backend.onrender.com/api/v1");
    vi.unstubAllEnvs();
  });
});
