import { describe, expect, it } from "vitest";
import { matchingCopilotCommands, resolveCopilotPrompt } from "./copilotCommands";

describe("copilot command resolution", () => {
  it("matches slash workflows without treating ordinary messages as commands", () => {
    expect(matchingCopilotCommands("/").map((item) => item.command)).toContain("/summary");
    expect(matchingCopilotCommands("/low").map((item) => item.command)).toEqual(["/low-stock"]);
    expect(matchingCopilotCommands("show /summary")).toEqual([]);
    expect(matchingCopilotCommands("/summary please")).toEqual([]);
  });

  it("expands only complete commands and preserves free-form prompts", () => {
    expect(resolveCopilotPrompt(" /SUMMARY ")).toContain("weekly summary");
    expect(resolveCopilotPrompt("Tell me about /summary")).toBe("Tell me about /summary");
    expect(resolveCopilotPrompt(" /summary with more detail ")).toBe("/summary with more detail");
  });

  it("keeps store-changing workflows explicitly read-only", () => {
    for (const command of ["/low-stock", "/describe", "/pricing", "/campaign", "/social"]) {
      expect(resolveCopilotPrompt(command)).toMatch(/do not|draft/i);
    }
  });
});
