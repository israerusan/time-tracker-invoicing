import { InvoiceAllocation, InvoiceRecord, PluginSettings, TimeEntry } from "../types";
import { Interval, durationMs, intersect, normalize, subtract } from "./intervals";
import { amountMinor, formatHours, roundSeconds, sumMinor } from "./money";
import { BillingPeriod, isoDate, periodRangeLabel } from "./period";

/**
 * Turning tracked time into a bill.
 *
 * The invariant: **an interval of an entry is billed at most once, ever.**
 *
 * Each issued invoice records the intervals it billed. Eligibility for a new
 * invoice is the entry's own span, intersected with the billing period, with
 * every previously-billed interval removed. Three mistakes are impossible at
 * once:
 *
 *  - an entry spanning a month boundary bills in both months, because the two
 *    intersections are disjoint;
 *  - no part of an entry bills twice, because billed intervals are subtracted
 *    rather than counted — which a scalar second count could not achieve once
 *    two custom periods are allowed to overlap;
 *  - nothing bills beyond the entry's real duration, because everything is
 *    derived from the entry's own span.
 *
 * Rounding sits on top and is explicitly *not* part of that invariant: hours
 * are rounded per line for billing, so a line can bill slightly more or less
 * time than it consumed. That difference is reported (`roundingDeltaSeconds`)
 * rather than hidden, because it is the one place the number on the invoice
 * and the time in the ledger legitimately differ.
 */

export interface InvoiceLine {
  /** Project name, or the fallback label. */
  description: string;
  /** Seconds actually billed, after rounding. */
  seconds: number;
  /** Seconds consumed from the ledger, before rounding. */
  rawSeconds: number;
  rateMinor: number;
  amountMinor: number;
  /** True when a non-zero duration rounded away to nothing. */
  roundedToZero: boolean;
}

/** Everything a renderer needs. Both the Markdown and PDF writers read this. */
export interface InvoiceDocument {
  number: string;
  client: string;
  dateLabel: string;
  periodLabel: string | null;
  currency: string;
  businessName: string;
  businessAddress: string;
  businessEmail: string;
  paymentTerms: string;
  lines: InvoiceLine[];
  totalSeconds: number;
  totalMinor: number;
  /** Shown on the invoice and in the confirmation dialog. */
  notes: string[];
}

export interface InvoiceDraft {
  lines: InvoiceLine[];
  allocations: InvoiceAllocation[];
  totalSeconds: number;
  totalMinor: number;
  /** Billed seconds minus consumed seconds. Positive means rounded up. */
  roundingDeltaSeconds: number;
  /** Entries whose pre-2.0 billing status is unknown and are included here. */
  legacyUnknownCount: number;
  /** Non-blocking things the user should see before issuing. */
  warnings: string[];
}

/** Intervals already billed, per entry id, across every invoice that counts. */
export function allocatedIntervalsByEntry(
  invoices: readonly InvoiceRecord[]
): Map<string, Interval[]> {
  const out = new Map<string, Interval[]>();
  for (const invoice of invoices) {
    if (invoice.voided) continue;
    for (const alloc of invoice.allocations) {
      const list = out.get(alloc.entryId);
      if (list) list.push({ from: alloc.from, to: alloc.to });
      else out.set(alloc.entryId, [{ from: alloc.from, to: alloc.to }]);
    }
  }
  for (const [id, list] of out) out.set(id, normalize(list));
  return out;
}

/** Seconds of each entry already billed. Derived from the intervals. */
export function allocatedSecondsByEntry(
  invoices: readonly InvoiceRecord[]
): Map<string, number> {
  const out = new Map<string, number>();
  for (const [id, intervals] of allocatedIntervalsByEntry(invoices)) {
    out.set(id, durationMs(intervals) / 1000);
  }
  return out;
}

/** Completed entries only — a running timer has no end instant to bill. */
function isBillable(entry: TimeEntry): boolean {
  return entry.end !== null && entry.end > entry.start;
}

export interface DraftOptions {
  entries: readonly TimeEntry[];
  invoices: readonly InvoiceRecord[];
  client: string;
  /** Null bills every eligible second regardless of when it was worked. */
  period: BillingPeriod | null;
  rateMinor: number;
  roundHoursTo: number;
  /** Entries starting before this have unknown pre-2.0 billing status. */
  legacyUnknownBefore: number | null;
  /** Label used when an entry has no project. */
  fallbackProject?: string;
}

