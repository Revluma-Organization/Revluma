// Centralized tour steps for the Overview page.
// `target` matches a [data-tour="..."] attribute somewhere in the DOM.
// Add new steps here — the tour will auto-update its (X/Total) counter.

export interface TourStep {
  target: string;
  title: string;
  body: string;
  placement?: "auto" | "top" | "bottom" | "left" | "right";
}

export const TOUR_STEPS: TourStep[] = [
  {
    target: "sidebar",
    title: "Your command center",
    body: "Navigate every workspace from here — Overview, Cart Recovery, Campaigns, Analytics and more. The sidebar collapses on smaller screens and remembers your preference.",
    placement: "right",
  },
  {
    target: "topbar-breadcrumb",
    title: "Breadcrumbs & context",
    body: "Always know where you are. Breadcrumbs reflect the current section and update as you navigate deeper into the product.",
    placement: "bottom",
  },
  {
    target: "topbar-date",
    title: "Date range filter",
    body: "Scope every metric on the page to a specific window — Today, Last 7 / 30 / 90 days, or This year. All charts and KPIs respond instantly.",
    placement: "bottom",
  },
  {
    target: "topbar-search",
    title: "Global search (⌘K)",
    body: "Press ⌘K (Ctrl+K on Windows) anywhere to jump to a page, run a quick action, or search customers, campaigns and orders.",
    placement: "bottom",
  },
  {
    target: "topbar-copilot",
    title: "AI Copilot",
    body: "Ask the Copilot to summarize performance, draft win-back campaigns, or explain a metric. It's context-aware to whatever you're viewing.",
    placement: "bottom",
  },
  {
    target: "topbar-notif",
    title: "Live notifications",
    body: "Recoveries, alerts, campaign milestones and AI insights stream in here in real time. The dot means you have unread updates.",
    placement: "bottom",
  },
  {
    target: "topbar-tour",
    title: "Restart this tour anytime",
    body: "Click this icon whenever you want to revisit any part of the dashboard — the tour will guide you again, step by step.",
    placement: "bottom",
  },
  {
    target: "connect-banner",
    title: "Connect your store",
    body: "Link Shopify, WooCommerce or BigCommerce to start syncing customers, carts and orders. Recovery automations activate instantly after connecting.",
    placement: "bottom",
  },
  {
    target: "welcome",
    title: "Personalized welcome",
    body: "A daily snapshot of what's happening with your store — tailored to the data you actually care about.",
    placement: "bottom",
  },
  {
    target: "kpi-grid",
    title: "Headline KPIs",
    body: "Six core metrics at a glance: Revenue Recovered, Abandoned Carts, Recovery Rate, Active Subscribers, Revenue at Risk, and Opportunity Score. Each card shows a trend sparkline and benchmark.",
    placement: "auto",
  },
  {
    target: "kpi-rev",
    title: "Revenue Recovered",
    body: "How much revenue your recovery sequences pulled back this period — compared to the average store of your size.",
    placement: "bottom",
  },
  {
    target: "kpi-carts",
    title: "Abandoned Carts",
    body: "Live count of carts left behind, plus the dollar value currently at risk. Each one is a recovery opportunity.",
    placement: "bottom",
  },
  {
    target: "kpi-rate",
    title: "Recovery Rate",
    body: "Percentage of abandoned carts you successfully bring back. Top stores hit 28%+ — Revluma helps close the gap.",
    placement: "bottom",
  },
  {
    target: "kpi-subs",
    title: "Active Subscribers",
    body: "Your reachable audience across email, SMS and WhatsApp. Growth here directly fuels recovery revenue.",
    placement: "auto",
  },
  {
    target: "kpi-risk",
    title: "Revenue at Risk",
    body: "Total dollar value of carts currently abandoned. Recovery sequences are racing the clock to win this back.",
    placement: "auto",
  },
  {
    target: "kpi-score",
    title: "Opportunity Score",
    body: "An AI-blended score from 0 to 100 measuring the upside still available — list health, sequence coverage, timing and more.",
    placement: "auto",
  },
  {
    target: "revenue-chart",
    title: "Cart Recovery Performance",
    body: "Visualize abandoned vs recovered revenue over 7, 30 or 90 days. All amounts are shown in dollars so you can act on the numbers immediately.",
    placement: "auto",
  },
  {
    target: "live-activity",
    title: "Live Activity feed",
    body: "Watch recoveries, new abandons, opens and signups happen in real time — the heartbeat of your store.",
    placement: "left",
  },
  {
    target: "sequences",
    title: "Recovery Email Sequences",
    body: "Performance for every Email, SMS and WhatsApp sequence — sent, open, click, conversion and revenue per recipient — benchmarked against Klaviyo 2024 data.",
    placement: "auto",
  },
  {
    target: "abandoned-products",
    title: "Top abandoned products",
    body: "The SKUs leaving the most money on the table, with their recovery status (recovered, in sequence, lost).",
    placement: "left",
  },
  {
    target: "ai-insights",
    title: "AI Insights",
    body: "Proactive recommendations from your AI analyst — timing windows, channel gaps, and behavior patterns you'd otherwise miss.",
    placement: "auto",
  },
  {
    target: "attribution",
    title: "Revenue Attribution",
    body: "See exactly which channel — Email, SMS, Direct or On-site — is closing your recovered revenue.",
    placement: "auto",
  },
  {
    target: "health-score",
    title: "Store Health Score",
    body: "A composite health grade across recovery rate, deliverability, list growth, AOV and abandonment. Aim for an A.",
    placement: "left",
  },
  {
    target: "analytics-strip",
    title: "Deeper analytics",
    body: "Quick-glance metrics on AOV, LTV, abandon spend, repeat purchase and list growth — your store's vital signs.",
    placement: "top",
  },
  {
    target: "innovation-row",
    title: "Innovation widgets",
    body: "Forward-looking metrics: identity resolution, sequence momentum, deliverability and predicted recovery — what's coming, not just what happened.",
    placement: "top",
  },
  {
    target: "quick-actions",
    title: "Quick Actions",
    body: "One-click shortcuts to launch campaigns, export reports, invite teammates, or connect new integrations.",
    placement: "top",
  },
  {
    target: "trending-products",
    title: "Winning Products",
    body: "Your fastest-rising recovered SKUs this period — a great starting point for new campaigns and ads.",
    placement: "top",
  },
  {
    target: "winback",
    title: "Win-back Leaderboard",
    body: "Top customers brought back by your recovery flows. Reward them, segment them, or upsell — they're your highest-intent audience. You're all set!",
    placement: "top",
  },
];
