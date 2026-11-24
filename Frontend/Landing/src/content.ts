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
    "This is Rev Intelligence, the same chat merchants use inside Revluma. Ask about your store and follow the conversation: what happened, how Rev knows, what might explain it and what to do next.",
  sampleLabel: "Sample store · demonstration data",
  inputPlaceholder: "Ask Rev anything...",
  footer: "Rev Intelligence · Powered by your store data · Responses grounded in evidence",
  hint: "Tap a follow-up to continue",
  checks: [
    { label: "Orders", status: "completed" },
    { label: "Checkouts", status: "completed" },
    { label: "Products and inventory", status: "completed" },
    { label: "Traffic", status: "unavailable", note: "not connected" },
  ],
  sources: [
    { n: 1, label: "Orders" },
    { n: 2, label: "Checkouts" },
  ],
  // One exchange per step, in the real Rev answer layout. Each reply does one job.
  turns: {
    ask: {
      user: "Why did my sales drop last week?",
      working: "Checking orders, checkouts and products…",
      summary: "Sales fell 16.1% last week because fewer mobile checkouts were completed, starting on Wednesday.",
      followUp: "How do you know?",
    },
    verify: {
      user: "How do you know?",
      working: "Comparing last week with the week before…",
      lead: "Here's what your store records show.",
      facts: [
        { text: "Orders: 236, down from 281. Average order value unchanged.", cite: 1 },
        { text: "Mobile checkout completion: 38.2%, down from 48.4%, while mobile checkouts started held steady (345 → 340).", cite: 2 },
        { text: "Desktop checkout completion was unchanged at 61.6%.", cite: 2 },
        { text: "Mobile accounts for 37 of the 45 fewer orders.", cite: 1 },
      ],
      period: "Based on recorded store data for last week.",
      followUp: "What could be causing it?",
    },
    interpret: {
      user: "What could be causing it?",
      working: "Reviewing what the evidence can and can't show…",
      lead: "I can't confirm the cause from your store data, so here are possibilities to check, and what I can't see.",
      hypotheses: ["A theme, app or payment change to mobile checkout on Wednesday", "A payment method failing on phones"],
      unknowns: ["Theme, app and checkout-setting changes aren't visible to Revluma", "Traffic isn't connected, so mobile visits can't be checked"],
      followUp: "What should I do?",
    },
    recommend: {
      user: "What should I do?",
      working: "Preparing next steps…",
      lead: "Start with the mobile checkout itself.",
      recommendations: [
        { label: "Place a test order on a phone", why: "The drop is limited to mobile checkout.", measure: "mobile completion returns toward 48%." },
        { label: "Review what changed on Wednesday", why: "Theme publishes, new apps and payment settings." },
        { label: "Connect your analytics", why: "So Rev can check mobile traffic too." },
      ],
      note: "Recommendations only — nothing was changed or sent.",
      followUp: "Start over",
    },
  },
} as const;
