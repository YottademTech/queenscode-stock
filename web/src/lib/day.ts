const dayFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** "2026-11-23" becomes "23 Nov 2026": shorter on a phone and not mistaken for month-first. */
export function formatDay(isoDay: string): string {
  const date = new Date(`${isoDay}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? isoDay : dayFormat.format(date);
}
