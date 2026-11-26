import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { SignalsActivitySection } from "./SignalsActivitySection";
import { ccFinding, ccFixture } from "@/test/commandCenterFixtures";
import { operationalActivityFixture } from "@/test/businessHealthFixtures";
import type { CommandCenterData, Finding } from "./types";

afterEach(() => {
  cleanup();
});

const signal = (extra: Record<string, unknown> = {}) => ccFinding(extra) as Finding;

function renderSection(data: CommandCenterData) {
  return render(
    <MemoryRouter>
      <SignalsActivitySection data={data} />
    </MemoryRouter>,
  );
}

describe("SignalsActivitySection", () => {
  it("renders the section header with real findings and activity counts", () => {
    const primary = signal({ id: "f1" });
    renderSection(
      ccFixture({
        findings: [primary, signal({ id: "f2" })],
        priority_finding: primary,
        operational_activity: operationalActivityFixture(),
      }),
    );
    const heading = screen.getByRole("heading", { name: "Signals & Activity", level: 2 });
    expect(heading).toHaveAttribute("id", "signals-activity-heading");
    expect(document.getElementById("signals-activity")).not.toBeNull();
    expect(screen.getByText("2 findings · 2 recorded")).toBeInTheDocument();
  });

  it("places the signals table before the reused activity feed", () => {
    renderSection(ccFixture({ findings: [signal({ id: "f1" })] }));
    const tableHeading = screen.getByRole("heading", { name: "Detected signals", level: 3 });
    const activityHeading = screen.getByRole("heading", { name: "Operational activity", level: 2 });
    expect(tableHeading.compareDocumentPosition(activityHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole("table")).toBeInTheDocument();
  });

  it("falls back to the legacy activity list count when the contract is absent", () => {
    renderSection(
      ccFixture({
        activity: [
          { id: "a1", kind: "business", type: "finding", label: "Finding recorded", occurred_at: "2026-11-08T10:00:00Z", note: "Recorded", finding_id: "f1" },
        ],
      }),
    );
    expect(screen.getByText("0 findings · 1 recorded")).toBeInTheDocument();
    expect(screen.getByText("No signals recorded")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Operational activity", level: 2 })).toBeInTheDocument();
  });
});
