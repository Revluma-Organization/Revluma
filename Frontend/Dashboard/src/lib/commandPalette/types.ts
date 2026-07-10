import type { LucideIcon } from "lucide-react";
import type { NavigateFunction } from "react-router-dom";

export type CommandCategory = "recent" | "pages" | "actions" | "integrations" | "settings" | "ai" | "help";

export interface CommandContext {
    navigate: NavigateFunction;
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
