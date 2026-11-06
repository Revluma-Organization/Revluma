export interface CopilotCommand {
  command: string;
  label: string;
  description: string;
  prompt: string;
}

/**
 * Fast workflows for the global Rev copilot. Every prompt is deliberately
 * read-only: connected-store questions ask for evidence, while writing
 * workflows return drafts and never claim to have changed the merchant store.
 */
export const COPILOT_COMMANDS: readonly CopilotCommand[] = [
  {
    command: "/summary",
    label: "Weekly summary",
    description: "Performance, changes, and priorities",
    prompt: "Give me a weekly summary of my store's performance using verified store data. Include important changes, evidence limitations, and recommended priorities.",
  },
  {
    command: "/low-stock",
    label: "Low-stock review",
    description: "Find stock risks without changing inventory",
    prompt: "Which of my products are out of stock or below their low-stock threshold? Show available inventory evidence and freshness limitations. Do not change inventory.",
  },
  {
    command: "/describe",
    label: "Product description",
    description: "Draft original product copy",
    prompt: "Draft an original product description. Ask me for the product name, audience, features, and tone if I have not provided them. Return a draft only; do not publish it.",
  },
  {
    command: "/pricing",
    label: "Pricing strategy",
    description: "Evaluate pricing with evidence and assumptions",
    prompt: "Help me evaluate my product pricing strategy. Separate verified store evidence from assumptions and do not change prices.",
  },
  {
    command: "/campaign",
    label: "Email campaign",
    description: "Draft a campaign without sending it",
    prompt: "Draft a marketing email campaign for my store. Ask for missing audience, offer, tone, and goal. Return a draft only; do not send it.",
  },
  {
    command: "/social",
    label: "Social posts",
    description: "Draft channel-ready social copy",
    prompt: "Draft social media posts for my store. Ask for the product, audience, channel, offer, and tone when needed. Return drafts only; do not publish them.",
  },
] as const;

export function matchingCopilotCommands(input: string): CopilotCommand[] {
  const query = input.trimStart().toLowerCase();
  if (!query.startsWith("/") || /\s/.test(query)) return [];
  return COPILOT_COMMANDS.filter((item) => item.command.startsWith(query));
}

/** Resolve a slash command only when it is the entire message. */
export function resolveCopilotPrompt(input: string): string {
  const trimmed = input.trim();
  return COPILOT_COMMANDS.find((item) => item.command === trimmed.toLowerCase())?.prompt ?? trimmed;
}
