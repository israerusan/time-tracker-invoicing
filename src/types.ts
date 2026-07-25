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

export interface InvoiceLineItem {
  description: string;
  hours: number;
  rate: number;
  amount: number;
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
};

/** Full persisted blob: settings + tracked entries + any running timer. */
export interface PersistedData {
  settings: PluginSettings;
  entries: TimeEntry[];
  activeTimer: ActiveTimer | null;
}
