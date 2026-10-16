import { Notice, Plugin, TAbstractFile, TFile } from "obsidian";
import {
  ActiveTimer,
  CURRENT_SCHEMA,
  DEFAULT_SETTINGS,
  InvoiceRecord,
  PersistedData,
  PluginSettings,
  TimeEntry,
} from "./types";
import { LicenseManager } from "./license/LicenseManager";
import { TimeStore } from "./timeStore";
import { InvoiceWriter } from "./invoice";
import { TimeTrackerSettingTab } from "./settings";
import { migrate } from "./core/migrate";
import { newInvoiceId } from "./core/ids";
import { buildDraft, draftToDocument } from "./core/invoiceModel";
import { resolvePendingIssue } from "./core/reconcile";
import { formatHours, formatMoney, parseRateToMinor } from "./core/money";
import { BillingPeriod, periodRangeLabel } from "./core/period";
import {
  ClientPickModal,
  ConfirmInvoiceModal,
  InvoicePickModal,
  PeriodPickModal,
} from "./ui/modals";

/** How often the status bar ticks while a timer is running. */
const TICK_MS = 1000;
/** Quiet period before settings edits are written to disk. */
const SAVE_DEBOUNCE_MS = 400;

export default class TimeTrackerPlugin extends Plugin {
  settings: PluginSettings = { ...DEFAULT_SETTINGS };
  store!: TimeStore;

  private entries: TimeEntry[] = [];
  private activeTimer: ActiveTimer | null = null;
  private invoices: InvoiceRecord[] = [];
  private legacyUnknownBefore: number | null = null;
  private quarantined: unknown[] = [];
  private pendingIssue: InvoiceRecord | null = null;
  /** Set when the data file came from a newer build; nothing is written. */
  private readOnly = false;

  private statusBar?: HTMLElement;
  private statusBarText = "";
  private tickHandle: number | null = null;
  private saveTimer: number | null = null;
  /** Guards against two invoice confirmations racing. */
  private issuing = false;
  /** Serializes writes so an older save cannot land after a newer one. */
  private saveChain: Promise<void> = Promise.resolve();

  async onload(): Promise<void> {
    await this.loadAll();
    this.refreshLicense();

    this.store = new TimeStore(this.entries, this.activeTimer, this.invoices, async () => {
      this.activeTimer = this.store.getActiveTimer();
      await this.saveAll();
    });

    this.statusBar = this.addStatusBarItem();
    this.statusBar.addClass("tti-statusbar");
    this.statusBar.onClickEvent(() => this.toggleTracking());
    this.syncTicker();

    this.addCommand({
      id: "start-tracking",
      name: "Start tracking active note",
      callback: () => void this.startTracking(),
    });

    this.addCommand({
      id: "stop-tracking",
      name: "Stop tracking",
      callback: () => void this.stopTracking(),
    });

    this.addCommand({
      id: "toggle-tracking",
      name: "Toggle tracking (start/stop)",
      callback: () => this.toggleTracking(),
    });

    this.addCommand({
      id: "discard-tracking",
      name: "Discard running timer without recording it",
      checkCallback: (checking) => {
        if (!this.store.isRunning()) return false;
        if (!checking) void this.discardTracking();
        return true;
      },
    });

    this.addCommand({
      id: "show-totals",
      name: "Show tracked time totals",
      callback: () => this.showTotals(),
    });

    this.addCommand({
      id: "generate-invoice",
      name: "Generate invoice (Premium)",
      checkCallback: (checking) => {
        if (!this.settings.isPro) return false;
        if (!checking) this.startInvoiceFlow();
        return true;
      },
    });

    this.addCommand({
      id: "void-invoice",
      name: "Void an issued invoice (Premium)",
      checkCallback: (checking) => {
        if (!this.settings.isPro) return false;
        if (!checking) this.startVoidFlow();
        return true;
      },
    });

    this.addCommand({
      id: "verify-license",
      name: "Verify license key",
      callback: () => {
        this.refreshLicense();
        void this.saveAll();
        new Notice(this.settings.isPro ? "Premium active." : "Lite tier (no valid license).");
      },
    });

    this.addRibbonIcon("clock", "Time Tracker: start/stop", () => this.toggleTracking());

    // Keep entries pointing at their note when it moves.
    this.registerEvent(
      this.app.vault.on("rename", (file: TAbstractFile, oldPath: string) => {
        if (file instanceof TFile) {
          void this.store.retargetEntries(oldPath, file.path, file.basename);
        }
      })
    );

    this.addSettingTab(new TimeTrackerSettingTab(this.app, this));

    // The vault index is not reliable during onload, and reconciliation asks
    // the vault whether a file exists.
    this.app.workspace.onLayoutReady(() => {
      this.reconcilePendingIssue().catch((error: unknown) => {
        new Notice(
          `Time Tracker could not resolve an unfinished invoice: ${
            error instanceof Error ? error.message : String(error)
          }`,
          0
        );
      });
    });
  }

