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

// Section 6: Meet Rev, the intelligence interface. One worked interaction
// from a sample store (clearly labelled as demonstration data). The numbers
// are internally consistent:
//   sales   18,420 vs 21,960 -> -16.1% ; orders 236 vs 281 -> -16.0%
//   AOV     78.05 vs 78.15 (unchanged). No money is shown on the page.
//   mobile  130 of 340 checkouts completed (38.2%) vs 167 of 345 (48.4%)
//   desktop 106 of 172 (61.6%) vs 114 of 185 (61.6%)
//   37 of the 45 fewer orders are mobile; daily mobile rates average 38.2%.
// Rev reads data and recommends; it never changes the store.
export const MEET_REV = {
  eyebrow: "Meet Rev",
  headline: { lead: "Don't just look at the numbers.", accent: "Understand what they mean." },
  description:
    "Ask Rev about your store in plain language. It answers one step at a time: what happened, how it knows, what might explain it and what to do next.",
  sampleLabel: "Sample store · demonstration data",
  hint: "Tap the suggested reply to continue",
  inputPlaceholder: "Ask Rev about your store…",
  investigating: "Investigating your store evidence",
  checks: [
    { label: "Orders", status: "done" },
    { label: "Checkouts", status: "done" },
    { label: "Products", status: "done" },
    { label: "Traffic", status: "unavailable", note: "not connected" },
  ],
  chart: {
    label: "Mobile checkout completion",
    days: [
      { day: "Mon", value: 48.1 },
      { day: "Tue", value: 47.5 },
      { day: "Wed", value: 36.2 },
      { day: "Thu", value: 34.0 },
      { day: "Fri", value: 33.1 },
      { day: "Sat", value: 34.6 },
      { day: "Sun", value: 33.9 },
    ],
    previousWeek: 48.4,
  },
  sources: [
    { n: 1, label: "Orders" },
    { n: 2, label: "Checkouts" },
  ],
  // One exchange per step. Each Rev reply is short and does one job.
  turns: {
    ask: {
      user: "Why did my sales drop last week?",
      summary: "Sales fell 16.1% last week because fewer mobile checkouts were completed, starting on Wednesday.",
    },
    verify: {
      user: "How do you know?",
      lead: "Here's what your store records show, compared with the week before:",
      facts: [
        { text: "Orders fell from 281 to 236. Average order value didn't change.", cite: 1 },
        { text: "Mobile checkout completion fell from 48.4% to 38.2%. Desktop held at 61.6%.", cite: 2 },
        { text: "Mobile checkouts started held steady (345 → 340), so mobile accounts for 37 of the 45 fewer orders.", cite: 2 },
      ],
    },
    interpret: {
      user: "What could be causing it?",
      lead: "I can't confirm the cause yet, so treat these as possibilities:",
      hypotheses: ["A theme, app or payment change to mobile checkout on Wednesday", "A payment method failing on phones"],
      gapsLead: "What I can't see:",
      unknowns: ["Theme, app and setting changes", "Traffic, because it isn't connected"],
    },
    recommend: {
      user: "What should I do?",
      lead: "Here's where I'd start:",
      recommendations: [
        { label: "Place a test order on a phone", why: "then watch mobile completion return toward 48%." },
        { label: "Check what changed on Wednesday", why: "theme publishes, new apps, payment settings." },
        { label: "Connect your analytics", why: "so I can check mobile traffic too." },
      ],
      note: "Recommendations only. Nothing was changed or sent.",
    },
  },
  restart: "Start over",
} as const;
