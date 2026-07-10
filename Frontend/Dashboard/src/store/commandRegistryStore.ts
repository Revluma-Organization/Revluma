import { create } from "zustand";
import { useEffect, useMemo } from "react";
import type { PaletteCommand } from "@/lib/commandPalette/types";

/**
 * Live, in-memory registry of commands contributed by mounted components.
 *
 * This is the mechanism that makes the palette "self-indexing": a page,
 * card, dialog, or feature module calls `useRegisterCommand(...)` once,
 * and its actions become searchable immediately — no edits to the palette
 * itself, ever. When the component unmounts, its commands disappear too,
 * so the index always reflects what's actually usable right now.
 *
 * Intentionally NOT persisted — it's rebuilt every session as components
 * mount, which is exactly what we want (a stale registered command from a
 * page you're no longer on should not linger).
 */
interface CommandRegistryState {
  commands: Record<string, PaletteCommand>;
  register: (command: PaletteCommand) => void;
  registerMany: (commands: PaletteCommand[]) => void;
  unregister: (id: string) => void;
  unregisterMany: (ids: string[]) => void;
}

export const useCommandRegistry = create<CommandRegistryState>((set) => ({
  commands: {},

  register: (command) =>
    set((state) => ({ commands: { ...state.commands, [command.id]: command } })),

  registerMany: (commands) =>
    set((state) => {
      const next = { ...state.commands };
      for (const c of commands) next[c.id] = c;
      return { commands: next };
    }),

  unregister: (id) =>
    set((state) => {
      if (!(id in state.commands)) return state;
      const next = { ...state.commands };
      delete next[id];
      return { commands: next };
    }),

  unregisterMany: (ids) =>
    set((state) => {
      const next = { ...state.commands };
      let changed = false;
      for (const id of ids) {
        if (id in next) {
          delete next[id];
          changed = true;
        }
      }
      return changed ? { commands: next } : state;
    }),
}));

/** Selector helper — returns a flat, stable-order array of registered commands. */
export function selectDynamicCommands(state: CommandRegistryState): PaletteCommand[] {
  return Object.values(state.commands);
}

export function useRegisterCommands(commands: PaletteCommand | PaletteCommand[] | null | undefined) {
  const registerMany = useCommandRegistry((state) => state.registerMany);
  const unregisterMany = useCommandRegistry((state) => state.unregisterMany);

  const normalized = useMemo(() => {
    if (!commands) return [] as PaletteCommand[];
    return Array.isArray(commands) ? commands : [commands];
  }, [commands]);

  useEffect(() => {
    if (!normalized.length) return;
    const ids = normalized.map((command) => command.id);
    registerMany(normalized);
    return () => unregisterMany(ids);
  }, [normalized, registerMany, unregisterMany]);
}