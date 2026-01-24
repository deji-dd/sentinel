/** Helpers for Torn epoch timestamp handling. */
export function epochSecondsToDate(
  value: number | null | undefined,
): Date | null {
  if (value === null || value === undefined) return null;
  return new Date(value * 1000);
}

export function dateToIsoOrNull(date: Date | null): string | null {
  return date ? date.toISOString() : null;
}

export function secondsFromNow(seconds: number): Date {
  return new Date(Date.now() + seconds * 1000);
}
