/** A single tracked time interval against a note. */
export interface TimeEntry {
  id: string;
  /** Vault path of the note this time was tracked against. */
  filePath: string;
  /** Display name of the note at tracking time. */
  fileName: string;
  client: string;
  project: string;
  /** Epoch ms. */
  start: number;
  /** Epoch ms, or null while running. */
  end: number | null;
  /** Optional free-text description for the invoice line. */
  description?: string;
}

/** In-progress timer state (only one active at a time). */
export interface ActiveTimer {
  entryId: string;
  filePath: string;
  fileName: string;
  client: string;
  project: string;
  start: number;
}

/**
 * Which part of one entry a given invoice billed.
 *
 * Allocations are the reason an entry cannot be billed twice. An entry is not
 * flagged "invoiced"; the *interval* it contributed is recorded against the
 * invoice that took it. Recording a scalar number of seconds is not enough:
 * two invoices covering overlapping custom periods can consume an entry's
 * whole duration between them while double-billing the overlap and never
 * billing the rest. Identity settles it; quantity does not.
 */
export interface InvoiceAllocation {
  entryId: string;
  /** Half-open `[from, to)` in epoch ms, inside the entry's own span. */
  from: number;
  to: number;
}

/**
 * An issued invoice. Immutable once written: the rate, currency, rounding
 * policy and totals are snapshotted, so regenerating or re-rendering can never
 * change what a client was asked to pay. Corrections are made by voiding and
 * issuing a new invoice, not by editing this record.
 */
export interface InvoiceRecord {
  id: string;
  /** Human-facing number, unique within the vault. */
  number: string;
  client: string;
  issuedAt: number;
  /** Half-open billing period `[from, to)`, or null for "all unbilled time". */
  periodFrom: number | null;
  periodTo: number | null;
  /** Snapshotted at issue time. */
  currency: string;
  rateMinor: number;
  roundHoursTo: number;
  allocations: InvoiceAllocation[];
  totalSeconds: number;
  totalMinor: number;
  markdownPath: string | null;
  pdfPath: string | null;
  voided: boolean;
}

export interface PluginSettings {
  /** License (offline Ed25519 — see src/license/LicenseManager.ts) */
  licenseKey: string;
  isPro: boolean;
  licenseEmail: string;
  purchaseUrl: string;

  /** Billing defaults */
  defaultHourlyRate: number;
  currency: string;
  /** Frontmatter property names used to derive client/project from a note. */
  clientProperty: string;
  projectProperty: string;
  /** Fallback client/project when a note has no property set. */
  defaultClient: string;

  /** Business identity (appears on invoices) */
  businessName: string;
  businessAddress: string;
  businessEmail: string;

  /** Where generated invoices are written (vault-relative folder). */
  invoiceFolder: string;

  /** Rounding for billable hours (e.g. 0.25 = nearest 15 min, 0 = none). */
  roundHoursTo: number;

  /** Next sequence number used to build a unique invoice number. */
  invoiceSeq: number;
  /** Write a PDF alongside the markdown invoice. */
  exportPdf: boolean;
  /** Page size for the PDF. */
  pdfPageSize: "A4" | "Letter";
  /** Payment terms line printed under the total. Empty to omit. */
  paymentTerms: string;
}

export const DEFAULT_SETTINGS: PluginSettings = {
  licenseKey: "",
  isPro: false,
  licenseEmail: "",
  purchaseUrl: "https://buymeacoffee.com/vaultspotlight/e/560212",
  defaultHourlyRate: 100,
  currency: "USD",
  clientProperty: "client",
  projectProperty: "project",
  defaultClient: "Unassigned",
  businessName: "Your Business",
  businessAddress: "",
  businessEmail: "",
  invoiceFolder: "Invoices",
  roundHoursTo: 0.25,
  invoiceSeq: 1,
  exportPdf: true,
  pdfPageSize: "A4",
  paymentTerms: "",
};

/** Bump when the shape of PersistedData changes. See src/core/migrate.ts. */
export const CURRENT_SCHEMA = 2;

/** Full persisted blob: settings + tracked entries + invoices + any timer. */
export interface PersistedData {
  schemaVersion: number;
  settings: PluginSettings;
  entries: TimeEntry[];
  activeTimer: ActiveTimer | null;
  invoices: InvoiceRecord[];
  /**
   * Entries recorded before this instant pre-date invoice allocations, so
   * whether they were already billed is genuinely unknown — the pre-2.0 code
   * kept no record. Never treated as unbilled silently; surfaced as a warning
   * the first time they would be included on an invoice.
   */
  legacyUnknownBefore: number | null;
  /** Records quarantined by migration because they could not be trusted. */
  quarantined: unknown[];
  /**
   * An invoice whose files were being written when the plugin last stopped.
   *
   * Writing the files and recording the invoice are two operations and cannot
   * be made one. Whichever order they run in, a crash between them leaves the
   * ledger and the vault disagreeing — and the dangerous direction is an
   * invoice sitting in the vault, already sent, whose hours the plugin still
   * believes are unbilled. So the intent is written down first, and on the
   * next load the vault is asked which way it went.
   */
  pendingIssue: InvoiceRecord | null;
}
