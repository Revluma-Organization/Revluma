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
      note: "Recommendations only. Nothing was changed or sent.",
      followUp: "Start over",
    },
  },
} as const;

// Founding Merchants Program: an honest early-access invitation. No number of
// places is stated (capacity is not fixed), and nothing is promised that the
// programme cannot deliver: early access, a direct line to the team, and a say
// in what Revluma investigates. Revluma stays read-only.
export const FOUNDING = {
  eyebrow: "Founding Merchants Program",
  headline: { lead: "Help shape the next generation", accent: "of store intelligence." },
  description:
    "We're inviting a select group of Shopify merchants to experience Revluma early, share their operational challenges, and help shape a more useful way to understand their businesses.",
  cta: "Apply to Become a Founding Merchant",
  ctaNote: "For Shopify merchants. After you apply, we'll get in touch about next steps.",
  steps: [
    { title: "Apply", body: "Tell us about your store and what's hard to understand today." },
    { title: "Talk with us", body: "We'll reach out to learn about the operational challenges you face." },
    { title: "Get early access", body: "Connect your Shopify store with read-only access and start using Revluma." },
  ],
  pass: {
    label: "Founding Merchant",
    program: "Early access invitation",
    fields: [
      { label: "Store", value: "your-store.myshopify.com" },
      { label: "Access", value: "Read-only" },
      { label: "Status", value: "Applications open" },
    ],
  },
  offer: {
    title: "What founding merchants get",
    items: [
      { id: "access", title: "Early access", body: "Use Revluma before it's publicly available." },
      { id: "team", title: "A direct line to the team", body: "Talk with the people building Revluma, not a ticket queue." },
      { id: "shape", title: "A say in what we build", body: "Your challenges shape what Revluma investigates and explains." },
    ],
  },
  ask: {
    title: "What we ask",
    items: ["A Shopify store you actively run", "Time to share the challenges you face", "Honest feedback on what's useful and what isn't"],
  },
} as const;

// Section 11: FAQ. Answers describe the product as it is today, checked
// against the code, not the roadmap:
//  - Shopify only; OAuth requests read scopes only (Backend/src/utils/shopify.js
//    buildInstallUrl); reauthorisation may only ever add read_* scopes.
//  - Synced data: orders, refunds, customers, products, inventory, locations,
//    abandoned checkouts, plus store policies and navigation. Storefront
//    traffic is not collected (web pixel not implemented).
//  - Rev's claim grades (python/src/intelligence/epistemics.py, rev-claim-v1):
//    verified_fact, calculated_observation, hypothesis, unknown. Unknowns carry
//    no value; a missing value is never treated as zero (evidence_quality).
//  - Investigation runtime (python/src/agents/investigation.py): plan, run
//    authorised read-only tools, validate evidence, separate facts from
//    hypotheses; a failed tool degrades the answer instead of inventing one.
//  - Access is early access, opened gradually via the Founding Merchants Program.
export const FAQ = {
  eyebrow: "FAQ",
  headline: { lead: "Questions worth asking", accent: "before you join." },
  description: "Straight answers about what Revluma is, what it can see in your store, and how Rev reaches its conclusions today.",
  aside: {
    title: "Still have a question?",
    body: "Apply to the Founding Merchants Program and ask us directly. You'll talk with the people building Revluma.",
  },
  items: [
    {
      id: "what",
      q: "What exactly is Revluma?",
      a: [
        "Revluma is store intelligence for Shopify. It reads your store's data, investigates potential revenue leaks, explains the evidence behind each one, and helps you decide what to address first.",
        "Rev is how you work with it: ask a question about your store in plain language and Rev shows what happened, how it knows, and what to look at next.",
      ],
    },
    {
      id: "who",
      q: "Who is Revluma built for?",
      a: [
        "Shopify merchants who want to understand what's affecting their store without digging through reports themselves: founders, operators and small teams who need to know where revenue may be slipping and what deserves attention first.",
      ],
    },
    {
      id: "shopify",
      q: "Does Revluma work with Shopify?",
      a: [
        "Yes. Revluma is built for Shopify and works with Shopify stores only. You connect your store through Shopify's own authorization screen, which lists exactly what access is being requested before you approve it.",
      ],
    },
    {
      id: "data",
      q: "What Shopify data can it access?",
      a: [
        "Only the data you authorize. Revluma reads the following, and doesn't request permission to edit any of it:",
        "Your store's policies and navigation are read as well. Storefront traffic isn't collected today, and Rev tells you when that limits an answer.",
      ],
      data: ["Orders", "Refunds", "Customers", "Products", "Inventory", "Locations", "Abandoned checkouts"],
    },
    {
      id: "changes",
      q: "Does Revluma make changes to my store?",
      a: [
        "No. Revluma has read-only access. It analyzes your data and recommends next steps, but it doesn't edit products, prices, discounts or orders, and it doesn't contact your customers. Every change is your decision, made in Shopify.",
      ],
    },
    {
      id: "investigate",
      q: "How does Rev investigate potential revenue leaks?",
      a: [
        "When you ask a question, Rev plans an investigation, retrieves the relevant evidence from your store records, checks its quality and runs the calculations.",
        "It then explains what happened, cites the source and period behind each statement, sets out what might explain it, and recommends practical next steps, with what to watch to see whether things improve.",
      ],
    },
    {
      id: "facts",
      q: "How does Revluma distinguish facts from assumptions?",
      a: ["Every statement Rev makes is classified before you see it, and an answer that doesn't follow these rules is rejected rather than shown."],
      grades: [
        { label: "Verified fact", tone: "verified", body: "Taken directly from your store records." },
        { label: "Calculated", tone: "verified", body: "Derived from those records, such as a rate or a change between periods." },
        { label: "Hypothesis", tone: "partial", body: "A possible explanation the data doesn't confirm. Never presented as fact." },
        { label: "Unknown", tone: "unknown", body: "Something the available data can't answer. Rev says so instead of guessing." },
      ],
    },
    {
      id: "unavailable",
      q: "What happens when some data is unavailable?",
      a: [
        "Rev tells you. It shows which data was missing, partial or not yet synced and how that limits the answer, instead of filling the gap with an estimate. A missing value is never treated as zero.",
        "If one source fails, Rev still answers from the evidence it has and marks what it couldn't check. Where authorizing more data would help, it points that out.",
      ],
    },
    {
      id: "availability",
      q: "Is Revluma available to everyone yet?",
      a: [
        "Not yet. Revluma is in early access for Shopify merchants. We're opening it gradually, starting with the Founding Merchants Program, so we can work closely with each store and shape the product around what merchants actually need.",
      ],
    },
    {
      id: "founding",
      q: "How can I become a founding merchant?",
      a: [
        "Apply through the Founding Merchants Program and tell us about your store and what's hard to understand today. We'll get in touch to learn about your challenges. Then you connect your store with read-only access and start using Revluma.",
      ],
      cta: true,
    },
  ],
} as const;

