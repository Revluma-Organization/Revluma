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
  headline: {
    lead: ["Know where", "your store is"],
    accent: "losing revenue.",
  },
  subline: "Understand why. Know what deserves attention.",
  body: "Revluma investigates your Shopify store data to uncover potential revenue leaks, explain the evidence behind them, and help you decide what to address first.",
  // The data hub under the CTAs: what Revluma reads from Shopify. Only data the
  // store sync actually reads (Backend/src/services/shopifySync.js), and no
  // other integrations: Revluma is Shopify only.
  sources: {
    label: "Revluma reads your Shopify orders, products, customers, refunds and abandoned checkouts. Read-only: your store stays unchanged.",
    items: ["Shopify", "Orders", "Products", "Customers", "Refunds", "Abandoned checkouts"],
  },
} as const;

// Features ("What Revluma does"): four capabilities framed as the merchant
// problems they address. Revluma is read-only: it detects, investigates,
// prioritises and recommends; it never changes the store, runs campaigns or
// promises recovered revenue. The product visuals are labelled samples built
// from the app's own Command Center and Rev Intelligence patterns, with no
// money figures.
export const FEATURES = {
  eyebrow: "What Revluma does",
  headline: {
    lead: "Everything affecting your revenue.",
    accent: "Finally, understood.",
  },
  description:
    "Your store generates signals every day. Revluma connects the dots, uncovers what's going wrong, and shows you where to focus before more opportunities slip away.",
  items: [
    {
      id: "detect",
      step: "Detect",
      title: "Catch revenue problems before they become bigger losses.",
      body: "Revluma examines your store's operational and commerce data to surface unusual patterns, missed opportunities, and potential revenue leaks that deserve your attention.",
    },
    {
      id: "investigate",
      step: "Investigate",
      title: "Don't just see what's wrong. Understand why.",
      body: "Revluma investigates underlying evidence, connects related signals, and explains the factors that might be contributing to a business problem.",
    },
    {
      id: "prioritize",
      step: "Prioritize",
      title: "Know what deserves your attention first.",
      body: "Not every problem has the same impact. Revluma evaluates identified issues against their potential business impact, urgency, and available evidence so you can focus on what matters most.",
    },
    {
      id: "advise",
      step: "Advise & Monitor",
      title: "Turn business insights into measurable next steps.",
      body: "Revluma recommends practical actions based on its findings, explains why they matter, and helps merchants monitor relevant signals to understand whether things are improving.",
      note: "Review only. Revluma never changes your store.",
    },
  ],
} as const;

// Section 4: how it works (three steps). Revluma reads store data and explains
// it; the merchant decides. No setup-time, automation or recovery claims.
export const HOW_IT_WORKS = {
  eyebrow: "Understand your store in three steps",
  headline: { lead: "From raw store data", accent: "to clear business intelligence." },
  description:
    "No complex workflows. No manual data analysis. Connect your Shopify store, let Revluma investigate the evidence, and understand what deserves your attention.",
  steps: [
    {
      id: "connect",
      label: "Connect your store",
      title: "Bring your Shopify data into Revluma.",
      body: "Securely connect your Shopify store and authorize access to the data Revluma needs. Your store information becomes the foundation for understanding your business.",
    },
    {
      id: "analyze",
      label: "Revluma analyzes your business",
      title: "Discover what's happening beneath the surface.",
      body: "Revluma organizes and analyzes your available store data, verifies evidence, detects meaningful patterns and investigates potential revenue leaks, purchasing problems and operational issues.",
    },
    {
      id: "understand",
      label: "Understand what matters. Know what to do next.",
      title: "Turn business intelligence into informed decisions.",
      body: "Revluma prioritizes the issues that deserve your attention, explains why they matter, presents supporting evidence and recommends practical next steps to help you make better business decisions.",
    },
  ],
} as const;
