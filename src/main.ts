import { FuzzySuggestModal, Notice, Plugin, TFile } from "obsidian";
import {
  ActiveTimer,
  DEFAULT_SETTINGS,
  PersistedData,
  PluginSettings,
  TimeEntry,
} from "./types";
import { LicenseManager } from "./licenseManager";
import { TimeStore } from "./timeStore";
import { InvoiceGenerator } from "./invoice";
import { TimeTrackerSettingTab } from "./settings";

export default class TimeTrackerPlugin extends Plugin {
  settings!: PluginSettings;
  licenseManager!: LicenseManager;
  store!: TimeStore;

  private entries: TimeEntry[] = [];
  private activeTimer: ActiveTimer | null = null;
  private statusBar?: HTMLElement;
  private tickHandle?: number;

  async onload(): Promise<void> {
    await this.loadAll();

    this.licenseManager = new LicenseManager({
      endpoint: this.settings.licenseEndpoint,
      licenseKey: this.settings.licenseKey,
    });
    this.licenseManager.validate();

    this.store = new TimeStore(this.entries, this.activeTimer, async () => {
      // Keep the persisted blob in sync with the store's mutations.
      this.activeTimer = this.store.getActiveTimer();
      await this.saveAll();
    });

    // ---- Status bar (live timer) ----------------------------------------
    this.statusBar = this.addStatusBarItem();
    this.statusBar.addClass("tti-statusbar");
    this.statusBar.onClickEvent(() => this.toggleTracking());
    this.updateStatusBar();
    this.tickHandle = window.setInterval(() => this.updateStatusBar(), 1000);
    this.registerInterval(this.tickHandle);

    // ---- Commands (Lite: tracking) --------------------------------------
    this.addCommand({
      id: "start-tracking",
      name: "Start tracking active note",
      callback: () => this.startTracking(),
    });

    this.addCommand({
      id: "stop-tracking",
      name: "Stop tracking",
      callback: () => this.stopTracking(),
    });

    this.addCommand({
      id: "toggle-tracking",
      name: "Toggle tracking (start/stop)",
      callback: () => this.toggleTracking(),
    });

    this.addCommand({
      id: "show-totals",
      name: "Show tracked time totals",
      callback: () => this.showTotals(),
    });

    // ---- Commands (Premium: invoicing) ----------------------------------
    this.addCommand({
      id: "generate-invoice",
      name: "Generate invoice (Premium)",
      callback: () => {
        if (!this.requirePremium("Invoice generation")) return;
        this.pickClientAndInvoice();
      },
    });

    this.addCommand({
      id: "verify-license",
      name: "Verify license key",
      callback: async () => {
        const s = await this.refreshLicense();
        new Notice(s.message ?? (s.valid ? "Premium active" : "Lite tier"));
      },
    });

    this.addRibbonIcon("clock", "Time Tracker: start/stop", () => this.toggleTracking());

    this.addSettingTab(new TimeTrackerSettingTab(this.app, this));
  }

  onunload(): void {
    // Intervals registered via registerInterval are cleared automatically.
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
    new Notice(`▶ Tracking "${file.basename}" → ${client} / ${project}`);
    this.updateStatusBar();
  }

  async stopTracking(): Promise<void> {
    if (!this.store.isRunning()) {
      new Notice("No timer running.");
      return;
    }
    const entry = await this.store.stop(Date.now());
    if (entry) {
      const hrs = TimeStore.entryHours(entry);
      new Notice(`⏹ Stopped. Logged ${hrs.toFixed(2)}h to ${entry.client}.`);
    }
    this.updateStatusBar();
  }

  toggleTracking(): void {
    if (this.store.isRunning()) this.stopTracking();
    else this.startTracking();
  }

  private showTotals(): void {
    const aggs = this.store.aggregateByClient();
    if (aggs.length === 0) {
      new Notice("No tracked time yet.");
      return;
    }
    const lines = aggs.map((a) => `${a.client}: ${a.totalHours.toFixed(2)}h`);
    new Notice("Tracked time by client:\n" + lines.join("\n"), 8000);
  }

  // ----------------------------------------------------------------------
  // Invoicing (premium)
  // ----------------------------------------------------------------------

  private pickClientAndInvoice(): void {
    const clients = this.store.listClients();
    if (clients.length === 0) {
      new Notice("No tracked time to invoice yet.");
      return;
    }
    new ClientPickModal(this.app, clients, (client) => this.generateInvoice(client)).open();
  }

  private async generateInvoice(client: string): Promise<void> {
    const gen = new InvoiceGenerator(this.app, this.settings);
    const now = new Date();
    const dateLabel = now.toISOString().slice(0, 10);
    const invoiceNumber = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(
      2,
      "0"
    )}-${client.replace(/[^A-Za-z0-9]/g, "").slice(0, 6).toUpperCase() || "INV"}`;

    const file = await gen.generateForClient({
      store: this.store,
      client,
      rate: this.settings.defaultHourlyRate,
      invoiceNumber,
      dateLabel,
    });
    if (!file) return;
    await this.app.workspace.getLeaf(false).openFile(file);
    new Notice(`Invoice generated for ${client}.`);
    // Wire the PDF export stub end-to-end.
    await gen.exportPdfStub(file);
  }

  requirePremium(featureName: string): boolean {
    if (this.licenseManager.isPremium()) return true;
    new Notice(`${featureName} is a premium feature. Add a license key in settings.`);
    return false;
  }

  async refreshLicense() {
    this.licenseManager.setConfig({
      endpoint: this.settings.licenseEndpoint,
      licenseKey: this.settings.licenseKey,
    });
    return this.licenseManager.validate();
  }

  // ----------------------------------------------------------------------
  // Status bar
  // ----------------------------------------------------------------------

  private updateStatusBar(): void {
    if (!this.statusBar) return;
    const active = this.store?.getActiveTimer();
    if (!active) {
      this.statusBar.setText("⏱ Not tracking");
      this.statusBar.removeClass("tti-tracking");
      return;
    }
    const ms = Math.max(0, Date.now() - active.start);
    this.statusBar.setText(`⏺ ${formatDuration(ms)} · ${active.client}`);
    this.statusBar.addClass("tti-tracking");
  }

  // ----------------------------------------------------------------------
  // Persistence
  // ----------------------------------------------------------------------

  async loadAll(): Promise<void> {
    const raw = (await this.loadData()) as Partial<PersistedData> | null;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, raw?.settings ?? {});
    this.entries = raw?.entries ?? [];
    this.activeTimer = raw?.activeTimer ?? null;
  }

  async saveAll(): Promise<void> {
    const data: PersistedData = {
      settings: this.settings,
      entries: this.store ? this.store.getEntries() : this.entries,
      activeTimer: this.store ? this.store.getActiveTimer() : this.activeTimer,
    };
    await this.saveData(data);
    if (this.licenseManager) {
      this.licenseManager.setConfig({
        endpoint: this.settings.licenseEndpoint,
        licenseKey: this.settings.licenseKey,
      });
    }
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

/** Simple fuzzy picker for choosing which client to invoice. */
class ClientPickModal extends FuzzySuggestModal<string> {
  private clients: string[];
  private onPick: (client: string) => void;

  constructor(app: import("obsidian").App, clients: string[], onPick: (c: string) => void) {
    super(app);
    this.clients = clients;
    this.onPick = onPick;
    this.setPlaceholder("Select a client to invoice…");
  }

  getItems(): string[] {
    return this.clients;
  }

  getItemText(item: string): string {
    return item;
  }

  onChooseItem(item: string): void {
    this.onPick(item);
  }
}
