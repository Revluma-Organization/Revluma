/** Recency bucket for the history list, from the conversation's own activity time. */
export function historyGroupLabel(iso: string, now = new Date()): string {
  const time = new Date(iso);
  if (Number.isNaN(time.getTime())) return "Older";
  const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.round((startOfDay(now) - startOfDay(time)) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return "Previous 7 days";
  if (days < 30) return "Previous 30 days";
  return "Older";
}
