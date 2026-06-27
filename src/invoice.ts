import { App, Notice, TFile, normalizePath } from "obsidian";
import { ClientAggregate, TimeStore } from "./timeStore";
import { InvoiceLineItem, PluginSettings } from "./types";

/**
 * Invoice generation (PREMIUM).
 * Builds markdown invoices from aggregated time and writes them into the vault.
 * PDF export is stubbed (see exportPdfStub).
 */
export class InvoiceGenerator {
  private app: App;
  private settings: PluginSettings;

  constructor(app: App, settings: PluginSettings) {
    this.app = app;
    this.settings = settings;
  }

  /** Round hours per the configured granularity. */
  private roundHours(hours: number): number {
    const step = this.settings.roundHoursTo;
    if (!step || step <= 0) return Math.round(hours * 100) / 100;
    return Math.round(hours / step) * step;
  }

  private money(amount: number): string {
    return `${this.settings.currency} ${amount.toFixed(2)}`;
  }

  /** Build invoice line items (one per project) for a client aggregate. */
  buildLineItems(agg: ClientAggregate, rate: number): InvoiceLineItem[] {
    const items: InvoiceLineItem[] = [];
    for (const [project, rawHours] of agg.byProject) {
      const hours = this.roundHours(rawHours);
      items.push({
        description: project || "General",
        hours,
        rate,
        amount: Math.round(hours * rate * 100) / 100,
      });
    }
    return items.sort((a, b) => b.amount - a.amount);
  }

  /** Render a markdown invoice. `invoiceNumber` and `dateLabel` are passed in. */
  renderMarkdown(opts: {
    client: string;
    items: InvoiceLineItem[];
    invoiceNumber: string;
    dateLabel: string;
  }): string {
    const { client, items, invoiceNumber, dateLabel } = opts;
    const subtotal = items.reduce((s, i) => s + i.amount, 0);
    const totalHours = items.reduce((s, i) => s + i.hours, 0);
    const s = this.settings;

    const lines: string[] = [];
    lines.push("---");
    lines.push(`invoice: "${invoiceNumber}"`);
    lines.push(`client: "${client}"`);
    lines.push(`date: "${dateLabel}"`);
    lines.push(`total: ${subtotal.toFixed(2)}`);
    lines.push(`currency: "${s.currency}"`);
    lines.push("---");
    lines.push("");
    lines.push(`# Invoice ${invoiceNumber}`);
    lines.push("");
    lines.push(`**From:** ${s.businessName}`);
    if (s.businessAddress) lines.push(`${s.businessAddress}`);
    if (s.businessEmail) lines.push(`${s.businessEmail}`);
    lines.push("");
    lines.push(`**Bill to:** ${client}`);
    lines.push("");
    lines.push(`**Date:** ${dateLabel}`);
    lines.push("");
    lines.push("| Description | Hours | Rate | Amount |");
    lines.push("| --- | ---: | ---: | ---: |");
    for (const i of items) {
      lines.push(
        `| ${i.description} | ${i.hours.toFixed(2)} | ${this.money(i.rate)} | ${this.money(i.amount)} |`
      );
    }
    lines.push(`| **Total** | **${totalHours.toFixed(2)}** | | **${this.money(subtotal)}** |`);
    lines.push("");
    lines.push(`**Amount due: ${this.money(subtotal)}**`);
    lines.push("");
    return lines.join("\n");
  }

  /**
   * Generate an invoice file for a client and write it into the vault.
   * Returns the created TFile.
   */
  async generateForClient(opts: {
    store: TimeStore;
    client: string;
    rate: number;
    invoiceNumber: string;
    dateLabel: string;
  }): Promise<TFile | null> {
    const { store, client, rate, invoiceNumber, dateLabel } = opts;
    const aggs = store.aggregateByClient({ client });
    if (aggs.length === 0 || aggs[0].totalHours === 0) {
      new Notice(`No tracked time found for "${client}".`);
      return null;
    }

    const items = this.buildLineItems(aggs[0], rate);
    const md = this.renderMarkdown({ client, items, invoiceNumber, dateLabel });

    const folder = normalizePath(this.settings.invoiceFolder || "Invoices");
    await this.ensureFolder(folder);

    const safeClient = client.replace(/[\\/:*?"<>|]/g, "-");
    const path = normalizePath(`${folder}/Invoice ${invoiceNumber} - ${safeClient}.md`);

    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) {
      await this.app.vault.modify(existing, md);
      return existing;
    }
    return await this.app.vault.create(path, md);
  }

  private async ensureFolder(folder: string): Promise<void> {
    const existing = this.app.vault.getAbstractFileByPath(folder);
    if (existing) return;
    try {
      await this.app.vault.createFolder(folder);
    } catch {
      // Folder may have been created concurrently — ignore.
    }
  }

  /**
   * PDF export STUB.
   *
   * TODO(pdf): Implement real PDF export. Options:
   *   - Render the invoice note via Obsidian's built-in "Export to PDF"
   *     (workspace command) once the note is open.
   *   - Bundle a lightweight generator (e.g. jsPDF / pdfmake) and draw the
   *     line items directly. Keep it fully local — no external API.
   * For now we surface a Notice so the command is wired end-to-end.
   */
  async exportPdfStub(invoiceFile: TFile): Promise<void> {
    new Notice(
      `PDF export is coming soon. Invoice saved as markdown: ${invoiceFile.path}\n` +
        `Tip: open it and use Obsidian's "Export to PDF" in the meantime.`
    );
  }
}