export function buildDraft(opts: DraftOptions): InvoiceDraft {
  const {
    entries,
    invoices,
    client,
    period,
    rateMinor,
    roundHoursTo,
    legacyUnknownBefore,
    fallbackProject = "General",
  } = opts;

  const alreadyBilled = allocatedIntervalsByEntry(invoices);
  const allocations: InvoiceAllocation[] = [];
  const byProject = new Map<string, number>();
  let legacyUnknownCount = 0;
  let runningExcluded = 0;

  const window: Interval = {
    from: period?.from ?? Number.NEGATIVE_INFINITY,
    to: period?.to ?? Number.POSITIVE_INFINITY,
  };

  for (const entry of entries) {
    if (entry.client !== client) continue;
    if (!isBillable(entry)) {
      if (entry.end === null) runningExcluded += 1;
      continue;
    }

    const span: Interval = { from: entry.start, to: entry.end as number };
    const inPeriod = intersect(span, window);
    if (!inPeriod) continue;

    // Whatever of this window has not already been billed by some invoice.
    const free = subtract(inPeriod, alreadyBilled.get(entry.id) ?? []);
    const seconds = durationMs(free) / 1000;
    // Sub-millisecond slivers are noise, not billable work.
    if (seconds <= 0.001) continue;

    if (legacyUnknownBefore !== null && entry.start < legacyUnknownBefore) {
      legacyUnknownCount += 1;
    }

    for (const piece of free) {
      allocations.push({ entryId: entry.id, from: piece.from, to: piece.to });
    }
    const project = entry.project.trim() || fallbackProject;
    byProject.set(project, (byProject.get(project) ?? 0) + seconds);
  }

  const lines: InvoiceLine[] = [];
  for (const [project, rawSeconds] of byProject) {
    const seconds = roundSeconds(rawSeconds, roundHoursTo);
    lines.push({
      description: project,
      seconds,
      rawSeconds,
      rateMinor,
      amountMinor: amountMinor(seconds, rateMinor),
      roundedToZero: seconds === 0 && rawSeconds > 0,
    });
  }
  lines.sort((a, b) => b.amountMinor - a.amountMinor || a.description.localeCompare(b.description));

  const billedSeconds = lines.reduce((s, l) => s + l.seconds, 0);
  const consumedSeconds = lines.reduce((s, l) => s + l.rawSeconds, 0);
  const roundingDeltaSeconds = billedSeconds - consumedSeconds;

  const warnings: string[] = [];
  if (runningExcluded > 0) {
    warnings.push(
      "A timer is still running and was not billed. Stop it first if those hours belong on this invoice."
    );
  }
  const zeroed = lines.filter((l) => l.roundedToZero);
  if (zeroed.length > 0) {
    warnings.push(
      `${zeroed.length} ${zeroed.length === 1 ? "line" : "lines"} rounded down to zero hours at the ` +
        `current ${roundHoursTo}h increment and will bill nothing: ${zeroed
          .map((l) => l.description)
          .join(", ")}. Issuing marks that time as billed.`
    );
  }
  // Report the rounding difference whenever it is worth more than a minute,
  // so the gap between hours worked and hours billed is never silent.
  if (Math.abs(roundingDeltaSeconds) >= 60) {
    const direction = roundingDeltaSeconds > 0 ? "more" : "less";
    warnings.push(
      `Rounding to ${roundHoursTo}h bills ${formatHours(Math.abs(roundingDeltaSeconds))}h ${direction} ` +
        `than the ${formatHours(consumedSeconds)}h actually tracked.`
    );
  }
  if (legacyUnknownCount > 0) {
    warnings.push(
      `${legacyUnknownCount} ${legacyUnknownCount === 1 ? "entry was" : "entries were"} recorded before ` +
        `this version began tracking which invoice billed them. They may already have been invoiced — ` +
        `check before sending.`
    );
  }

  return {
    lines,
    allocations,
    totalSeconds: billedSeconds,
    totalMinor: sumMinor(lines.map((l) => l.amountMinor)),
    roundingDeltaSeconds,
    legacyUnknownCount,
    warnings,
  };
}

export function draftToDocument(
  draft: InvoiceDraft,
  opts: {
    number: string;
    client: string;
    issuedAt: number;
    period: BillingPeriod | null;
    settings: PluginSettings;
  }
): InvoiceDocument {
  const { number, client, issuedAt, period, settings } = opts;
  return {
    number,
    client,
    dateLabel: isoDate(issuedAt),
    periodLabel: period ? periodRangeLabel(period) : null,
    currency: settings.currency,
    businessName: settings.businessName,
    businessAddress: settings.businessAddress,
    businessEmail: settings.businessEmail,
    paymentTerms: settings.paymentTerms,
    lines: draft.lines,
    totalSeconds: draft.totalSeconds,
    totalMinor: draft.totalMinor,
    notes: draft.warnings,
  };
}
