/**
 * Half-open interval arithmetic, `[from, to)`.
 *
 * This exists because counting *seconds* was not enough to stop an hour being
 * billed twice. With scalar counts, an entry from 09:00 to 12:00 billed once
 * for the window 10:00–11:00 and again for 09:00–11:00 looks fully consumed —
 * 1h + 2h = the entry's 3h — while in fact 10:00–11:00 was billed twice and
 * 11:00–12:00 never was. Only the identity of the seconds settles it, so an
 * allocation records *which* interval was billed, not how much.
 */

export interface Interval {
  from: number;
  to: number;
}

export function durationMs(intervals: readonly Interval[]): number {
  let total = 0;
  for (const i of intervals) total += Math.max(0, i.to - i.from);
  return total;
}

/** Sort and merge touching or overlapping intervals. */
export function normalize(intervals: readonly Interval[]): Interval[] {
  const valid = intervals
    .filter((i) => Number.isFinite(i.from) && Number.isFinite(i.to) && i.to > i.from)
    .sort((a, b) => a.from - b.from);

  const out: Interval[] = [];
  for (const interval of valid) {
    const last = out[out.length - 1];
    if (last && interval.from <= last.to) {
      last.to = Math.max(last.to, interval.to);
    } else {
      out.push({ from: interval.from, to: interval.to });
    }
  }
  return out;
}

/** The part of `base` that lies inside `window`, or null. */
export function intersect(base: Interval, window: Interval): Interval | null {
  const from = Math.max(base.from, window.from);
  const to = Math.min(base.to, window.to);
  return to > from ? { from, to } : null;
}

/** `base` with every part of `taken` removed. */
export function subtract(base: Interval, taken: readonly Interval[]): Interval[] {
  let remaining: Interval[] = base.to > base.from ? [{ from: base.from, to: base.to }] : [];

  for (const cut of normalize(taken)) {
    const next: Interval[] = [];
    for (const piece of remaining) {
      if (cut.to <= piece.from || cut.from >= piece.to) {
        next.push(piece);
        continue;
      }
      if (cut.from > piece.from) next.push({ from: piece.from, to: cut.from });
      if (cut.to < piece.to) next.push({ from: cut.to, to: piece.to });
    }
    remaining = next;
    if (remaining.length === 0) break;
  }
  return remaining;
}
