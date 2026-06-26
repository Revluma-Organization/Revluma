// Centralized mock data + types for the Revluma AI dashboard.
// Replace these with real API/DB calls when wiring backend.

export type StatusColor = "green" | "amber" | "red" | "blue" | "purple";
export type ActivityTag = "recovery" | "cart" | "campaign" | "subscribe";

export interface KPI {
  id: "rev" | "carts" | "rate" | "subs" | "risk" | "score";
  label: string;
  value: string;
  delta?: string;
  dir?: "up" | "down" | "neutral";
  bench?: string;
  atRisk?: string;
  color: StatusColor;
  iconKey: KpiIconKey;
  spark?: number[]; // y-values
  zero?: boolean;
}

export type KpiIconKey =
  | "dollar"
  | "cart"
  | "trend"
  | "users"
  | "alert"
  | "star";

export interface ActivityItem {
  id: string;
  name: string;
  initials: string;
  text: string;
  amt: string;
  time: string;
  tag: ActivityTag;
}

export interface SequenceRow {
  name: string;
  channel: "email" | "sms";
  sent: string;
  open: string;
  click: string;
  conv: string;
  rpr: string;
  bench: { open: number; ours: number };
}

export interface ProductRow {
  rank: number;
  name: string;
  abandoned: number;
  amt: string;
  status: "recovered" | "insequence" | "lost";
  iconKey: "monitor" | "bag" | "globe" | "shoe" | "home";
}

export interface DonutSlice { label: string; value: number; color: string }

export interface HealthSub { label: string; val: number; score: string }
export interface Health { score: number; grade: string; subs: HealthSub[] }

export interface AnalyticTile { label: string; value: string; sub: string; zero?: boolean }

export interface InnovationCard {
  label: string;
  value: string;
  sub: string;
  barVal: number;
  iconColor: StatusColor;
  iconKey: "users" | "bolt" | "mail" | "trend";
  zero?: boolean;
}

export interface Notification {
  id: number;
  unread: boolean;
  tag: "recovery" | "alert" | "campaign" | "insight" | "system";
  tagColor: StatusColor | "gray";
  text: string;
  time: string;
}

export interface Trending { rank: number; name: string; stats: string; trend: string; iconKey: ProductRow["iconKey"] }
export interface WinbackEntry { name: string; amount: string; count: number }

export interface AIInsight {
  id: string;
  iconKey: "timing" | "behavior" | "prediction";
  textHTML: string;
  cta: string;
}

export interface OverviewData {
  user: { name: string; email: string; initials: string; plan: "free" | "pro" };
  kpi: KPI[];
  chart: ChartData;
  activity: ActivityItem[];
  sequences: SequenceRow[];
  products: ProductRow[];
  donut: { slices: DonutSlice[]; total: string };
  health: Health;
  analytics: AnalyticTile[];
  innovation: InnovationCard[];
  notifications: Notification[];
  trending: Trending[];
  winback: WinbackEntry[];
  insights: AIInsight[];
}

export interface ChartPoint { label: string; abandoned: number; recovered: number; revenue: number }
export interface ChartData { "7d": ChartPoint[]; "30d": ChartPoint[]; "90d": ChartPoint[] }

