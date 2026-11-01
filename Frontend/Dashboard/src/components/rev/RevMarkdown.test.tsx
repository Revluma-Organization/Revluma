import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import RevMarkdown from "./RevMarkdown";

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
