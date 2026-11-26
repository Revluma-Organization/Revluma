import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WaitlistApp } from "@/waitlist/WaitlistApp";
import { CAPABILITIES, EMPTY_ANSWERS, MONTHLY_ORDERS, PRICES, STORE_AGE, normaliseEmail, normalisePhone, normaliseShopifyUrl, validateStep, type Answers } from "@/waitlist/schema";
import { captureReferral, referralFromSearch, waitlistHref } from "@/waitlist/referral";
import { keepUnsaved } from "@/waitlist/recovery";
import type { Application } from "@/waitlist/api";
import { overallFill, stepFill } from "@/waitlist/progress";

const page = readFileSync(resolve(__dirname, "../../../waitlist.html"), "utf8");

type Call = { method: string; url: string; body: unknown; headers: Record<string, string> };

function json(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

function app(step: 1 | 2 | 3 | 4, answers: Partial<Answers> = {}, extra: Partial<Application> = {}): Application {
  return {
    status: "in_progress",
    current_step: step,
    submitted_at: null,
    updated_at: "2026-11-18T10:00:00.000Z",
    referred: false,
    queue_position: null,
    referral_code: null,
    answers: { ...EMPTY_ANSWERS, ...answers },
    ...extra,
  };
}

const STEP1: Partial<Answers> = {
  full_name: "Amina Bello",
  work_email: "amina@kanothreads.com",
  store_name: "Kano Threads",
  store_url: "https://kanothreads.myshopify.com",
  phone: "",
  store_age: "1_3y",
  monthly_orders: "101_500",
};

/** A scripted backend: one handler per "METHOD action", recording every call. */
function backend(handlers: Record<string, (call: Call) => Response | Promise<Response>>) {
  const calls: Call[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    const action = url.replace(/^.*\/api\/waitlist\/application\//, "");
    const call: Call = {
      method: init.method ?? "GET",
      url,
      body: init.body ? JSON.parse(String(init.body)) : undefined,
      headers: (init.headers as Record<string, string>) ?? {},
    };
    calls.push(call);
    const handler = handlers[`${call.method} ${action}`];
    if (!handler) return json(404, { success: false, error: "Not found." });
    return handler(call);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock, of: (key: string) => calls.filter((c) => `${c.method} ${c.url.replace(/^.*\/application\//, "")}` === key) };
}

async function fillStep1(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Full name"), "Amina Bello");
  await user.type(screen.getByLabelText("Work email"), "Amina@KanoThreads.com");
  await user.type(screen.getByLabelText("Brand or store name"), "Kano Threads");
  await user.type(screen.getByLabelText("Shopify store URL"), "kanothreads");
  await user.click(screen.getByRole("radio", { name: "1 - 3 years" }));
  await user.click(screen.getByRole("radio", { name: "101 - 500" }));
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/waitlist");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("waitlist schema", () => {
  it("normalises Shopify store addresses like the server", () => {
    expect(normaliseShopifyUrl("kanothreads")).toBe("https://kanothreads.myshopify.com");
    expect(normaliseShopifyUrl("HTTPS://Kano-Threads.myshopify.com/admin")).toBe("https://kano-threads.myshopify.com");
    expect(normaliseShopifyUrl("admin.shopify.com/store/kanothreads/orders")).toBe("https://kanothreads.myshopify.com");
    expect(normaliseShopifyUrl("www.kanothreads.com")).toBe("https://kanothreads.com");
    for (const bad of ["", "x", "shopify.com", "a.b.myshopify.com", "x.myshopify.com.evil", "user@evil.com", "kano threads"]) {
      expect(normaliseShopifyUrl(bad)).toBeNull();
    }
  });

  it("accepts international phone formats and normalises email", () => {
    expect(normalisePhone("")).toBe("");
    expect(normalisePhone("+234 801 234 5678")).toBe("+2348012345678");
    expect(normalisePhone("0044 20 7946 0958")).toBe("+442079460958");
    expect(normalisePhone("(555) 123-4567")).toBe("5551234567");
    expect(normalisePhone("12345")).toBeUndefined();
    expect(normalisePhone("call me")).toBeUndefined();
    expect(normaliseEmail("  Amina@Shop.COM ")).toBe("amina@shop.com");
    expect(normaliseEmail("amina@shop")).toBeNull();
  });

  it("limits capabilities to three and requires every step 3 answer", () => {
    const base = { ...EMPTY_ANSWERS, price_willingness: "usd_49", founding_interest: "yes" };
    expect(validateStep(3, { ...base, capabilities: ["revenue_leaks"] })).toEqual({});
    expect(validateStep(3, { ...base, capabilities: CAPABILITIES.slice(0, 4).map((c) => c.value) }).capabilities).toMatch(/up to 3/);
    expect(Object.keys(validateStep(3, EMPTY_ANSWERS)).sort()).toEqual(["capabilities", "founding_interest", "price_willingness"]);
    expect(PRICES.map((p) => p.label)).toEqual(["Free", "$19", "$29", "$49", "$79", "$99", "$149", "$199", "$299", "$500+"]);
  });
});

describe("waitlist presentation rules", () => {
  it("writes number ranges as A - B, never A to B", () => {
    expect(MONTHLY_ORDERS.map((o) => o.label)).toEqual(["0 - 20", "21 - 100", "101 - 500", "501 - 2,000", "2,000+"]);
    expect(STORE_AGE.map((o) => o.label)).toEqual(["Under 3 months", "3 - 6 months", "6 - 12 months", "1 - 3 years", "3+ years"]);
    expect(validateStep(1, { ...EMPTY_ANSWERS, phone: "12" }).phone).toContain("7 - 15 digits");
    for (const label of [...MONTHLY_ORDERS, ...STORE_AGE].map((o) => o.label)) expect(label).not.toMatch(/\d to \d/);
  });

  it("fills progress live from the required answers only", () => {
    expect(stepFill(EMPTY_ANSWERS, 1)).toBe(0);
    expect(stepFill({ ...EMPTY_ANSWERS, full_name: "Amina", phone: "+1 555 123 4567" }, 1)).toBeCloseTo(1 / 6);
    expect(stepFill({ ...EMPTY_ANSWERS, ...STEP1 } as Answers, 1)).toBe(1);
    expect(overallFill({ ...EMPTY_ANSWERS, ...STEP1 } as Answers)).toEqual({ done: 6, total: 11 });
  });

  it("keeps every animation behind prefers-reduced-motion", () => {
    const css = readFileSync(resolve(__dirname, "../waitlist/waitlist.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reduced).toMatch(/animation-duration: 0\.01ms !important/);
    expect(reduced).toMatch(/transition-duration: 0\.01ms !important/);
    expect(reduced).toMatch(/\.wl-pass-tilt \{\s*transform: none !important/);
    expect(reduced).toMatch(/\.wl-burst \{\s*display: none/);
    expect(css).not.toMatch(/\u2014|\u2013/);
  });
});

describe("waitlist referral attribution", () => {
  it("reads ?ref= (and the older ?referral=) and keeps it for the session", () => {
    expect(referralFromSearch("?ref=rv-ab12cd34")).toBe("RV-AB12CD34");
    expect(referralFromSearch("?referral=RV-ZZ99ZZ99")).toBe("RV-ZZ99ZZ99");
    expect(referralFromSearch("?ref=<script>")).toBeNull();
    expect(captureReferral("?ref=RV-AB12CD34")).toBe("RV-AB12CD34");
    expect(captureReferral("")).toBe("RV-AB12CD34");
    expect(captureReferral("?ref=RV-OTHER111")).toBe("RV-AB12CD34"); // first touch wins
  });

  it("carries the homepage's ?ref= onto the /waitlist links", () => {
    expect(waitlistHref("?ref=RV-AB12CD34&utm_source=x")).toBe("/waitlist?ref=RV-AB12CD34");
    expect(waitlistHref("")).toBe("/waitlist");
  });
});

describe("/waitlist application", () => {
  it("only advances once the server confirms the save, with one idempotent start", async () => {
    window.history.replaceState(null, "", "/waitlist?ref=RV-AB12CD34");
    let release: () => void = () => {};
    const api = backend({
      "GET resume": () => json(200, { success: true, data: { application: null } }),
      "POST start": () =>
        new Promise((resolve) => {
          release = () => resolve(json(201, { success: true, data: { application: app(2, STEP1, { referred: true }) } }));
        }),
    });
    const user = userEvent.setup();
    render(<WaitlistApp />);
    expect(await screen.findByRole("heading", { name: "About your store" })).toBeInTheDocument();

    await fillStep1(user);
    const go = screen.getByRole("button", { name: /^continue$/i });
    await user.click(go);
    // Saving: the button is disabled and a second click sends nothing.
    expect(await screen.findByRole("button", { name: /saving/i })).toBeDisabled();
    expect(screen.getByRole("status", { name: "" }).textContent ?? "").toContain("Saving");
    await user.click(screen.getByRole("button", { name: /saving/i }));
    expect(api.of("POST start")).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "About your store" })).toBeInTheDocument();

    const [start] = api.of("POST start");
    expect(start.headers["Idempotency-Key"]).toMatch(/^[0-9a-f-]{32,36}$/);
    expect(start.body).toMatchObject({
      full_name: "Amina Bello",
      work_email: "Amina@KanoThreads.com",
      store_url: "kanothreads",
      store_age: "1_3y",
      monthly_orders: "101_500",
      referral_code: "RV-AB12CD34",
      hp_field: "",
    });

    await act(async () => release());
    expect(await screen.findByRole("heading", { name: "Your challenges" })).toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Your challenges" }));
  });

  it("blocks progress when a save fails, keeps a local recovery copy, and retries with the same key", async () => {
    let attempts = 0;
    const api = backend({
      "GET resume": () => json(200, { success: true, data: { application: null } }),
      "POST start": () => {
        attempts += 1;
        // Two failures exhaust the built in retry; the third (the user's Retry) works.
        return attempts <= 2
          ? json(502, { success: false, code: "UPSTREAM_UNAVAILABLE", error: "down" })
          : json(201, { success: true, data: { application: app(2, STEP1) } });
      },
    });
    const user = userEvent.setup();
    render(<WaitlistApp />);
    await screen.findByRole("heading", { name: "About your store" });
    await fillStep1(user);
    await user.click(screen.getByRole("button", { name: /^continue$/i }));

    expect(await screen.findByText("Unable to save. Retry.", {}, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "About your store" })).toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem("rv_wl_recovery")!).steps[1].full_name).toBe("Amina Bello");

    await user.click(screen.getByRole("button", { name: /retry/i }));
    expect(await screen.findByRole("heading", { name: "Your challenges" })).toBeInTheDocument();
    const keys = new Set(api.of("POST start").map((c) => c.headers["Idempotency-Key"]));
    expect(api.of("POST start")).toHaveLength(3);
    expect(keys.size).toBe(1);
    expect(window.localStorage.getItem("rv_wl_recovery")).toBeNull();
  }, 10000);

  it("shows field errors and a focused summary instead of saving incomplete answers", async () => {
    const api = backend({ "GET resume": () => json(200, { success: true, data: { application: null } }) });
    const user = userEvent.setup();
    render(<WaitlistApp />);
    await screen.findByRole("heading", { name: "About your store" });
    await user.click(screen.getByRole("button", { name: /^continue$/i }));
    const summary = await screen.findByRole("alert");
    expect(summary).toHaveTextContent("6 answers need attention");
    expect(document.activeElement).toBe(summary);
    expect(screen.getByLabelText("Work email")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Work email").getAttribute("aria-describedby")).toContain("wl-work_email-error");
    expect(api.of("POST start")).toHaveLength(0);
  });

  it("resumes at the step the server has, with the saved answers, and enforces three capabilities", async () => {
    backend({
      "GET resume": () =>
        json(200, { success: true, data: { application: app(3, { ...STEP1, challenges: ["cart_abandonment"], problem_discovery: "manual" }) } }),
      "PUT steps/2": () => json(200, { success: true, data: { application: app(3, STEP1) } }),
    });
    const user = userEvent.setup();
    render(<WaitlistApp />);
    expect(await screen.findByRole("heading", { name: "Pricing and priorities" })).toBeInTheDocument();
    // Nothing preselected on the price question.
    for (const radio of within(screen.getByRole("group", { name: /what would you pay/i })).getAllByRole("radio")) expect(radio).not.toBeChecked();

    for (const name of ["Detecting hidden revenue leaks", "Identifying checkout and cart problems", "Receiving prioritized recommendations"]) {
      await user.click(screen.getByRole("checkbox", { name }));
    }
    expect(screen.getByText("3 of 3 selected")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Identifying inventory-related revenue risks" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: /back/i }));
    expect(await screen.findByRole("heading", { name: "Your challenges" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Customers abandon their carts" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "I investigate manually" })).toBeChecked();
  });

  it("offers back answers that failed to save on the last visit", async () => {
    keepUnsaved(2, { ...EMPTY_ANSWERS, challenges: ["declining_sales"], problem_discovery: "no_process" });
    backend({ "GET resume": () => json(200, { success: true, data: { application: app(2, STEP1) } }) });
    render(<WaitlistApp />);
    expect(await screen.findByRole("heading", { name: "Your challenges" })).toBeInTheDocument();
    expect(screen.getByText(/restored answers that hadn't been saved yet/)).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Sales are declining unexpectedly" })).toBeChecked();
  });

  it("submits from the review screen once and shows the received page without promises", async () => {
    const answers = {
      ...STEP1,
      challenges: ["other"],
      challenge_other: "Returns",
      problem_discovery: "manual",
      price_willingness: "usd_49",
      capabilities: ["revenue_leaks"],
      founding_interest: "yes",
    };
    const api = backend({
      "GET resume": () => json(200, { success: true, data: { application: app(4, answers) } }),
      "POST submit": () =>
        json(200, {
          success: true,
          data: {
            application: app(4, answers, { status: "submitted", queue_position: 12, referral_code: "RV-AB12CD34", submitted_at: "2026-11-18T10:05:00.000Z" }),
          },
        }),
    });
    const user = userEvent.setup();
    render(<WaitlistApp />);
    expect(await screen.findByRole("heading", { name: "Review your application" })).toBeInTheDocument();
    expect(screen.getByText("Other: Returns")).toBeInTheDocument();
    expect(screen.getByText("$49 per month")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^edit /i })).toHaveLength(3);

    const submit = screen.getByRole("button", { name: /submit application/i });
    await user.click(submit);
    expect(await screen.findByRole("heading", { name: /application received, amina/i })).toBeInTheDocument();
    expect(api.of("POST submit")).toHaveLength(1);
    const done = document.querySelector(".wl-done")!;
    expect(done.textContent).toContain("being considered for Founding Merchant access");
    expect(done.textContent).toContain("#12");
    expect(done.textContent).toContain("not a guarantee of access");
    expect(done.textContent).not.toMatch(/you('| a)re (in|accepted)|guaranteed/i);
    expect((screen.getByLabelText("Your referral link") as HTMLInputElement).value).toContain("/waitlist?ref=RV-AB12CD34");
  });

  it("continues on another device only with the emailed code", async () => {
    const api = backend({
      "GET resume": () => json(200, { success: true, data: { application: null } }),
      "POST resume/request-code": () => json(202, { success: true }),
      "POST resume/verify-code": (call) =>
        (call.body as { code: string }).code === "123456"
          ? json(200, { success: true, data: { application: app(3, STEP1) } })
          : json(400, { success: false, code: "CODE_INVALID", error: "bad" }),
    });
    const user = userEvent.setup();
    render(<WaitlistApp />);
    await screen.findByRole("heading", { name: "About your store" });
    await user.click(screen.getByRole("button", { name: /continue with your email/i }));
    await user.type(await screen.findByLabelText("Work email"), "amina@kanothreads.com");
    await user.click(screen.getByRole("button", { name: /email me a code/i }));
    const code = await screen.findByLabelText("6 digit code");
    await user.type(code, "000000");
    await user.click(screen.getByRole("button", { name: /continue application/i }));
    expect(await screen.findByText(/not valid or has expired/)).toBeInTheDocument();
    await user.clear(code);
    await user.type(code, "123456");
    await user.click(screen.getByRole("button", { name: /continue application/i }));
    expect(await screen.findByRole("heading", { name: "Pricing and priorities" })).toBeInTheDocument();
    expect(api.of("POST resume/request-code")[0].body).toEqual({ email: "amina@kanothreads.com" });
  });

  it("explains an email that already has an application and offers the code instead", async () => {
    backend({
      "GET resume": () => json(200, { success: true, data: { application: null } }),
      "POST start": () => json(409, { success: false, code: "EMAIL_HAS_APPLICATION", error: "exists" }),
    });
    const user = userEvent.setup();
    render(<WaitlistApp />);
    await screen.findByRole("heading", { name: "About your store" });
    await fillStep1(user);
    await user.click(screen.getByRole("button", { name: /^continue$/i }));
    expect(await screen.findByText(/already has an application/, { selector: ".wl-notice p" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Email me a code" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "About your store" })).toBeInTheDocument();
  });

  it("uses a US phone example and draws ranges as tiles the pass reacts to", async () => {
    backend({ "GET resume": () => json(200, { success: true, data: { application: null } }) });
    const user = userEvent.setup();
    const { container } = render(<WaitlistApp />);
    await screen.findByRole("heading", { name: "About your store" });
    expect(screen.getByLabelText(/phone or whatsapp/i)).toHaveAttribute("placeholder", "+1 (555) 123-4567");
    const orders = screen.getByRole("group", { name: /orders do you get/i });
    expect(within(orders).getAllByRole("radio").map((r) => r.closest("label")?.textContent)).toEqual(["0 - 20", "21 - 100", "101 - 500", "501 - 2,000", "2,000+"]);
    expect(container.querySelector(".wl-pass__meter-num")).toHaveTextContent("0%");
    await user.click(screen.getByRole("radio", { name: "501 - 2,000" }));
    expect(screen.getByRole("radio", { name: "501 - 2,000" })).toBeChecked();
    expect(container.querySelector(".wl-pass__meter-num")).toHaveTextContent("9%");
    expect(container.querySelector(".wl-pass")).toHaveTextContent("501 - 2,000");
    expect(container.querySelector(".wl-pass-stage")).toHaveAttribute("aria-hidden", "true");
  });

  it("follows the house style (no em-dashes, no read-only wording)", async () => {
    backend({ "GET resume": () => json(200, { success: true, data: { application: null } }) });
    const { container } = render(<WaitlistApp />);
    await screen.findByRole("heading", { name: "About your store" });
    for (const text of [container.textContent ?? "", page]) {
      expect(text).not.toContain("\u2014");
      expect(text.toLowerCase()).not.toContain("read-only");
    }
    await waitFor(() => expect(container.querySelector("h1")).toHaveTextContent("Apply to become a Founding Merchant"));
  });

  it("ships a static page that loads the app and works without a modal", () => {
    expect(page).toContain('<div id="revluma-waitlist" data-pending>');
    expect(page).toContain('src="/landing-hero/waitlist.js"');
    expect(page).toContain("<noscript>");
  });
});
