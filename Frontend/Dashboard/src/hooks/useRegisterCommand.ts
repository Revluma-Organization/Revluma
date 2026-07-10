import { useEffect, useRef } from "react";
import { useCommandRegistry } from "@/store/commandRegistryStore";
import type { PaletteCommand } from "@/lib/commandPalette/types";

/**
 * Registers one or more palette commands for as long as the calling
 * component is mounted. This is how features become searchable without
 * any changes to the command palette itself — a page, card, or dialog
 * just declares what it can do.
 *
 * @example
 *   useRegisterCommand([
 *     {
 *       id: "connect-shopify",
 *       title: "Connect Shopify",
 *       category: "integrations",
 *       icon: Plug,
 *       keywords: ["shopify", "store", "connect"],
 *       perform: ({ close }) => { setShopifyModalOpen(true); close(); },
 *     },
 *   ], [isConnected]); // re-register when the underlying state changes
 */
export function useRegisterCommand(
  commands: PaletteCommand | PaletteCommand[],
  deps: React.DependencyList = [],
) {
  const registerMany = useCommandRegistry((s) => s.registerMany);
  const unregisterMany = useCommandRegistry((s) => s.unregisterMany);
  const idsRef = useRef<string[]>([]);

  useEffect(() => {
    const list = Array.isArray(commands) ? commands : [commands];
    const ids = list.map((c) => c.id);
    idsRef.current = ids;
    registerMany(list);
    return () => unregisterMany(ids);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}