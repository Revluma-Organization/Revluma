import type { LucideIcon } from "lucide-react";

export type CommandCategory = "recent" | "pages" | "actions" | "integrations" | "settings" | "ai" | "help";

export interface CommandContext {
    navigate: (to: string | number, options?: { replace?: boolean; state?: unknown }) => void;
    close: () => void;
}

export interface PaletteCommand {
    id: string;
    title: string;
    description?: string;
    category: CommandCategory;
    icon?: LucideIcon;
    /** Optional visual keyboard shortcut label shown in the palette UI (e.g. "⌘K") */
    shortcut?: string;
    keywords?: string[];
    aliases?: string[];
    badge?: string;
    skipRecentTracking?: boolean;
    perform: (ctx: CommandContext) => void | Promise<void>;
}

export const CATEGORY_LABEL: Record<CommandCategory, string> = {
    recent: "Recent",
    pages: "Pages",
    actions: "Actions",
    integrations: "Integrations",
    settings: "Settings",
    ai: "AI",
    help: "Help",
};