// ──────────────────────────────────────────────
// MOCK
// ──────────────────────────────────────────────
export const MOCK: OverviewData = {
  user: { name: "Alex Johnson", email: "alex@mystore.com", initials: "AJ", plan: "free" },

  kpi: [
    { id: "rev",   label: "Revenue Recovered",  value: "$24,810", delta: "+18.4%",      dir: "up",      bench: "avg +12%",       color: "green",  iconKey: "dollar", spark: [18,22,21,28,25,32,30,36,34,40,42,46] },
    { id: "carts", label: "Abandoned Carts",    value: "347",     delta: "+8 today",    dir: "neutral", atRisk: "$42,000 at risk", color: "amber", iconKey: "cart",   spark: [22,20,24,21,26,24,28,25,29,27,30,28] },
    { id: "rate",  label: "Recovery Rate",      value: "22.3%",   delta: "+3.1%",       dir: "up",      bench: "top: 28%",       color: "blue",   iconKey: "trend",  spark: [10,12,11,15,14,18,17,21,20,23,22,24] },
    { id: "subs",  label: "Active Subscribers", value: "4,218",   delta: "+142 this wk",dir: "up",      bench: "list growth",    color: "purple", iconKey: "users",  spark: [8,12,15,17,19,22,25,28,31,34,38,42] },
    { id: "risk",  label: "Revenue at Risk",    value: "$42,000", delta: "Active now",  dir: "neutral",  bench: "open carts",     color: "red",    iconKey: "alert",  spark: [22,24,21,25,23,27,24,28,25,29,26,28] },
    { id: "score", label: "Opportunity Score",  value: "84/100",  delta: "High",        dir: "up",      bench: "top 15%",        color: "purple", iconKey: "star" },
  ],

  chart: {
    "7d": [
      { label: "Mon", abandoned: 48, recovered: 11, revenue: 820  },
      { label: "Tue", abandoned: 62, recovered: 14, revenue: 940  },
      { label: "Wed", abandoned: 55, recovered: 12, revenue: 760  },
      { label: "Thu", abandoned: 71, recovered: 18, revenue: 1120 },
      { label: "Fri", abandoned: 89, recovered: 24, revenue: 1580 },
      { label: "Sat", abandoned: 74, recovered: 19, revenue: 1230 },
      { label: "Sun", abandoned: 63, recovered: 16, revenue: 1060 },
    ],
    "30d": [
      { label: "W1", abandoned: 210, recovered: 46, revenue: 5200 },
      { label: "W2", abandoned: 248, recovered: 58, revenue: 6100 },
      { label: "W3", abandoned: 235, recovered: 54, revenue: 5800 },
      { label: "W4", abandoned: 281, recovered: 68, revenue: 7710 },
    ],
    "90d": [
      { label: "Jan", abandoned: 820, recovered: 178, revenue: 18400 },
      { label: "Feb", abandoned: 910, recovered: 202, revenue: 21600 },
      { label: "Mar", abandoned: 880, recovered: 196, revenue: 24810 },
    ],
  },

  activity: [
    { id: "1", name: "Sarah M.",  initials: "SM", text: "Cart recovered",         amt: "$183", time: "2m",  tag: "recovery" },
    { id: "2", name: "James R.",  initials: "JR", text: "New abandoned cart",     amt: "$74",  time: "5m",  tag: "cart" },
    { id: "3", name: "Priya K.",  initials: "PK", text: "Cart recovered",         amt: "$215", time: "11m", tag: "recovery" },
    { id: "4", name: "Tom W.",    initials: "TW", text: "Campaign email opened",  amt: "—",   time: "24m", tag: "campaign" },
    { id: "5", name: "Lisa B.",   initials: "LB", text: "New abandoned cart",     amt: "$49",  time: "31m", tag: "cart" },
    { id: "6", name: "Marcus L.", initials: "ML", text: "Cart recovered",         amt: "$94",  time: "42m", tag: "recovery" },
    { id: "7", name: "Nina F.",   initials: "NF", text: "New subscriber",         amt: "—",   time: "1h",  tag: "subscribe" },
    { id: "8", name: "Owen D.",   initials: "OD", text: "New abandoned cart",     amt: "$318", time: "1h",  tag: "cart" },
  ],

  sequences: [
    { name: "Email 1 — Instant Reminder (30min)",     channel: "email", sent: "2,841", open: "54.2%", click: "8.1%",  conv: "4.2%", rpr: "$4.81", bench: { open: 45, ours: 54 } },
    { name: "Email 2 — Follow Up (2–4hrs)",            channel: "email", sent: "1,893", open: "42.7%", click: "6.3%",  conv: "3.1%", rpr: "$3.24", bench: { open: 38, ours: 42 } },
    { name: "Email 3 — Last Chance + Offer (24hrs)",   channel: "email", sent: "1,241", open: "38.4%", click: "5.7%",  conv: "2.8%", rpr: "$2.97", bench: { open: 32, ours: 38 } },
    { name: "SMS 1 — Cart Reminder (1hr)",             channel: "sms",   sent: "984",   open: "91.3%", click: "14.2%", conv: "6.1%", rpr: "$7.12", bench: { open: 88, ours: 91 } },
    { name: "WhatsApp — Cart Reminder (1hr)",          channel: "sms",   sent: "621",   open: "91.3%", click: "14.2%", conv: "10.1%", rpr: "$20.12", bench: { open: 91, ours: 120 } },

  ],

  products: [
    { rank: 1, name: "Wireless Headphones Pro", abandoned: 22, amt: "$2,860", status: "recovered",  iconKey: "monitor" },
    { rank: 2, name: "Minimal Leather Tote",     abandoned: 14, amt: "$1,540", status: "insequence", iconKey: "bag" },
    { rank: 3, name: "Organic Skincare Set",     abandoned: 11, amt: "$1,078", status: "recovered",  iconKey: "globe" },
    { rank: 4, name: "Running Shoes Ultra",      abandoned: 9,  amt: "$990",   status: "lost",       iconKey: "shoe" },
    { rank: 5, name: "Smart Home Hub",           abandoned: 7,  amt: "$763",   status: "insequence", iconKey: "home" },
  ],

  donut: {
    total: "$24,810",
    slices: [
      { label: "Email Sequence",   value: 58, color: "hsl(var(--green))" },
      { label: "SMS",              value: 22, color: "hsl(var(--blue))" },
      { label: "Direct Return",    value: 12, color: "hsl(var(--t3))" },
      { label: "Pop-up / On-site", value: 8,  color: "hsl(var(--purple))" },
    ],
  },

  health: {
    score: 72,
    grade: "B",
    subs: [
      { label: "Recovery Rate",        val: 72, score: "22.3%" },
      { label: "Email Deliverability", val: 86, score: "86%" },
      { label: "Subscriber Growth",    val: 61, score: "61%" },
      { label: "AOV Trend",            val: 78, score: "78%" },
      { label: "Abandonment Rate",     val: 58, score: "58%" },
    ],
  },

  analytics: [
    { label: "Avg. Order Value",          value: "$81.83",  sub: "vs $74.20 last period" },
    { label: "Customer Lifetime Value",   value: "$245.50", sub: "based on 3.0 orders avg" },
    { label: "Cart Abandon $ / Month",    value: "$48,200", sub: "recoverable revenue" },
    { label: "Repeat Purchase Rate",      value: "38.4%",   sub: "industry avg 28%" },
    { label: "Email List Growth (30D)",   value: "+142",    sub: "net new subscribers" },
  ],

  innovation: [
    { label: "Identity Resolution Rate",     value: "68%",     sub: "of anon visitors identified", barVal: 68, iconColor: "green",  iconKey: "users" },
    { label: "Sequence Momentum",            value: "24",      sub: "emails sending next hour",     barVal: 40, iconColor: "blue",   iconKey: "bolt" },
    { label: "Deliverability Health",        value: "86%",     sub: "Primary inbox placement",      barVal: 86, iconColor: "amber",  iconKey: "mail" },
    { label: "Predicted Monthly Recovery",   value: "$6,200",  sub: "projected based on trend",     barVal: 52, iconColor: "purple", iconKey: "trend" },
  ],

  notifications: [
    { id: 1, unread: true,  tag: "recovery", tagColor: "green",  text: "$347 recovered from abandoned cart — Wireless Headphones Pro", time: "2 min ago" },
    { id: 2, unread: true,  tag: "alert",    tagColor: "amber",  text: "Recovery rate dropped below 20% in the last hour", time: "18 min ago" },
    { id: 3, unread: true,  tag: "campaign", tagColor: "blue",   text: 'Campaign "Friday Win-Back" achieved 34% open rate', time: "1 hr ago" },
    { id: 4, unread: false, tag: "insight",  tagColor: "purple", text: "New AI insight ready — peak abandonment window identified", time: "3 hrs ago" },
    { id: 5, unread: false, tag: "system",   tagColor: "gray",   text: "Shopify integration synced successfully — 1,204 customers imported", time: "Yesterday" },
  ],

  trending: [
    { rank: 1, name: "Wireless Headphones Pro", stats: "14 recoveries · $1,820 recovered", trend: "+24%", iconKey: "monitor" },
    { rank: 2, name: "Minimal Leather Tote",    stats: "9 recoveries · $1,134 recovered",  trend: "+16%", iconKey: "bag" },
    { rank: 3, name: "Organic Skincare Set",    stats: "7 recoveries · $875 recovered",    trend: "+11%", iconKey: "globe" },
  ],

  winback: [
    { name: "Sarah M.",  amount: "$1,284", count: 3 },
    { name: "James R.",  amount: "$891",   count: 2 },
    { name: "Priya K.",  amount: "$743",   count: 2 },
    { name: "Tom W.",    amount: "$512",   count: 1 },
    { name: "Lisa B.",   amount: "$398",   count: 1 },
  ],

  insights: [
    { id: "i1", iconKey: "timing",     cta: "Enable SMS recovery", textHTML: 'Your <strong>recovery rate is 5.7% below the 28% benchmark</strong> for stores your size. Enabling SMS recovery could close this gap by up to 12%.' },
    { id: "i2", iconKey: "behavior",   cta: "Enable WhatsApp",     textHTML: '<strong>WhatsApp recovery</strong> is not enabled. Stores using it see 2.4× higher open rates vs email alone.' },
    { id: "i3", iconKey: "prediction", cta: "Apply this timing",   textHTML: '<strong>Friday 6–9 PM</strong> is your peak abandonment window. Schedule follow-ups 30 min after cart creation for best results.' },
  ],
};
