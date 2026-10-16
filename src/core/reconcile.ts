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
  fileExists: (path: string) => boolean,
  plannedPdfPath: string | null
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

  // The PDF is optional and may legitimately be absent — export can be off, or
  // the client name may be outside what the PDF font can draw. Record only the
  // path that is actually there.
  const pdfCandidate = pending.pdfPath ?? plannedPdfPath;
  const pdfPath = pdfCandidate !== null && fileExists(pdfCandidate) ? pdfCandidate : null;

  return {
    action: "record",
    record: { ...pending, pdfPath },
    message:
      `Invoice ${pending.number} for ${pending.client} was written but not recorded — ` +
      `the plugin stopped midway. It has been recorded now, so its hours will not be billed again.`,
  };
}
