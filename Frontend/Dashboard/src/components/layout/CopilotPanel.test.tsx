import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { CopilotPanel } from "./CopilotPanel";
import { useUI } from "@/store/ui";
import { streamRevAnswer } from "@/lib/revStream";
import { api } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  api: { get: vi.fn() },
  getApiBaseUrl: () => "https://api.example.test/api/v1",
  getStreamingAuthHeaders: vi.fn(async () => ({})),
}));

vi.mock("@/lib/revStream", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/revStream")>();
  return { ...actual, streamRevAnswer: vi.fn() };
});

const mockedStream = vi.mocked(streamRevAnswer);
const mockedGet = vi.mocked(api.get);

function renderPanel() {
  return render(<MemoryRouter><CopilotPanel /></MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
  useUI.setState({ copilotOpen: true, copilotPrefill: null });
  mockedGet.mockResolvedValue({
    data: { success: true, data: { data: { stores: [] } } },
    status: 200,
    ok: true,
  });
});

describe("CopilotPanel", () => {
  it("shows honest workflows instead of fabricated merchant findings", () => {
    renderPanel();
    expect(screen.getByText("Your commerce copilot")).toBeInTheDocument();
    expect(screen.getByText("Weekly summary")).toBeInTheDocument();
    expect(screen.queryByText(/Alex|32%|Friday 6/)).not.toBeInTheDocument();
  });

  it("expands a workflow and renders the real streamed Rev response", async () => {
    mockedStream.mockImplementation(async ({ handlers }) => {
      handlers.onMeta?.({ conversation_id: "conversation-1" });
      handlers.onFinal?.({
        success: true,
        read_only: true,
        response_type: "conversational",
        response_mode: "conversational",
        text: "Your verified weekly summary is ready.",
        conversation_id: "conversation-1",
      });
      return { conversationId: "conversation-1", completed: true };
    });
    renderPanel();
    fireEvent.click(screen.getByText("Weekly summary"));

    await waitFor(() => expect(mockedStream).toHaveBeenCalledTimes(1));
    expect(mockedStream.mock.calls[0][0].message).toContain("weekly summary");
    expect(await screen.findByText("Your verified weekly summary is ready.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open full Rev conversation" })).toBeInTheDocument();
  });

  it("sends a free-form question and supports stopping an active response", async () => {
    let abortSignal: AbortSignal | undefined;
    mockedStream.mockImplementation(({ signal }) => {
      abortSignal = signal;
      return new Promise((resolve, reject) => {
        signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      });
    });
    renderPanel();
    const input = screen.getByRole("textbox", { name: "Message Revluma Copilot" });
    fireEvent.change(input, { target: { value: "How did my store perform this week?" } });
    fireEvent.keyDown(input, { key: "Enter" });

    const stop = await screen.findByRole("button", { name: "Stop response" });
    fireEvent.click(stop);
    expect(abortSignal?.aborted).toBe(true);
    expect(await screen.findByText("Response stopped.")).toBeInTheDocument();
  });

  it("does not duplicate a question on rapid repeated submission", async () => {
    mockedStream.mockImplementation(() => new Promise(() => {}));
    renderPanel();
    const input = screen.getByRole("textbox", { name: "Message Revluma Copilot" });
    fireEvent.change(input, { target: { value: "Summarize my store" } });
    const form = input.closest("form") as HTMLFormElement;
    fireEvent.submit(form);
    fireEvent.submit(form);
    await waitFor(() => expect(mockedStream).toHaveBeenCalledTimes(1));
  });

  it("surfaces workflow choices while typing a slash command", () => {
    renderPanel();
    const input = screen.getByRole("textbox", { name: "Message Revluma Copilot" });
    fireEvent.change(input, { target: { value: "/low" } });
    expect(screen.getByRole("listbox", { name: "Copilot workflows" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Low-stock review/ })).toBeInTheDocument();
  });
});
