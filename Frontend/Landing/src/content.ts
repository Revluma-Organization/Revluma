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
    "Rev is the intelligence interface at the centre of Revluma. Ask about your store in plain language. Rev investigates the data that's available, separates what it verified from what it suspects, says what's missing, and recommends sensible next steps.",
  sampleLabel: "Sample store · demonstration data",
  period: "last week (Mon – Sun)",
  comparedTo: "the week before",
  question: "Why did my sales drop last week?",
  checks: [
    { label: "Orders and sales", status: "done" },
    { label: "Checkouts by device", status: "done" },
    { label: "Products and inventory", status: "done" },
    { label: "Traffic and sessions", status: "unavailable", note: "not connected" },
  ],
  summary:
    "Sales fell 16.1% because fewer mobile checkouts were completed, starting on Wednesday. Mobile shoppers reached checkout as often as the week before; fewer of them finished it.",
  facts: [
    { text: "Sales were down 16.1% on the week before.", cite: 1 },
    { text: "Orders fell from 281 to 236, while average order value was unchanged.", cite: 1 },
    { text: "Mobile checkout completion fell from 48.4% to 38.2%. Desktop held steady at 61.6%.", cite: 2 },
    { text: "Mobile checkouts started held steady (345 → 340). Mobile accounts for 37 of the 45 fewer orders.", cite: 2 },
    { text: "None of your top sellers were out of stock during the week.", cite: 3 },
  ],
  chart: {
    label: "Mobile checkout completion by day",
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
  hypotheses: [
    "Something in the mobile checkout may have changed on Wednesday, such as a theme update, an app or a payment setting.",
    "A payment method may be failing on mobile devices.",
  ],
  unknowns: [
    "Revluma can't see theme, app or checkout-setting changes, so I can't confirm what changed on Wednesday.",
    "Traffic data isn't connected, so I can't check whether mobile visits also changed.",
  ],
  sources: [
    { n: 1, label: "Orders" },
    { n: 2, label: "Checkouts" },
    { n: 3, label: "Products" },
  ],
  recommendations: [
    {
      label: "Place a test order on a phone",
      why: "The drop is limited to mobile checkout and began on Wednesday.",
      measure: "Mobile completion moves back toward 48%.",
    },
    {
      label: "Review what changed on Wednesday",
      why: "Look for a theme publish, a newly installed app or a payment setting change that day.",
    },
    {
      label: "Connect your analytics",
      why: "So Rev can tell whether mobile traffic changed as well.",
    },
  ],
  followUps: ["Show mobile checkouts by day", "Compare payment methods on mobile"],
  steps: [
    { id: "ask", title: "You ask", body: "A question about your store, in plain language." },
    { id: "investigate", title: "Rev investigates", body: "It checks the store data that's available and says which checks ran." },
    { id: "verify", title: "Verified facts", body: "Only what the records confirm, each with its source." },
    { id: "interpret", title: "Possible explanations", body: "Labelled as hypotheses, never presented as facts." },
    { id: "gaps", title: "What's missing", body: "What Rev couldn't check, and what would close the gap." },
    { id: "recommend", title: "Next steps", body: "Practical recommendations for you to review. Nothing in your store is changed." },
  ],
} as const;
