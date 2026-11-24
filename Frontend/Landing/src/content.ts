// Landing page copy and links, kept in one place so every claim can be
// reviewed against the product. Rules (approved blueprint v1):
//  - Shopify only; describe the MVP as it exists today.
//  - No invented metrics, testimonials, logos, or setup-time claims.
//  - Revluma reads merchant-authorised data; it does not change the store.

export const SIGN_IN_URL = "/login";
export const SIGN_UP_URL = "/auth/signup";

export const NAV_LINKS = [
  { label: "Platform", href: "#platform" },
  { label: "How It Works", href: "#how-it-works" },
  { label: "Why Revluma", href: "#why-revluma" },
  { label: "FAQ", href: "#faq" },
] as const;

export const CTA = {
  primary: { label: "Join Waitlist", href: "#founding-merchants" },
  primaryShort: { label: "Join Waitlist", href: "#founding-merchants" },
  secondary: { label: "Sign Up", href: SIGN_UP_URL },
} as const;

export const HERO = {
  headline: { lead: ["Know where", "your store is"], accent: "losing revenue." },
  subline: "Understand why. Know what deserves attention.",
  body:
    "Revluma investigates your Shopify store data to uncover potential revenue leaks, explain the evidence behind them, and help you decide what to address first.",
  // The data hub under the CTAs: what Revluma reads from Shopify. Only data the
  // store sync actually reads (Backend/src/services/shopifySync.js), and no
  // other integrations: Revluma is Shopify only.
  sources: {
    label: "Revluma reads your Shopify orders, products, customers, refunds and abandoned checkouts. Read-only: your store stays unchanged.",
    items: ["Shopify", "Orders", "Products", "Customers", "Refunds", "Abandoned checkouts"],
  },
} as const;

// Section 3: the problem, before the solution. Worded so it never claims that
// every Shopify merchant has these problems; it is the problem Revluma is
// designed to address. The mini illustrations use labels only, no figures.
export const PROBLEM = {
  eyebrow: "The problem",
  headline: { lead: "Your store generates data.", accent: "But does it explain what's going wrong?" },
  intro:
    "Orders, products, inventory and customer activity are all there to look at. Working out what they mean together, and what to do about it, is a different job.",
  items: [
    {
      id: "answers",
      title: "Information without answers",
      body: "You can see orders, products, inventory and customer activity, and still struggle to understand what is driving a problem.",
    },
    {
      id: "evidence",
      title: "Disconnected evidence",
      body: "Important clues can sit across different areas of the store, which makes it hard to investigate a problem in context.",
    },
    {
      id: "priorities",
      title: "Unclear priorities",
      body: "You may notice several issues at once, without a clear way to decide which one deserves attention first.",
    },
  ],
  closing: "This is the problem Revluma is designed to address.",
} as const;
