/**
 * Founding Merchants application: questions, option keys and client-side
 * validation. The keys and rules mirror Backend/src/utils/waitlistApplication.js,
 * which is authoritative: the page checks first for quick feedback, the server
 * checks again before anything is saved.
 */

export type Option<K extends string = string> = { readonly value: K; readonly label: string; readonly hint?: string };

export const STORE_AGE = [
  { value: "lt_3m", label: "Under 3 months" },
  { value: "3_6m", label: "3 - 6 months" },
  { value: "6_12m", label: "6 - 12 months" },
  { value: "1_3y", label: "1 - 3 years" },
  { value: "3y_plus", label: "3+ years" },
] as const satisfies readonly Option[];

export const MONTHLY_ORDERS = [
  { value: "0_20", label: "0 - 20" },
  { value: "21_100", label: "21 - 100" },
  { value: "101_500", label: "101 - 500" },
  { value: "501_2000", label: "501 - 2,000" },
  { value: "2000_plus", label: "2,000+" },
] as const satisfies readonly Option[];

export const CHALLENGES = [
  { value: "browse_no_purchase", label: "Visitors browse but don't purchase" },
  { value: "cart_abandonment", label: "Customers abandon their carts" },
  { value: "declining_sales", label: "Sales are declining unexpectedly" },
  { value: "operational_inefficiency", label: "Operational inefficiencies are affecting revenue" },
  { value: "inventory_availability", label: "Inventory and product availability issues" },
  { value: "unclear_whats_wrong", label: "I struggle to understand what's going wrong in my store" },
  { value: "prioritization", label: "I don't know which problems to prioritize" },
  { value: "other", label: "Other" },
] as const satisfies readonly Option[];

export const PROBLEM_DISCOVERY = [
  { value: "shopify_analytics", label: "Shopify Analytics" },
  { value: "other_analytics", label: "Other analytics tools" },
  { value: "tools_spreadsheets", label: "Multiple tools and spreadsheets" },
  { value: "manual", label: "I investigate manually" },
  { value: "after_sales_affected", label: "I usually discover problems after sales are affected" },
  { value: "no_process", label: "I don't have a reliable process" },
] as const satisfies readonly Option[];

export const PRICES = [
  { value: "free", label: "Free" },
  { value: "usd_19", label: "$19" },
  { value: "usd_29", label: "$29" },
  { value: "usd_49", label: "$49" },
  { value: "usd_79", label: "$79" },
  { value: "usd_99", label: "$99" },
  { value: "usd_149", label: "$149" },
  { value: "usd_199", label: "$199" },
  { value: "usd_299", label: "$299" },
  { value: "usd_500_plus", label: "$500+" },
] as const satisfies readonly Option[];

export const CAPABILITIES = [
  { value: "revenue_leaks", label: "Detecting hidden revenue leaks" },
  { value: "why_not_purchasing", label: "Understanding why customers aren't purchasing" },
  { value: "checkout_cart", label: "Identifying checkout and cart problems" },
  { value: "unusual_changes", label: "Detecting unusual sales or performance changes" },
  { value: "inventory_risks", label: "Identifying inventory-related revenue risks" },
  { value: "prioritized_recommendations", label: "Receiving prioritized recommendations" },
  { value: "monitoring_improvement", label: "Monitoring whether business problems are improving" },
] as const satisfies readonly Option[];

export const FOUNDING_INTEREST = [
  { value: "yes", label: "Yes, I'd love to participate" },
  { value: "maybe", label: "Maybe, I'd like to learn more" },
  { value: "not_now", label: "Not right now" },
] as const satisfies readonly Option[];

export const MAX_CAPABILITIES = 3;

export type Step1 = {
  full_name: string;
  work_email: string;
  store_name: string;
  store_url: string;
  phone: string;
  store_age: string | null;
  monthly_orders: string | null;
};
export type Step2 = { challenges: string[]; challenge_other: string; problem_discovery: string | null };
export type Step3 = { price_willingness: string | null; capabilities: string[]; founding_interest: string | null };
export type Answers = Step1 & Step2 & Step3;
export type StepNumber = 1 | 2 | 3;
export type Errors = Partial<Record<keyof Answers, string>>;

export const EMPTY_ANSWERS: Answers = {
  full_name: "",
  work_email: "",
  store_name: "",
  store_url: "",
  phone: "",
  store_age: null,
  monthly_orders: null,
  challenges: [],
  challenge_other: "",
  problem_discovery: null,
  price_willingness: null,
  capabilities: [],
  founding_interest: null,
};

export const STEP_FIELDS: Record<StepNumber, readonly (keyof Answers)[]> = {
  1: ["full_name", "work_email", "store_name", "store_url", "phone", "store_age", "monthly_orders"],
  2: ["challenges", "challenge_other", "problem_discovery"],
  3: ["price_willingness", "capabilities", "founding_interest"],
};

export const STEPS = [
  { number: 1, title: "About your store" },
  { number: 2, title: "Your challenges" },
  { number: 3, title: "Pricing and priorities" },
] as const;

const UNSAFE = /[<>\u0000-\u001f\u007f]/;
const clean = (value: string) => value.replace(/\s+/g, " ").trim();
const has = (list: readonly Option[], value: string | null) => value !== null && list.some((option) => option.value === value);