  /**
   * Finish, or abandon, an issuance that was interrupted.
   *
   * The invoice file is the evidence. If it is there, the client may already
   * have been sent it, so the invoice is recorded and its hours stay billed.
   * If it is not, nothing was delivered and the hours go back in the pool.
   * Either way the user is told, because both outcomes are surprising.
   */
  private async reconcilePendingIssue(): Promise<void> {
    const pending = this.pendingIssue;
    if (!pending || this.readOnly) return;

    const outcome = resolvePendingIssue(pending, (path) =>
      this.app.vault.getAbstractFileByPath(path) !== null
    );

    this.pendingIssue = null;

    if (outcome.action === "record" && outcome.record) {
      await this.store.addInvoice(outcome.record);
    } else {
      await this.saveAll();
    }
    new Notice(outcome.message, 15000);
  }

  onunload(): void {
    this.stopTicker();
    if (this.saveTimer !== null) {
      // A settings edit made in the last 400 ms is still only in memory.
      // Cancelling the timer without flushing would certainly discard it; this
      // start is best-effort, since Obsidian does not await plugin unload.
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
      void this.saveAll().catch(() => undefined);
    }
  }

  // ----------------------------------------------------------------------
  // Tracking
  // ----------------------------------------------------------------------

  private deriveClientProject(file: TFile): { client: string; project: string } {
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
    const client =
      (fm?.[this.settings.clientProperty] as string | undefined)?.toString().trim() ||
      this.settings.defaultClient;
    const project =
      (fm?.[this.settings.projectProperty] as string | undefined)?.toString().trim() ||
      file.basename;
    return { client, project };
  }