// Pricing: the plans, prices and feature lists exactly as approved by the
// founder (2026-11-25). Yearly billing is 20% off the monthly price, rounded
// down to the dollar ($29 -> $23, $79 -> $63). Starter and Premium start at
// the real sign-up page; Starter and Premium include the backend's 7-day
// trial, which starts without payment details (subscriptionController
// startTrial). Enterprise goes to the team by email.
export const PRICING = {
  eyebrow: "Pricing",
  headline: { lead: "Simple, transparent", accent: "pricing." },
  description: "Every plan is read-only, built for Shopify and grounded in your store's evidence.",
  billing: {
    monthly: "Monthly",
    yearly: "Yearly",
    save: "Save 20%",
    monthlyNote: "Billed monthly",
  },
  plans: [
    {
      id: "starter",
      name: "Starter",
      price: { monthly: 29, yearly: 23 },
      description: "For merchants getting started with operational intelligence.",
      features: [
        "1 Shopify store",
        "Core store intelligence",
        "Automated signal monitoring",
        "Ranked Top Priorities",
        "Evidence and reasoning",
        "Essential Rev Intelligence access",
        "Basic historical findings",
        "Standard support",
      ],
      cta: { label: "Start free trial", kind: "signup" },
    },
    {
      id: "premium",
      name: "Premium",
      badge: "Recommended",
      price: { monthly: 79, yearly: 63 },
      description: "For growing merchants who want deeper intelligence.",
      includes: "Everything in Starter, plus:",
      features: [
        "Deeper business investigations",
        "Higher Rev Intelligence allowance",
        "More extensive historical analysis",
        "Advanced findings and prioritisation",
        "More detailed evidence exploration",
        "Advanced business performance insights",
        "Priority support",
      ],
      cta: { label: "Start free trial", kind: "signup" },
    },
    {
      id: "enterprise",
      name: "Enterprise",
      customPrice: "Custom pricing",
      priceNote: "Tailored to your business",
      description: "For established businesses with complex requirements.",
      features: [
        "Custom intelligence allowances",
        "Multi-store capabilities",
        "Multiple team members",
        "Advanced access and permissions",
        "Dedicated onboarding",
        "Custom reporting requirements",
        "Dedicated account support",
        "Custom commercial agreements",
      ],
      cta: { label: "Contact our team", kind: "contact" },
    },
  ],
  contactHref: "mailto:hello@revluma.com?subject=Revluma%20Enterprise",
  trial: "Starter and Premium include a 7-day free trial. No credit card required.",
  assurances: [
    { id: "readonly", label: "Read-only Shopify access on every plan" },
    { id: "usd", label: "Prices in US dollars" },
  ],
  faqLink: { label: "Questions? Read the FAQ", href: "#faq" },
} as const;
