export type Region = "Global" | "NA" | "EU" | "APAC" | "LATAM";
export type Category =
  | "Beauty"
  | "Fitness"
  | "Home"
  | "Tech"
  | "Fashion"
  | "Wellness"
  | "Pets"
  | "Outdoor";

export interface TrendingProduct {
  id: string;
  rank: number;
  name: string;
  brand: string;
  emoji: string;
  category: Category;
  region: Region;
  price: number;
  searchVolume: number;        // monthly searches
  volumeDelta: number;         // % vs prev period
  growth: number;              // % growth signal (primary metric)
  velocity: "Surging" | "Climbing" | "Steady" | "Cooling";
  conversionLift: number;      // % conversion uplift
  marketSaturation: number;    // 0-100
  spark: number[];             // 14 points, normalized series
  hot: boolean;
  updatedAt: string;           // ISO
}

const seriesUp = (start: number, end: number, jitter = 0.08) =>
  Array.from({ length: 14 }, (_, i) => {
    const t = i / 13;
    const base = start + (end - start) * t;
    const noise = (Math.sin(i * 1.7) + Math.cos(i * 0.9)) * jitter * base;
    return Math.max(2, Math.round((base + noise) * 100) / 100);
  });

export const TRENDING_PRODUCTS: TrendingProduct[] = [
  {
    id: "p_01", rank: 1, name: "Hydrating Glow Serum", brand: "Lumiére", emoji: "✨",
    category: "Beauty", region: "Global", price: 38, searchVolume: 184_300, volumeDelta: 62.4,
    growth: 248.7, velocity: "Surging", conversionLift: 18.2, marketSaturation: 34,
    spark: seriesUp(20, 92), hot: true, updatedAt: new Date().toISOString(),
  },
  {
    id: "p_02", rank: 2, name: "Smart Resistance Bands", brand: "Forge", emoji: "🏋️",
    category: "Fitness", region: "NA", price: 79, searchVolume: 142_100, volumeDelta: 41.2,
    growth: 187.3, velocity: "Surging", conversionLift: 14.7, marketSaturation: 41,
    spark: seriesUp(28, 84), hot: true, updatedAt: new Date().toISOString(),
  },
  {
    id: "p_03", rank: 3, name: "Aroma Diffuser Pro", brand: "Kindred", emoji: "🕯️",
    category: "Home", region: "EU", price: 64, searchVolume: 98_500, volumeDelta: 28.9,
    growth: 132.4, velocity: "Climbing", conversionLift: 11.8, marketSaturation: 52,
    spark: seriesUp(34, 72), hot: false, updatedAt: new Date().toISOString(),
  },
  {
    id: "p_04", rank: 4, name: "Noise-Cancel Earbuds X3", brand: "Sonance", emoji: "🎧",
    category: "Tech", region: "APAC", price: 149, searchVolume: 221_800, volumeDelta: 19.6,
    growth: 96.2, velocity: "Climbing", conversionLift: 9.4, marketSaturation: 68,
    spark: seriesUp(40, 70), hot: false, updatedAt: new Date().toISOString(),
  },
  {
    id: "p_05", rank: 5, name: "Linen Oversized Shirt", brand: "Atelier Nord", emoji: "👕",
    category: "Fashion", region: "EU", price: 89, searchVolume: 76_200, volumeDelta: 12.3,
    growth: 71.8, velocity: "Steady", conversionLift: 7.6, marketSaturation: 60,
    spark: seriesUp(38, 60), hot: false, updatedAt: new Date().toISOString(),
  },
  {
    id: "p_06", rank: 6, name: "Magnesium Sleep Drink", brand: "Stillwater", emoji: "🌙",
    category: "Wellness", region: "Global", price: 32, searchVolume: 118_900, volumeDelta: 33.4,
    growth: 162.5, velocity: "Surging", conversionLift: 13.1, marketSaturation: 38,
    spark: seriesUp(26, 80), hot: true, updatedAt: new Date().toISOString(),
  },
  {
    id: "p_07", rank: 7, name: "Self-Cleaning Litter Box", brand: "Purrly", emoji: "🐈",
    category: "Pets", region: "NA", price: 459, searchVolume: 64_700, volumeDelta: 22.1,
    growth: 88.4, velocity: "Climbing", conversionLift: 10.3, marketSaturation: 45,
    spark: seriesUp(30, 64), hot: false, updatedAt: new Date().toISOString(),
  },
  {
    id: "p_08", rank: 8, name: "Trail Runner GTX", brand: "Helix", emoji: "🥾",
    category: "Outdoor", region: "LATAM", price: 165, searchVolume: 52_400, volumeDelta: 8.7,
    growth: 54.2, velocity: "Steady", conversionLift: 6.2, marketSaturation: 71,
    spark: seriesUp(42, 56), hot: false, updatedAt: new Date().toISOString(),
  },
  {
    id: "p_09", rank: 9, name: "Ceramic Skillet 12\"", brand: "Forge Kitchen", emoji: "🍳",
    category: "Home", region: "Global", price: 119, searchVolume: 47_300, volumeDelta: -4.1,
    growth: 28.6, velocity: "Cooling", conversionLift: 3.4, marketSaturation: 78,
    spark: seriesUp(50, 44, 0.05), hot: false, updatedAt: new Date().toISOString(),
  },
  {
    id: "p_10", rank: 10, name: "Adaptive Yoga Mat", brand: "Drift", emoji: "🧘",
    category: "Fitness", region: "EU", price: 72, searchVolume: 38_900, volumeDelta: 16.4,
    growth: 64.9, velocity: "Climbing", conversionLift: 8.1, marketSaturation: 49,
    spark: seriesUp(32, 58), hot: false, updatedAt: new Date().toISOString(),
  },
];

export const REGIONS: Region[] = ["Global", "NA", "EU", "APAC", "LATAM"];
export const CATEGORIES: Category[] = [
  "Beauty", "Fitness", "Home", "Tech", "Fashion", "Wellness", "Pets", "Outdoor",
];
