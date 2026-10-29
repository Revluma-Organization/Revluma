export interface ComparisonPeriod {
  title: string;
  dates: string;
  orders: string;
  carts: string;
  customers: string;
  firstTime: string;
  returning: string;
  values: string[];
  cartValues: string[];
  discounts: string[];
}

export function parseVerifiedComparison(text: string): ComparisonPeriod[] | null {
  if (!text.startsWith("I compared your latest rolling seven days")) return null;
  const blocks = text.split(/(?=\*\*(?:Latest period|Previous period [1-9])\*\*)/);
  const periods = blocks.slice(1).filter(b => /^\*\*(Latest period|Previous period [1-9])\*\*/.test(b));
  if (periods.length !== 4) return null;
  const extract = (body: string, pattern: RegExp) => body.match(pattern)?.[1] ?? null;
  const parsed = periods.map((body, index) => ({
    title: index === 0 ? "Latest 7 days" : `Previous period ${index}`,
    dates: extract(body, /\*\*[^*]+\*\* \(([^)]+)\)/),
    orders: extract(body, /- Orders: (\d+) recorded/),
    carts: extract(body, /- Unrecovered abandoned carts: (\d+) recorded/),
    customers: extract(body, /- Newly recorded customer profiles: (\d+)/),
    firstTime: extract(body, /- First-time purchaser orders: (\d+)/),
    returning: extract(body, /returning purchaser orders: (\d+)/),
    values: [...body.matchAll(/- Orders: \d+ recorded; ([^\n]+?)\.(?=\s|$)/g)].map(m => m[1]),
    cartValues: [...body.matchAll(/- Unrecovered abandoned carts: \d+ recorded; ([^\n]+?)\.(?=\s|$)/g)].map(m => m[1]),
    discounts: [...body.matchAll(/- Recorded order discounts: ([^\n]+?)\.(?=\s|$)/g)].map(m => m[1]),
  }));
  if (parsed.some(p => !p.dates || p.orders === null || p.carts === null ||
      p.customers === null || p.firstTime === null || p.returning === null)) return null;
  return parsed as ComparisonPeriod[];
}
