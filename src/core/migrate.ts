import {
  ActiveTimer,
  CURRENT_SCHEMA,
  DEFAULT_SETTINGS,
  InvoiceAllocation,
  InvoiceRecord,
  PersistedData,
  PluginSettings,
  TimeEntry,
} from "../types";
import { newEntryId } from "./ids";

/**
 * Schema migration for the persisted ledger.
 *
 * This file touches the only irreplaceable thing the plugin owns: a record of
 * hours somebody intends to bill for. Every rule here follows from that.
 *
 *  - The raw loaded object is never mutated, and unknown fields are preserved,
 *    so a vault synced from a newer version is not quietly stripped.
 *  - A record that cannot be trusted is quarantined, never guessed at and
 *    never dropped.
 *  - A schema newer than this build puts the plugin in read-only mode instead
 *    of being downgraded in place.
 *  - Entries from before invoice allocations existed are marked
 *    *billing status unknown*, not *unbilled*. The old code kept no record of
 *    what it had invoiced, so claiming those hours are unbilled would be an
 *    invention — and the direction of that invention is "bill the client
 *    again".
 */

export interface MigrationReport {
  fromSchema: number;
  toSchema: number;
  /** True when the file was written by a newer build; do not save over it. */
  readOnly: boolean;
  /** Entries given a fresh id because theirs was missing or duplicated. */
  reassignedIds: { from: string | null; to: string }[];
  /** Records that failed validation and were set aside. */
  quarantined: number;
  /** True when this load changed anything that needs persisting. */
  changed: boolean;
  notes: string[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function finiteNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function plainString(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

/**
 * Validate one entry. Returns null when the record is not usable, in which
 * case the caller quarantines it. Unknown fields survive.
 */
function readEntry(raw: unknown): TimeEntry | null {
  if (!isRecord(raw)) return null;
  const start = finiteNumber(raw.start);
  if (start === null || start <= 0) return null;

  const endRaw = raw.end;
  let end: number | null;
  if (endRaw === null || endRaw === undefined) end = null;
  else {
    const n = finiteNumber(endRaw);
    if (n === null) return null;
    // An end before its start is not a duration we can interpret.
    if (n < start) return null;
    end = n;
  }

  const client = plainString(raw.client);
  const project = plainString(raw.project);
  if (client === null || project === null) return null;

  return {
    ...(raw as object),
    id: plainString(raw.id) ?? "",
    filePath: plainString(raw.filePath) ?? "",
    fileName: plainString(raw.fileName) ?? "",
    client,
    project,
    start,
    end,
    description: plainString(raw.description) ?? undefined,
  } as TimeEntry;
}

function readActiveTimer(raw: unknown): ActiveTimer | null {
  if (!isRecord(raw)) return null;
  const start = finiteNumber(raw.start);
  if (start === null || start <= 0) return null;
  return {
    entryId: plainString(raw.entryId) ?? newEntryId(),
    filePath: plainString(raw.filePath) ?? "",
    fileName: plainString(raw.fileName) ?? "",
    client: plainString(raw.client) ?? DEFAULT_SETTINGS.defaultClient,
    project: plainString(raw.project) ?? "",
    start,
  };
}

function readAllocation(raw: unknown): InvoiceAllocation | null {
  if (!isRecord(raw)) return null;
  const entryId = plainString(raw.entryId);
  const from = finiteNumber(raw.from);
  const to = finiteNumber(raw.to);
  if (!entryId || from === null || to === null || to <= from) return null;
  return { entryId, from, to };
}

/**
 * An allocation must name an entry that exists and lie inside that entry's own
 * span. A synced or hand-edited file claiming an invoice billed time the entry
 * never contained would make `remaining` negative forever, silently suppressing
 * every legitimate hour on it.
 */
function allocationsFitEntries(
  allocations: readonly InvoiceAllocation[],
  entriesById: Map<string, TimeEntry>
): boolean {
  const seenPerEntry = new Map<string, InvoiceAllocation[]>();
  for (const alloc of allocations) {
    const entry = entriesById.get(alloc.entryId);
    if (!entry || entry.end === null) return false;
    if (alloc.from < entry.start || alloc.to > entry.end) return false;
    const list = seenPerEntry.get(alloc.entryId) ?? [];
    // Two allocations on one invoice must not overlap each other either.
    for (const other of list) {
      if (alloc.from < other.to && other.from < alloc.to) return false;
    }
    list.push(alloc);
    seenPerEntry.set(alloc.entryId, list);
  }
  return true;
}

function readInvoice(raw: unknown): InvoiceRecord | null {
  if (!isRecord(raw)) return null;
  const id = plainString(raw.id);
  const number = plainString(raw.number);
  const client = plainString(raw.client);
  const issuedAt = finiteNumber(raw.issuedAt);
  const totalMinor = finiteNumber(raw.totalMinor);
  const totalSeconds = finiteNumber(raw.totalSeconds);
  if (!id || !number || client === null || issuedAt === null) return null;
  if (totalMinor === null || totalSeconds === null) return null;

  const allocations: InvoiceAllocation[] = [];
  if (Array.isArray(raw.allocations)) {
    for (const a of raw.allocations) {
      const parsed = readAllocation(a);
      // A dropped allocation would un-bill real work, so refuse the whole
      // record rather than keep a partial one.
      if (!parsed) return null;
      allocations.push(parsed);
    }
  }

  return {
    ...(raw as object),
    id,
    number,
    client,
    issuedAt,
    periodFrom: finiteNumber(raw.periodFrom),
    periodTo: finiteNumber(raw.periodTo),
    currency: plainString(raw.currency) ?? DEFAULT_SETTINGS.currency,
    rateMinor: finiteNumber(raw.rateMinor) ?? 0,
    roundHoursTo: finiteNumber(raw.roundHoursTo) ?? 0,
    allocations,
    totalSeconds,
    totalMinor,
    markdownPath: plainString(raw.markdownPath),
    pdfPath: plainString(raw.pdfPath),
    voided: raw.voided === true,
  } as InvoiceRecord;
}

function readSettings(raw: unknown): PluginSettings {
  const merged: PluginSettings = { ...DEFAULT_SETTINGS };
  if (!isRecord(raw)) return merged;
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof PluginSettings)[]) {
    const value = raw[key];
    if (value === undefined || value === null) continue;
    if (typeof value === typeof DEFAULT_SETTINGS[key]) {
      // Types line up with the default, so the value is usable as-is.
      (merged[key] as unknown) = value;
    }
  }
  if (merged.pdfPageSize !== "A4" && merged.pdfPageSize !== "Letter") {
    merged.pdfPageSize = DEFAULT_SETTINGS.pdfPageSize;
  }
  if (!Number.isFinite(merged.invoiceSeq) || merged.invoiceSeq < 1) {
    merged.invoiceSeq = DEFAULT_SETTINGS.invoiceSeq;
  }
  return merged;
}

export function migrate(raw: unknown, now: number): { data: PersistedData; report: MigrationReport } {
  const report: MigrationReport = {
    fromSchema: 1,
    toSchema: CURRENT_SCHEMA,
    readOnly: false,
    reassignedIds: [],
    quarantined: 0,
    changed: false,
    notes: [],
  };

  const root = isRecord(raw) ? raw : {};
  const declared = finiteNumber(root.schemaVersion);
  // A file with no schemaVersion is the pre-2.0 shape.
  report.fromSchema = declared ?? 1;

  if (report.fromSchema > CURRENT_SCHEMA) {
    report.readOnly = true;
    report.notes.push(
      `This vault's time data was written by a newer version of the plugin (schema ${report.fromSchema}). ` +
        `It has been opened read-only so nothing is overwritten. Update the plugin to continue.`
    );
  }

  const quarantined: unknown[] = Array.isArray(root.quarantined) ? [...root.quarantined] : [];

  // ---- entries -------------------------------------------------------------
  const entries: TimeEntry[] = [];
  const seenIds = new Set<string>();
  const rawEntries = Array.isArray(root.entries) ? root.entries : [];
  if (!Array.isArray(root.entries) && root.entries !== undefined) {
    report.notes.push("The stored entry list was not an array; it has been quarantined.");
    quarantined.push(root.entries);
    report.quarantined += 1;
  }

  for (const rawEntry of rawEntries) {
    const entry = readEntry(rawEntry);
    if (!entry) {
      quarantined.push(rawEntry);
      report.quarantined += 1;
      report.changed = true;
      continue;
    }
    if (!entry.id || seenIds.has(entry.id)) {
      const fresh = newEntryId();
      report.reassignedIds.push({ from: entry.id || null, to: fresh });
      entry.id = fresh;
      report.changed = true;
    }
    seenIds.add(entry.id);
    entries.push(entry);
  }

  // ---- invoices ------------------------------------------------------------
  const invoices: InvoiceRecord[] = [];
  const seenInvoiceIds = new Set<string>();
  const rawInvoices = Array.isArray(root.invoices) ? root.invoices : [];
  const entriesById = new Map(entries.map((e) => [e.id, e]));
  for (const rawInvoice of rawInvoices) {
    const invoice = readInvoice(rawInvoice);
    if (
      !invoice ||
      seenInvoiceIds.has(invoice.id) ||
      !allocationsFitEntries(invoice.allocations, entriesById)
    ) {
      quarantined.push(rawInvoice);
      report.quarantined += 1;
      report.changed = true;
      continue;
    }
    seenInvoiceIds.add(invoice.id);
    invoices.push(invoice);
  }

  // ---- legacy billing status ----------------------------------------------
  let legacyUnknownBefore = finiteNumber(root.legacyUnknownBefore);
  if (report.fromSchema < 2) {
    report.changed = true;
    if (entries.length > 0) {
      // These hours pre-date any record of what was invoiced. Mark the
      // boundary; do not claim they are unbilled.
      legacyUnknownBefore = now;
      report.notes.push(
        `${entries.length} time ${entries.length === 1 ? "entry was" : "entries were"} recorded before this ` +
          `version started tracking which invoice billed them. Their billing status is unknown, ` +
          `so you will be asked to confirm before they are included on an invoice.`
      );
    }
  }

  const data: PersistedData = {
    schemaVersion: report.readOnly ? report.fromSchema : CURRENT_SCHEMA,
    settings: readSettings(root.settings),
    entries,
    activeTimer: readActiveTimer(root.activeTimer),
    invoices,
    legacyUnknownBefore,
    quarantined,
  };

  if (report.quarantined > 0) {
    report.notes.push(
      `${report.quarantined} unreadable ${report.quarantined === 1 ? "record was" : "records were"} set aside ` +
        `rather than discarded. They are kept verbatim under "quarantined" in the plugin's data file.`
    );
  }
  if (report.reassignedIds.length > 0) {
    report.notes.push(
      `${report.reassignedIds.length} time ${
        report.reassignedIds.length === 1 ? "entry" : "entries"
      } had a missing or duplicated identifier and were given a new one.`
    );
  }

  return { data, report };
}
