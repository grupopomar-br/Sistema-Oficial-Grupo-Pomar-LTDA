import { daysBetween, isDateOnly } from "./dates.ts";

export const lastClientTermDate = "9999-12-31";

export function clientTermProgress(
  closedOn: string,
  endsOn: string,
  today: string,
) {
  const total = daysBetween(closedOn, endsOn);
  const untilStart = daysBetween(today, closedOn);
  const untilEnd = daysBetween(today, endsOn);
  const elapsed = Math.min(total, Math.max(0, -untilStart));
  const percent = total ? (elapsed / total) * 100 : untilStart > 0 ? 0 : 100;
  return { total, elapsed, untilStart, untilEnd, percent };
}

export function extendClientTerm(endsOn: string, days: number): string | null {
  if (
    !isDateOnly(endsOn) ||
    !Number.isSafeInteger(days) ||
    days < 1 ||
    days > daysBetween(endsOn, lastClientTermDate)
  )
    return null;
  const next = new Date(`${endsOn}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}
