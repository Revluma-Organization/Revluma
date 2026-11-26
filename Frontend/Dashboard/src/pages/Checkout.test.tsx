import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Checkout, resolveCheckoutSelection } from "./Checkout";
import { api } from "@/lib/api";

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...actual, api: { post: vi.fn() } };
});
const post = vi.mocked(api.post);

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Checkout />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  post.mockReset();
});

describe("Checkout", () => {
  it("resolves plan and cycle with USD prices", () => {
    expect(resolveCheckoutSelection("premium", "yearly")).toMatchObject({ plan: "premium", cycle: "annual", perMonth: 63, total: 756 });
    expect(resolveCheckoutSelection("starter", "monthly")).toMatchObject({ plan: "starter", cycle: "monthly", total: 29 });
    expect(resolveCheckoutSelection("growth", null)).toMatchObject({ plan: "starter" });
    expect(resolveCheckoutSelection("scale", "annual")).toMatchObject({ plan: "premium", total: 756 });
    expect(resolveCheckoutSelection("enterprise", "weekly")).toMatchObject({ plan: "starter", cycle: "monthly" });
  });

  it("never asks for card details and shows the USD total", () => {
    const { container } = renderAt("/dashboard/checkout?plan=premium&interval=yearly");
    expect(container.querySelectorAll("input")).toHaveLength(0);
    expect(screen.queryByText(/card number|cvv/i)).not.toBeInTheDocument();
    expect(screen.getByTestId("checkout-plan")).toHaveTextContent("Revluma Premium");
    expect(screen.getByTestId("checkout-total")).toHaveTextContent("$756");
    expect(screen.getByText("US dollars (USD)")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/₦|NGN/);
  });

  it("starts a USD Paystack checkout and redirects", async () => {
    const assign = vi.fn();
    const original = window.location;
    Object.defineProperty(window, "location", { configurable: true, value: { ...original, set href(url: string) { assign(url); } } });
    post.mockResolvedValue({ data: { success: true, data: { authorization_url: "https://checkout.paystack.com/abc" } } } as never);
    renderAt("/dashboard/checkout?plan=starter&interval=monthly");
    fireEvent.click(screen.getByRole("button", { name: /Continue to Paystack/ }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://checkout.paystack.com/abc"));
    expect(post).toHaveBeenCalledWith("/subscriptions/initialize", { plan: "starter", billing_cycle: "monthly", currency: "USD" }, { skipAuthRedirect: true });
    Object.defineProperty(window, "location", { configurable: true, value: original });
  });

  it("shows the server error and lets the merchant retry", async () => {
    post.mockRejectedValue(new Error("Owner access required."));
    renderAt("/dashboard/checkout");
    fireEvent.click(screen.getByRole("button", { name: /Continue to Paystack/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Owner access required.");
    expect(screen.getByRole("button", { name: /Continue to Paystack/ })).toBeEnabled();
  });
});
