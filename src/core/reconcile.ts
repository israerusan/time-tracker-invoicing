import { InvoiceRecord } from "../types";

/**
 * Deciding what happened to an interrupted issuance.
 *
 * Writing the invoice files and recording the invoice are two operations, and
 * no amount of ordering makes them one. The protocol is: write down the
 * intent (including where the files are going), write the files, then record
 * the invoice. This function answers the only question that remains —
 * *did the files get written?* — and it is deliberately pure so every branch
 * can be tested, because the branches are reached only by crashing.
 *
 * The vault is the authority, not the error. A `vault.create()` that reaches
 * storage and *then* rejects is indistinguishable, from the caller's side,
 * from one that never wrote anything — except by looking. Trusting the
 * rejection would discard the marker for an invoice that is sitting in the
 * vault ready to send, and its hours would be billed again later.
 *
 * The asymmetry is intentional. Recording an invoice whose file exists costs
 * the user a voidable record. Discarding one costs them an hour they billed
 * and never got paid for, or one they bill twice.
 */

export interface ReconcileResult {
  /** `record`: the files are there, so the invoice counts. */
  action: "record" | "discard";
  /** The invoice to record, with its paths corrected to what truly exists. */
  record: InvoiceRecord | null;
  /** Explains the outcome to the user; both outcomes are surprising. */
  message: string;
}

export function resolvePendingIssue(
  pending: InvoiceRecord,
  fileExists: (path: string) => boolean
): ReconcileResult {
  const markdownPath = pending.markdownPath;
  const markdownWritten = markdownPath !== null && fileExists(markdownPath);

  if (!markdownWritten) {
    return {
      action: "discard",
      record: null,
      message:
        `Invoice ${pending.number} for ${pending.client} was not finished and no file was written. ` +
        `That time is still available to invoice.`,
    };
  }

  // The pending record carries where the PDF was *going* to go, which is why
  // that path is persisted with the marker rather than kept in memory: after a
  // crash there is no memory left, and a recovered invoice would otherwise
  // forget a PDF that is sitting right next to it.
  //
  // It is only an intention. The PDF may legitimately be absent — export can
  // be off, or the client's name may be outside what the font can draw — so
  // the path is kept only if the file is really there.
  const pdfPath =
    pending.pdfPath !== null && fileExists(pending.pdfPath) ? pending.pdfPath : null;

  return {
    action: "record",
    record: { ...pending, pdfPath },
    message:
      `Invoice ${pending.number} for ${pending.client} was written but not recorded — ` +
      `the plugin stopped midway. It has been recorded now, so its hours will not be billed again.`,
  };
}
