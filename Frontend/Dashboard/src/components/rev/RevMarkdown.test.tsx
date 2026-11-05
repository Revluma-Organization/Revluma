import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import RevMarkdown, { splitRevBlocks } from "./RevMarkdown";

function stubClipboard(mode: "success" | "failure") {
  const writeText = mode === "success"
    ? vi.fn().mockResolvedValue(undefined)
    : vi.fn().mockRejectedValue(new Error("denied"));
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  return writeText;
}

afterEach(() => {
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
  vi.restoreAllMocks();
});

describe("RevMarkdown", () => {
  it("renders headings, lists and bold text as plain React nodes", () => {
    render(
      <RevMarkdown text={"## Revenue\n\nOrders **fell** by 12%.\n\n- One\n- Two"} />,
    );
    expect(screen.getByText("Revenue").tagName).toBe("H3");
    expect(screen.getByText("fell").tagName).toBe("STRONG");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("never injects raw HTML from the model output", () => {
    const { container } = render(
      <RevMarkdown text={'Alert <img src=x onerror="alert(1)"> <script>alert(1)</script>'} />,
    );
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("<script>");
  });

  it("only links http(s) URLs and leaves unsafe schemes as text", () => {
    render(
      <RevMarkdown text={"[dashboard](https://app.revluma.test/x) and [danger](javascript:alert(1))"} />,
    );
    const link = screen.getByRole("link", { name: "dashboard" });
    expect(link.getAttribute("href")).toBe("https://app.revluma.test/x");
    expect(screen.queryAllByRole("link")).toHaveLength(1);
    expect(screen.getByText(/danger/)).toBeTruthy();
  });

  it("renders verified comparison tables with explicit currencies", () => {
    render(
      <RevMarkdown text={"| Period | Orders |\n| --- | --- |\n| 2026-10-01 → 2026-10-31 | 1571.90 USD |"} />,
    );
    expect(screen.getByRole("table")).toBeTruthy();
    expect(screen.getByText("1571.90 USD")).toBeTruthy();
  });
});

describe("RevMarkdown fenced code (ChatGPT-UI study §5)", () => {
  it("renders fenced code as a code surface with a language label, never raw backticks", () => {
    const { container } = render(
      <RevMarkdown text={"Run this:\n\n```sql\nSELECT 1;\nSELECT 2;\n```\n\nDone."} />,
    );
    expect(container.querySelector("[data-rev-code-block]")).toBeTruthy();
    expect(screen.getByText("sql")).toBeTruthy();
    expect(container.querySelector("pre code")?.textContent).toBe("SELECT 1;\nSELECT 2;");
    expect(container.textContent).not.toContain("```");
    expect(screen.getByText("Run this:")).toBeTruthy();
    expect(screen.getByText("Done.")).toBeTruthy();
  });

  it("labels an unknown language as code", () => {
    render(<RevMarkdown text={"```\nplain sample\n```"} />);
    expect(screen.getByText("code")).toBeTruthy();
    expect(screen.getByText("plain sample")).toBeTruthy();
  });

  it("keeps blank lines inside a fenced block in one atomic code surface", () => {
    const { container } = render(
      <RevMarkdown text={"```js\nconst a = 1;\n\nconst b = 2;\n```"} />,
    );
    expect(container.querySelectorAll("[data-rev-code-block]")).toHaveLength(1);
    expect(container.querySelector("pre code")?.textContent).toBe("const a = 1;\n\nconst b = 2;");
  });

  it("renders an unclosed fence as code instead of leaking backticks (truncated answer)", () => {
    const { container } = render(<RevMarkdown text={"```python\nprint('hi')"} />);
    expect(container.querySelector("[data-rev-code-block]")).toBeTruthy();
    expect(container.querySelector("pre code")?.textContent).toBe("print('hi')");
    expect(container.textContent).not.toContain("```");
  });

  it("never executes or injects HTML hidden inside a code fence", () => {
    const { container } = render(
      <RevMarkdown text={"```\n<script>alert(1)</script>\n```"} />,
    );
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("pre code")?.textContent).toContain("<script>alert(1)</script>");
  });

  it("copies code and reports the platform-confirmed result honestly", async () => {
    const writeText = stubClipboard("success");
    render(<RevMarkdown text={"```\nsample\n```"} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy code" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Copy code" })).toHaveTextContent("Copied"));
    expect(writeText).toHaveBeenCalledWith("sample");
  });

  it("says Copy failed when the clipboard write is rejected — never a false success", async () => {
    stubClipboard("failure");
    render(<RevMarkdown text={"```\nsample\n```"} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy code" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Copy code" })).toHaveTextContent("Copy failed"));
  });
});

describe("RevMarkdown table exports (ChatGPT-UI study §5)", () => {
  const table = "| Period | Orders |\n| --- | --- |\n| 2026-10-01 → 2026-10-31 | 1571.90 USD |";

  it("offers Copy CSV with rendered values and Copy Markdown with the source", async () => {
    const writeText = stubClipboard("success");
    render(<RevMarkdown text={table} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy CSV" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(
      "Period,Orders\n2026-10-01 → 2026-10-31,1571.90 USD",
    ));
    fireEvent.click(screen.getByRole("button", { name: "Copy Markdown" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(table));
  });
});

describe("RevMarkdown streaming discipline (ChatGPT-UI study §3/§6)", () => {
  it("hides every interactive affordance while the turn is still streaming", () => {
    const { container } = render(
      <RevMarkdown
        text={"```sql\nSELECT 1;\n```\n\n| A | B |\n| --- | --- |\n| 1 | 2 |"}
        streaming
      />,
    );
    // Content is fully readable while streaming…
    expect(container.querySelector("pre code")?.textContent).toBe("SELECT 1;");
    expect(screen.getByRole("table")).toBeTruthy();
    // …but nothing is interactive until the answer is complete.
    expect(screen.queryByRole("button", { name: "Copy code" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Copy CSV" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Copy Markdown" })).toBeNull();
  });
});

describe("splitRevBlocks", () => {
  it("splits prose on blank lines but treats fenced code as atomic", () => {
    const blocks = splitRevBlocks("Intro\n\n```js\na\n\nb\n```\n\nOutro");
    expect(blocks).toEqual(["Intro", "```js\na\n\nb\n```", "Outro"]);
  });

  it("keeps an unclosed fence as a single trailing block", () => {
    expect(splitRevBlocks("Text\n\n```py\nx = 1")).toEqual(["Text", "```py\nx = 1"]);
  });
});
