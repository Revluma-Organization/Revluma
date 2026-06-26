import { useQuery } from "@tanstack/react-query";
import { TRENDING_PRODUCTS, type TrendingProduct } from "@/data/mockTrending";

// Simulated async fetch — swap for real API later (e.g. supabase.functions.invoke("trending"))
async function fetchTrending(): Promise<TrendingProduct[]> {
  await new Promise((r) => setTimeout(r, 500));
  return TRENDING_PRODUCTS;
}

export function useTrendingProducts() {
  return useQuery({
    queryKey: ["trending-products"],
    queryFn: fetchTrending,
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}
