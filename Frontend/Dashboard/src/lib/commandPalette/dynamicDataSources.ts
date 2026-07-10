import { Plug, CheckCircle2, WifiOff } from "lucide-react";
import { api } from "@/lib/api";
import type { PaletteCommand, CommandContext } from "./types";

interface StoreRecord {
  platform: "shopify" | "woocommerce";
  status: string;
}

/**
 * Pulls the user's actual connected-store data from the API and turns it
 * into searchable commands. This is a live data source, not a hardcoded
 * list — if the backend adds a new store platform tomorrow, it shows up
 * here automatically with zero palette changes.
 *
 * Fails soft: any network/API error just yields an empty list, so a
 * missing or unreachable endpoint never breaks the palette.
 */
export async function fetchStoreCommands(): Promise<PaletteCommand[]> {
  try {
    const res = await api.get<{ data: { stores: StoreRecord[] } }>("/api/v1/stores");
    const stores = res.data?.data?.stores ?? [];
    return stores.map((s) => {
      const connected = s.status === "active";
      const label = s.platform.charAt(0).toUpperCase() + s.platform.slice(1);
      return {
        id: `store-${s.platform}`,
        title: `${label} — ${connected ? "Connected" : "Not Connected"}`,
        description: "Manage this store's connection",
        category: "integrations",
        icon: connected ? CheckCircle2 : WifiOff,
        keywords: [s.platform, "store", "integration", "connect"],
        perform: ({ navigate, close }: CommandContext) => {
          navigate("/dashboard/integrations");
          close();
        },
      } satisfies PaletteCommand;
    });
  } catch {
    return [];
  }
}