  async startTracking(): Promise<void> {
    if (this.readOnly) {
      new Notice("Time data is open read-only — update the plugin before tracking more time.");
      return;
    }
    if (this.store.isRunning()) {
      new Notice("Already tracking. Stop the current timer first.");
      return;
    }
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      new Notice("Open a note to track time against it.");
      return;
    }
    const { client, project } = this.deriveClientProject(file);
    await this.store.start({
      filePath: file.path,
      fileName: file.basename,
      client,
      project,
      start: Date.now(),
    });
    new Notice(`Tracking "${file.basename}" — ${client} / ${project}`);
    this.syncTicker();
  }

  async stopTracking(): Promise<void> {
    if (!this.store.isRunning()) {
      new Notice("No timer running.");
      return;
    }
    const entry = await this.store.stop(Date.now());
    if (entry) {
      new Notice(`Stopped. Logged ${formatHours(TimeStore.entrySeconds(entry))}h to ${entry.client}.`);
    }
    this.syncTicker();
  }

  private async discardTracking(): Promise<void> {
    const active = this.store.getActiveTimer();
    if (!active) return;
    await this.store.cancel();
    new Notice(`Discarded ${formatHours((Date.now() - active.start) / 1000)}h — nothing was recorded.`);
    this.syncTicker();
  }

  toggleTracking(): void {
    if (this.store.isRunning()) void this.stopTracking();
    else void this.startTracking();
  }

  private showTotals(): void {
    const totals = this.store.totalsByClient();
    if (totals.length === 0) {
      new Notice("No tracked time yet.");
      return;
    }
    const lines = totals.map(
      (t) =>
        `${t.client}: ${formatHours(t.unbilledSeconds)}h unbilled ` +
        `(${formatHours(t.totalSeconds)}h tracked)`
    );
    new Notice("Tracked time by client:\n" + lines.join("\n"), 8000);
  }

  // ----------------------------------------------------------------------
  // Invoicing (premium)
  // ----------------------------------------------------------------------

  private startInvoiceFlow(): void {
    if (this.readOnly) {
      new Notice("Time data is open read-only — update the plugin before issuing invoices.");
      return;
    }
    const totals = this.store.totalsByClient();
    if (totals.length === 0) {
      new Notice("No tracked time to invoice yet.");
      return;
    }
    new ClientPickModal(this.app, totals, (client) => {
      new PeriodPickModal(this.app, Date.now(), (period) => {
        this.previewInvoice(client, period);
      }).open();
    }).open();
  }

  private previewInvoice(client: string, period: BillingPeriod | null): void {
    const rateMinor = parseRateToMinor(this.settings.defaultHourlyRate, this.settings.currency);
    if (rateMinor === null) {
      new Notice("The default hourly rate is not a valid amount. Fix it in settings first.");
      return;
    }

    const draft = buildDraft({
      entries: this.store.getEntries(),
      invoices: this.store.getInvoices(),
      client,
      period,
      rateMinor,
      roundHoursTo: this.settings.roundHoursTo,
      legacyUnknownBefore: this.legacyUnknownBefore,
    });

    const writer = new InvoiceWriter(this.app, this.settings);
    let preview: { number: string };
    try {
      preview = writer.nextNumber(Date.now(), this.store.getInvoices(), client);
    } catch (error) {
      new Notice(error instanceof Error ? error.message : String(error));
      return;
    }

    new ConfirmInvoiceModal(
      this.app,
      draft,
      {
        client,
        number: preview.number,
        currency: this.settings.currency,
        periodLabel: period ? periodRangeLabel(period) : null,
      },
      // The number shown above is a preview. It is claimed for real inside
      // issueInvoice, against the ledger as it stands at that moment — two
      // previews opened side by side would otherwise both show 0001 and both
      // issue under it.
      () => void this.issueInvoice({ client, period, rateMinor, writer })
    ).open();
  }

  private async issueInvoice(opts: {
    client: string;
    period: BillingPeriod | null;
    rateMinor: number;
    writer: InvoiceWriter;
  }): Promise<void> {
    const { client, period, rateMinor, writer } = opts;

    // One issuance at a time. Two confirmations racing would each read the
    // same ledger, allocate the same intervals and claim the same number.
    if (this.issuing) {
      new Notice("Another invoice is still being issued. Try again in a moment.");
      return;
    }
    this.issuing = true;
    try {
      await this.issueInvoiceInner(client, period, rateMinor, writer);
    } finally {
      this.issuing = false;
    }
  }

  private async issueInvoiceInner(
    client: string,
    period: BillingPeriod | null,
    rateMinor: number,
    writer: InvoiceWriter
  ): Promise<void> {
    const issuedAt = Date.now();

    // Recompute against the ledger as it is now, not as it was at preview.
    const draft = buildDraft({
      entries: this.store.getEntries(),
      invoices: this.store.getInvoices(),
      client,
      period,
      rateMinor,
      roundHoursTo: this.settings.roundHoursTo,
      legacyUnknownBefore: this.legacyUnknownBefore,
    });
    if (draft.lines.length === 0 || draft.totalMinor <= 0) {
      new Notice("There is nothing left to bill for this client in this period.");
      return;
    }

    let number: string;
    let seq: number;
    try {
      ({ number, seq } = writer.nextNumber(issuedAt, this.store.getInvoices(), client));
    } catch (error) {
      new Notice(error instanceof Error ? error.message : String(error));
      return;
    }

    const doc = draftToDocument(draft, { number, client, issuedAt, period, settings: this.settings });

    // Write down the intent before touching the vault, including where the
    // files are going. If the process stops between the two, the next load
    // can ask the vault which side of the boundary it fell on.
    const planned = writer.plannedPaths(number, client);
    const record: InvoiceRecord = {
      id: newInvoiceId(),
      number,
      client,
      issuedAt,
      periodFrom: period?.from ?? null,
      periodTo: period?.to ?? null,
      currency: this.settings.currency,
      rateMinor,
      roundHoursTo: this.settings.roundHoursTo,
      allocations: draft.allocations,
      totalSeconds: draft.totalSeconds,
      totalMinor: draft.totalMinor,
      markdownPath: planned.markdownPath,
      // Where the PDF is going, recorded now so a crash does not lose it.
      pdfPath: this.settings.exportPdf ? planned.pdfPath : null,
      voided: false,
    };
    this.pendingIssue = record;
    try {
      await this.saveAll();
    } catch {
      // saveAll already told the user. Without a durable marker there is no
      // safe way to continue, so stop before anything is written.
      this.pendingIssue = null;
      return;
    }

    let written;
    try {
      written = await writer.write(doc, {
        exportPdf: this.settings.exportPdf,
        pageSize: this.settings.pdfPageSize,
        createdAt: new Date(issuedAt),
        creator: `Time Tracker and Invoicing ${this.manifest.version}`,
      });
    } catch (error) {
      // A rejection does not prove nothing was written: `vault.create` can
      // reach storage and still reject. Ask the vault rather than trusting the
      // error — if the invoice is sitting there it may already have been sent,
      // and discarding the marker would leave its hours billable.
      await this.reconcilePendingIssue();
      new Notice(
        `Invoice could not be completed: ${error instanceof Error ? error.message : String(error)}`,
        10000
      );
      return;
    }

    record.markdownPath = written.markdownPath;
    record.pdfPath = written.pdfPath;

    // Promote the pending marker to a real invoice. Only now do its
    // allocations start counting against future invoices.
    this.pendingIssue = null;
    this.settings.invoiceSeq = seq + 1;
    await this.store.addInvoice(record);

    const file = this.app.vault.getAbstractFileByPath(written.markdownPath);
    if (file instanceof TFile) {
      await this.app.workspace.getLeaf(false).openFile(file);
    }

    if (written.pdfError) {
      new Notice(
        `Invoice ${number} created for ${client} (${formatMoney(draft.totalMinor, this.settings.currency)}). ` +
          `PDF was not written: ${written.pdfError}`,
        12000
      );
    } else if (written.pdfPath) {
      new Notice(
        `Invoice ${number} created for ${client} — ` +
          `${formatMoney(draft.totalMinor, this.settings.currency)}. PDF saved to ${written.pdfPath}.`,
        8000
      );
    } else {
      new Notice(
        `Invoice ${number} created for ${client} — ${formatMoney(draft.totalMinor, this.settings.currency)}.`
      );
    }
  }

  private startVoidFlow(): void {
    const live = this.store.getInvoices().filter((i) => !i.voided);
    if (live.length === 0) {
      new Notice("No issued invoices to void.");
      return;
    }
    const items = live
      .slice()
      .sort((a, b) => b.issuedAt - a.issuedAt)
      .map((invoice) => ({
        id: invoice.id,
        number: invoice.number,
        client: invoice.client,
        label:
          `${invoice.number} — ${invoice.client} — ` +
          `${formatMoney(invoice.totalMinor, invoice.currency)}`,
      }));

    new InvoicePickModal(this.app, items, (id) => {
      void (async () => {
        const voided = await this.store.voidInvoice(id);
        new Notice(
          voided
            ? "Invoice voided. Its hours are billable again; the invoice file was left untouched."
            : "That invoice could not be voided."
        );
      })();
    }).open();
  }

  // ----------------------------------------------------------------------
  // License (offline Ed25519)
  // ----------------------------------------------------------------------

  /** Pure: updates in-memory state only. Callers decide when to persist. */
  refreshLicense(): void {
    if (!this.settings.licenseKey.trim()) {
      this.settings.isPro = false;
      this.settings.licenseEmail = "";
      return;
    }
    const result = LicenseManager.verify(this.settings.licenseKey);
    this.settings.isPro = result.valid;
    this.settings.licenseEmail = result.email ?? "";
  }

  // ----------------------------------------------------------------------
  // Status bar
  // ----------------------------------------------------------------------

  /**
   * Run the 1 Hz tick only while a timer is actually running.
   *
   * The previous version held an interval for the whole session and rewrote
   * the same "Not tracking" string 86,400 times a day. On an idle vault this
   * plugin now schedules nothing at all.
   */
  private syncTicker(): void {
    this.updateStatusBar();
    const shouldTick = this.store?.isRunning() === true;
    if (shouldTick && this.tickHandle === null) {
      this.tickHandle = window.setInterval(() => this.updateStatusBar(), TICK_MS);
      this.registerInterval(this.tickHandle);
    } else if (!shouldTick) {
      this.stopTicker();
    }
  }

  private stopTicker(): void {
    if (this.tickHandle !== null) {
      window.clearInterval(this.tickHandle);
      this.tickHandle = null;
    }
  }

  private updateStatusBar(): void {
    if (!this.statusBar) return;
    const active = this.store?.getActiveTimer();
    const text = active
      ? `${formatDuration(Math.max(0, Date.now() - active.start))} · ${active.client}`
      : "Not tracking";
    // Only touch the DOM when the text actually changed.
    if (text !== this.statusBarText) {
      this.statusBarText = text;
      this.statusBar.setText(text);
    }
    this.statusBar.toggleClass("tti-tracking", active !== null);
  }

  // ----------------------------------------------------------------------
  // Persistence
  // ----------------------------------------------------------------------

  async loadAll(): Promise<void> {
    const raw = (await this.loadData()) as unknown;
    const { data, report } = migrate(raw, Date.now());

    this.settings = data.settings;
    this.entries = data.entries;
    this.activeTimer = data.activeTimer;
    this.invoices = data.invoices;
    this.legacyUnknownBefore = data.legacyUnknownBefore;
    this.quarantined = data.quarantined;
    this.pendingIssue = data.pendingIssue;
    this.readOnly = report.readOnly;

    for (const note of report.notes) {
      new Notice(note, 15000);
    }
  }

  /** Coalesce rapid edits (settings typing) into a single write. */
  requestSave(): void {
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      void this.saveAll();
    }, SAVE_DEBOUNCE_MS);
  }

  /**
   * Persist the ledger.
   *
   * Every call is appended to a single chain. A rename burst, a settings blur
   * and a timer stop can otherwise have three `saveData` calls in flight at
   * once, and an older one completing last would write back stale state.
   */
  async saveAll(): Promise<void> {
    if (this.readOnly) return;
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.saveChain = this.saveChain.then(
      () => this.writeData(),
      () => this.writeData()
    );
    return this.saveChain;
  }

  private async writeData(): Promise<void> {
    const data: PersistedData = {
      schemaVersion: CURRENT_SCHEMA,
      settings: this.settings,
      entries: this.store ? [...this.store.getEntries()] : this.entries,
      activeTimer: this.store ? this.store.getActiveTimer() : this.activeTimer,
      invoices: this.store ? [...this.store.getInvoices()] : this.invoices,
      legacyUnknownBefore: this.legacyUnknownBefore,
      quarantined: this.quarantined,
      pendingIssue: this.pendingIssue,
    };
    try {
      await this.saveData(data);
    } catch (error) {
      // A silent persistence failure is the worst case here: the session keeps
      // behaving as though hours are billed while the file on disk says they
      // are not. Say so loudly.
      new Notice(
        `Time Tracker could not save your data: ${
          error instanceof Error ? error.message : String(error)
        }. Recent changes may be lost — check disk space and sync.`,
        0
      );
      throw error;
    }
  }

  /** True when the ledger came from a newer build and must not be written. */
  isReadOnly(): boolean {
    return this.readOnly;
  }

}

/** Format ms as H:MM:SS. */
function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
