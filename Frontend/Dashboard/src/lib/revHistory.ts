/** History group for conversations active within the last 30 days. */
export const RECENT_HISTORY_LABEL = "Recents";
/** History group for conversations with no activity for 30 days or more. */
export const OLDER_HISTORY_LABEL = "30+ days ago";
const RECENT_DAYS = 30;

/**
 * History group from the conversation's own activity time: everything from
 * the last 30 days sits under one "Recents" list (the list is already sorted
 * newest first), and anything quieter than that moves to "30+ days ago". An
 * unreadable timestamp stays with Recents rather than being hidden away.
 */
export function historyGroupLabel(iso: string, now = new Date()): string {
  const time = new Date(iso);
  if (Number.isNaN(time.getTime())) return RECENT_HISTORY_LABEL;
  const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.round((startOfDay(now) - startOfDay(time)) / 86_400_000);
  return days < RECENT_DAYS ? RECENT_HISTORY_LABEL : OLDER_HISTORY_LABEL;
}
