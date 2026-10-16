import { App, TFile, TFolder, normalizePath } from "obsidian";
import { InvoiceDocument } from "./core/invoiceModel";
import { renderInvoiceMarkdown } from "./core/markdown";
import { fileNameComponent } from "./core/text";
import { findUnsupported, renderInvoicePdf } from "./pdf/invoicePdf";
import { PageSizeName } from "./pdf/pdfWriter";
import { InvoiceRecord, PluginSettings } from "./types";

/**
 * Writing invoices into the vault.
 *
 * The one rule this file enforces is **create-only**. The previous version
 * built a filename from the year, the month and the first six letters of the
 * client, then called `vault.modify()` when that path already existed — so
 * issuing a deposit invoice and a final invoice to the same client in the same
 * month silently overwrote the first with the second. An invoice that has been
 * sent is a record of what somebody was asked to pay; it is never edited in
 * place here. A correction is a new invoice, and the old one is voided.
 */

export interface WrittenInvoice {
  markdownPath: string;
  pdfPath: string | null;
  /** Set when the Markdown was written but the PDF could not be. */
  pdfError: string | null;
}

export class InvoiceWriter {
  private app: App;
  private settings: PluginSettings;

  constructor(app: App, settings: PluginSettings) {
    this.app = app;
    this.settings = settings;
  }

  /**
   * The next free invoice number, starting from the stored sequence.
   * Skips any number already used by a record or already present on disk, so
   * a restored backup or a hand-made file can never be overwritten.
   */
  nextNumber(issuedAt: number, existing: readonly InvoiceRecord[], client: string): {
    number: string;
    seq: number;
  } {
    const year = new Date(issuedAt).getFullYear();
    // Voided invoices keep their number. A voided invoice may already have been
    // sent to a client, and two different documents sharing one number is how
    // a billing dispute starts.
    const used = new Set(existing.map((i) => i.number));
    let seq = Math.max(1, Math.floor(this.settings.invoiceSeq));

    // Bounded so a pathological vault cannot spin here.
    for (let attempt = 0; attempt < 10_000; attempt++) {
      const number = `${year}-${String(seq).padStart(4, "0")}`;
      if (!used.has(number) && !this.pathExists(this.markdownPathFor(number, client))) {
        return { number, seq };
      }
      seq += 1;
    }
    throw new Error("Could not find an unused invoice number. Check the invoice folder.");
  }

  /**
   * Where this invoice will be written, decided before anything is written.
   * The issuance records its intent at these paths first, so a crash during
   * the write can be reconciled afterwards by asking whether they exist.
   */
  plannedPaths(number: string, client: string): { markdownPath: string; pdfPath: string } {
    const markdownPath = this.markdownPathFor(number, client);
    return { markdownPath, pdfPath: this.pdfPathFor(markdownPath) };
  }

  private markdownPathFor(number: string, client: string): string {
    const folder = normalizePath(this.settings.invoiceFolder || "Invoices");
    const name = fileNameComponent(`Invoice ${number} - ${client}`, `Invoice ${number}`);
    return normalizePath(`${folder}/${name}.md`);
  }

  private pdfPathFor(markdownPath: string): string {
    return markdownPath.replace(/\.md$/, ".pdf");
  }

  private pathExists(path: string): boolean {
    return this.app.vault.getAbstractFileByPath(path) !== null;
  }

  /**
   * Write the Markdown invoice, and the PDF when enabled.
   *
   * The Markdown is written first and is the source of record: if PDF
   * rendering refuses (a client name outside the font's encoding, say), the
   * invoice still exists and the reason is returned rather than thrown away.
   */
  async write(
    doc: InvoiceDocument,
    opts: { exportPdf: boolean; pageSize: PageSizeName; createdAt: Date; creator: string }
  ): Promise<WrittenInvoice> {
    const folder = normalizePath(this.settings.invoiceFolder || "Invoices");
    await this.ensureFolder(folder);

    const markdownPath = this.markdownPathFor(doc.number, doc.client);
    if (this.pathExists(markdownPath)) {
      throw new Error(`"${markdownPath}" already exists. Nothing was overwritten.`);
    }
    await this.app.vault.create(markdownPath, renderInvoiceMarkdown(doc));

    if (!opts.exportPdf) {
      return { markdownPath, pdfPath: null, pdfError: null };
    }

    const pdfPath = this.pdfPathFor(markdownPath);
    if (this.pathExists(pdfPath)) {
      return {
        markdownPath,
        pdfPath: null,
        pdfError: `"${pdfPath}" already exists, so no PDF was written.`,
      };
    }

    try {
      const bytes = renderInvoicePdf(doc, {
        pageSize: opts.pageSize,
        createdAt: opts.createdAt,
        creator: opts.creator,
      });
      // `createBinary` needs an ArrayBuffer backing exactly these bytes.
      const buffer = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength
      ) as ArrayBuffer;
      await this.app.vault.createBinary(pdfPath, buffer);
      return { markdownPath, pdfPath, pdfError: null };
    } catch (error) {
      return {
        markdownPath,
        pdfPath: null,
        pdfError: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /** Characters in this invoice the PDF font cannot draw, if any. */
  static unsupportedForPdf(doc: InvoiceDocument): string[] {
    return findUnsupported(doc).map((f) => `${f.label}: ${f.characters.join(" ")}`);
  }

  /** Create `folder` and any missing parents. */
  private async ensureFolder(folder: string): Promise<void> {
    const segments = folder.split("/").filter(Boolean);
    let path = "";
    for (const segment of segments) {
      path = path ? `${path}/${segment}` : segment;
      const existing = this.app.vault.getAbstractFileByPath(path);
      if (existing instanceof TFolder) continue;
      if (existing instanceof TFile) {
        throw new Error(`"${path}" is a file, so invoices cannot be written there.`);
      }
      try {
        await this.app.vault.createFolder(path);
      } catch (error) {
        // A concurrent creation (another window, a sync client) is the outcome
        // we wanted anyway — but only if a folder is actually there now.
        // Anything else is a real failure and must not be mistaken for one.
        if (!(this.app.vault.getAbstractFileByPath(path) instanceof TFolder)) {
          throw new Error(
            `Could not create the invoice folder "${path}": ` +
              `${error instanceof Error ? error.message : String(error)}`
          );
        }
      }
    }
  }
}