export function normaliseEmail(value: string): string | null {
  const email = value.trim().toLowerCase();
  if (email.length > 254) return null;
  if (!/^[^\s@<>()[\]\\,;:"]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,63}$/.test(email)) return null;
  return email.split("@")[0].length > 64 ? null : email;
}

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** Same rules as the server: myshopify address, handle, admin URL or custom domain. */
export function normaliseShopifyUrl(value: string): string | null {
  let input = value.trim().toLowerCase();
  if (!input || input.length > 300) return null;
  input = input.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  const admin = input.match(/^admin\.shopify\.com\/store\/([a-z0-9][a-z0-9-]*)/);
  if (admin) input = `${admin[1]}.myshopify.com`;
  let host = input
    .replace(/[/?#].*$/, "")
    .replace(/:\d+$/, "")
    .replace(/\.$/, "");
  if (host.includes("@")) return null;
  if (host.startsWith("www.")) host = host.slice(4);
  if (!host.includes(".")) {
    if (!/^[a-z0-9][a-z0-9-]{1,60}[a-z0-9]$/.test(host)) return null;
    host = `${host}.myshopify.com`;
  }
  if (host.length > 253) return null;
  const labels = host.split(".");
  if (labels.length < 2 || !labels.every((label) => LABEL.test(label))) return null;
  if (!/^[a-z]{2,63}$/.test(labels[labels.length - 1])) return null;
  if (host.endsWith(".myshopify.com") && labels.length !== 3) return null;
  if (host.includes("myshopify.com") && !host.endsWith(".myshopify.com")) return null;
  if (host === "myshopify.com" || host === "shopify.com" || host.endsWith(".shopify.com")) return null;
  return `https://${host}`;
}

/** undefined = invalid, "" = left empty. */
export function normalisePhone(value: string): string | undefined {
  const raw = value.trim();
  if (!raw) return "";
  if (!/^[+\d\s().\-/]+$/.test(raw)) return undefined;
  const digits = raw.replace(/\D/g, "");
  const local = !raw.startsWith("+") && digits.startsWith("00") ? digits.slice(2) : digits;
  if (local.length < 7 || local.length > 15) return undefined;
  return raw.startsWith("+") || digits.startsWith("00") ? `+${local}` : local;
}

export function validateStep(step: StepNumber, a: Answers): Errors {
  const errors: Errors = {};
  if (step === 1) {
    const name = clean(a.full_name);
    if (name.length < 2 || name.length > 120 || UNSAFE.test(name)) errors.full_name = "Enter your full name.";
    if (!normaliseEmail(a.work_email)) errors.work_email = "Enter a valid work email, like you@yourstore.com.";
    const store = clean(a.store_name);
    if (!store || store.length > 120 || UNSAFE.test(store)) errors.store_name = "Enter your brand or store name.";
    if (!normaliseShopifyUrl(a.store_url)) errors.store_url = "Enter your Shopify store address, like yourstore.myshopify.com.";
    if (normalisePhone(a.phone) === undefined) errors.phone = "Enter a phone or WhatsApp number with 7 - 15 digits, or leave it empty.";
    if (!has(STORE_AGE, a.store_age)) errors.store_age = "Choose how long your store has been running.";
    if (!has(MONTHLY_ORDERS, a.monthly_orders)) errors.monthly_orders = "Choose your typical monthly orders.";
  } else if (step === 2) {
    if (!a.challenges.length || !a.challenges.every((c) => has(CHALLENGES, c))) errors.challenges = "Choose at least one challenge.";
    const other = clean(a.challenge_other);
    if (a.challenges.includes("other") && (other.length > 300 || UNSAFE.test(other))) errors.challenge_other = "Keep it under 300 characters, without < or >.";
    if (!has(PROBLEM_DISCOVERY, a.problem_discovery)) errors.problem_discovery = "Choose how you usually find problems.";
  } else {
    if (!has(PRICES, a.price_willingness)) errors.price_willingness = "Choose what you would pay each month.";
    if (a.capabilities.length > MAX_CAPABILITIES) errors.capabilities = `Choose up to ${MAX_CAPABILITIES}.`;
    else if (!a.capabilities.length) errors.capabilities = `Choose between 1 and ${MAX_CAPABILITIES} capabilities.`;
    if (!has(FOUNDING_INTEREST, a.founding_interest)) errors.founding_interest = "Let us know if you would like to take part.";
  }
  return errors;
}

/** The request body for a step (what the API expects). */
export function stepPayload(step: StepNumber, a: Answers): Record<string, unknown> {
  if (step === 1) {
    return {
      full_name: clean(a.full_name),
      work_email: a.work_email.trim(),
      store_name: clean(a.store_name),
      store_url: a.store_url.trim(),
      phone: a.phone.trim(),
      store_age: a.store_age,
      monthly_orders: a.monthly_orders,
    };
  }
  if (step === 2) {
    return {
      challenges: a.challenges,
      challenge_other: a.challenges.includes("other") ? clean(a.challenge_other) : "",
      problem_discovery: a.problem_discovery,
    };
  }
  return { price_willingness: a.price_willingness, capabilities: a.capabilities, founding_interest: a.founding_interest };
}

export function labelOf(list: readonly Option[], value: string | null | undefined): string {
  return list.find((option) => option.value === value)?.label ?? "";
}
