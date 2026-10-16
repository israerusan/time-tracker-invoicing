import { newEntryId } from "./core/ids";
import { allocatedIntervalsByEntry } from "./core/invoiceModel";
import { durationMs, subtract } from "./core/intervals";
import { ActiveTimer, InvoiceRecord, TimeEntry } from "./types";

/** Totals for one client, in seconds. */
export interface ClientTotals {
  client: string;
  /** All completed tracked time. */
  totalSeconds: number;
  /** Time not yet allocated to any invoice that still counts. */
  unbilledSeconds: number;
  byProject: Map<string, number>;
}

/**
 * TimeStore — owns the entries, the single active timer, and the issued
 * invoices. Persistence is delegated to the caller through `onChange` so this
 * class stays free of Obsidian's data API and can be exercised directly.
 *
 * Invoices live here rather than in the invoice generator because eligibility
 * for billing is a property of the ledger as a whole: what an entry still owes
 * depends on every invoice ever issued, not on the one being written.
 */
export class TimeStore {
  private entries: TimeEntry[];
  private active: ActiveTimer | null;
  private invoices: InvoiceRecord[];
  private onChange: () => Promise<void>;

  constructor(
    entries: TimeEntry[],
    active: ActiveTimer | null,
    invoices: InvoiceRecord[],
    onChange: () => Promise<void>
  ) {
    this.entries = entries;
    this.active = active;
    this.invoices = invoices;
    this.onChange = onChange;
  }

  getEntries(): readonly TimeEntry[] {
    return this.entries;
  }

  getInvoices(): readonly InvoiceRecord[] {
    return this.invoices;
  }

  getActiveTimer(): ActiveTimer | null {
    return this.active;
  }

  isRunning(): boolean {
    return this.active !== null;
  }

  /** Start tracking. Throws if a timer is already running. */
  async start(opts: {
    filePath: string;
    fileName: string;
    client: string;
    project: string;
    start: number;
  }): Promise<ActiveTimer> {
    if (this.active) {
      throw new Error("A timer is already running. Stop it first.");
    }
    this.active = {
      entryId: newEntryId(),
      filePath: opts.filePath,
      fileName: opts.fileName,
      client: opts.client,
      project: opts.project,
      start: opts.start,
    };
    await this.onChange();
    return this.active;
  }

  /** Stop the running timer, commit it as an entry, and return it. */
  async stop(end: number): Promise<TimeEntry | null> {
    if (!this.active) return null;
    const entry: TimeEntry = {
      id: this.active.entryId,
      filePath: this.active.filePath,
      fileName: this.active.fileName,
      client: this.active.client,
      project: this.active.project,
      start: this.active.start,
      end: Math.max(end, this.active.start),
    };
    this.entries.push(entry);
    this.active = null;
    await this.onChange();
    return entry;
  }

  /** Discard the running timer without recording it. */
  async cancel(): Promise<void> {
    this.active = null;
    await this.onChange();
  }

  /** Record an issued invoice. Allocations are what prevent re-billing. */
  async addInvoice(invoice: InvoiceRecord): Promise<void> {
    this.invoices.push(invoice);
    await this.onChange();
  }

  /** Mark an invoice void, returning its hours to the billable pool. */
  async voidInvoice(invoiceId: string): Promise<boolean> {
    const invoice = this.invoices.find((i) => i.id === invoiceId);
    if (!invoice || invoice.voided) return false;
    invoice.voided = true;
    await this.onChange();
    return true;
  }

  /** Update the stored paths after the invoice files are written. */
  async setInvoicePaths(
    invoiceId: string,
    paths: { markdownPath?: string | null; pdfPath?: string | null }
  ): Promise<void> {
    const invoice = this.invoices.find((i) => i.id === invoiceId);
    if (!invoice) return;
    if (paths.markdownPath !== undefined) invoice.markdownPath = paths.markdownPath;
    if (paths.pdfPath !== undefined) invoice.pdfPath = paths.pdfPath;
    await this.onChange();
  }

  /** Follow a note rename so entries keep pointing at the note they describe. */
  async retargetEntries(oldPath: string, newPath: string, newBasename: string): Promise<void> {
    let touched = false;
    for (const entry of this.entries) {
      if (entry.filePath !== oldPath) continue;
      entry.filePath = newPath;
      entry.fileName = newBasename;
      touched = true;
    }
    if (this.active?.filePath === oldPath) {
      this.active.filePath = newPath;
      this.active.fileName = newBasename;
      touched = true;
    }
    if (touched) await this.onChange();
  }

  /** Duration of the running timer in ms (0 if none). */
  runningElapsedMs(now: number): number {
    if (!this.active) return 0;
    return Math.max(0, now - this.active.start);
  }

  /** Seconds for a completed entry. */
  static entrySeconds(entry: TimeEntry): number {
    if (entry.end === null) return 0;
    return Math.max(0, (entry.end - entry.start) / 1000);
  }

  /**
   * Totals per client, split into tracked and still-unbilled.
   * "Unbilled" subtracts the seconds already allocated to live invoices, so it
   * answers the question the user actually has: what is left to invoice.
   */
  totalsByClient(): ClientTotals[] {
    const billed = allocatedIntervalsByEntry(this.invoices);
    const map = new Map<string, ClientTotals>();

    for (const entry of this.entries) {
      if (entry.end === null) continue;
      const seconds = TimeStore.entrySeconds(entry);
      if (seconds <= 0) continue;

      let totals = map.get(entry.client);
      if (!totals) {
        totals = {
          client: entry.client,
          totalSeconds: 0,
          unbilledSeconds: 0,
          byProject: new Map(),
        };
        map.set(entry.client, totals);
      }
      // What is left is the entry's span minus the intervals already billed,
      // which is robust to allocations that overlap each other.
      const free = subtract({ from: entry.start, to: entry.end }, billed.get(entry.id) ?? []);
      const unbilled = durationMs(free) / 1000;
      totals.totalSeconds += seconds;
      totals.unbilledSeconds += unbilled;
      const project = entry.project.trim() || "General";
      totals.byProject.set(project, (totals.byProject.get(project) ?? 0) + seconds);
    }

    return Array.from(map.values()).sort((a, b) => b.unbilledSeconds - a.unbilledSeconds);
  }

  /** Clients with recorded time, most unbilled first. */
  listClients(): string[] {
    return this.totalsByClient().map((t) => t.client);
  }
}
