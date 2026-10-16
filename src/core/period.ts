/**
 * Billing periods and interval arithmetic.
 *
 * Periods are half-open: `[from, to)`. An entry that starts at 23:00 on
 * 30 September and ends at 01:00 on 1 October contributes one hour to
 * September and one hour to October — it is split at the boundary, not
 * assigned whole to whichever month happens to contain its start instant.
 * The old code filtered on `entry.start` alone and so billed the whole two
 * hours to September.
 *
 * Boundaries are computed in the machine's local civil time, because that is
 * the clock the user was looking at while working. The resulting instants are
 * absolute, so DST transitions shorten or lengthen a month by an hour exactly
 * as the calendar did.
 */

export interface BillingPeriod {
  /** Inclusive start, epoch ms. */
  from: number;
  /** Exclusive end, epoch ms. */
  to: number;
  /** Human label for the invoice, e.g. "October 2026". */
  label: string;
}

/** Milliseconds of `[start, end)` that fall inside `[from, to)`. */
export function overlapMs(
  start: number,
  end: number,
  from: number | null,
  to: number | null
): number {
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  const lo = from === null ? start : Math.max(start, from);
  const hi = to === null ? end : Math.min(end, to);
  return Math.max(0, hi - lo);
}

/** The calendar month containing `instant`, in local time. */
export function monthPeriod(instant: number): BillingPeriod {
  const d = new Date(instant);
  const from = new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0).getTime();
  const to = new Date(d.getFullYear(), d.getMonth() + 1, 1, 0, 0, 0, 0).getTime();
  return { from, to, label: monthLabel(d.getFullYear(), d.getMonth()) };
}

/** The calendar month before the one containing `instant`. */
export function previousMonthPeriod(instant: number): BillingPeriod {
  const d = new Date(instant);
  return monthPeriod(new Date(d.getFullYear(), d.getMonth() - 1, 15).getTime());
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function monthLabel(year: number, monthIndex: number): string {
  return `${MONTH_NAMES[monthIndex]} ${year}`;
}

/** `YYYY-MM-DD` in local time — the label printed on the invoice. */
export function isoDate(instant: number): string {
  const d = new Date(instant);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Label for a period, e.g. "2026-10-01 to 2026-10-31". */
export function periodRangeLabel(period: BillingPeriod): string {
  // `to` is exclusive; show the last day the period actually covers.
  return `${isoDate(period.from)} to ${isoDate(period.to - 1)}`;
}

/** Parse YYYY-MM-DD as local midnight. Returns null for anything else. */
export function parseLocalDate(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(year, month - 1, day, 0, 0, 0, 0);
  // Rejects 2026-02-31, which Date would roll forward into March.
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  return date.getTime();
}

/**
 * Local midnight on the day after `instant`.
 *
 * Not `instant + 24h`: across a daylight-saving transition that lands on 01:00
 * or 23:00, so a billing period ending "31 March" would bill an hour of
 * 1 April, or drop the last hour of 31 March.
 */
export function nextLocalMidnight(instant: number): number {
  const d = new Date(instant);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 0, 0).getTime();
}
