import { InvoiceDocument } from "./invoiceModel";
import { formatHours, formatMoney, minorUnitDigits, minorUnitScale } from "./money";
import { tableCell, yamlScalar } from "./text";

/**
 * Markdown rendering of an invoice.
 *
 * Reads the same `InvoiceDocument` the PDF writer reads, so the two can never
 * disagree about a number — but note that "same model" is not by itself a
 * guarantee of identical output (a renderer can still truncate or drop a row),
 * which is why tests assert both renderings against the model rather than
 * against each other.
 */
export function renderInvoiceMarkdown(doc: InvoiceDocument): string {
  const lines: string[] = [];

  lines.push("---");
  lines.push(`invoice: ${yamlScalar(doc.number)}`);
  lines.push(`client: ${yamlScalar(doc.client)}`);
  lines.push(`date: ${yamlScalar(doc.dateLabel)}`);
  if (doc.periodLabel) lines.push(`period: ${yamlScalar(doc.periodLabel)}`);
  lines.push(`currency: ${yamlScalar(doc.currency)}`);
  // Written as a plain number so Dataview/Bases can sum it.
  lines.push(
    `total: ${(doc.totalMinor / minorUnitScale(doc.currency)).toFixed(minorUnitDigits(doc.currency))}`
  );
  lines.push(`hours: ${formatHours(doc.totalSeconds)}`);
  lines.push("---");
  lines.push("");

  lines.push(`# Invoice ${doc.number}`);
  lines.push("");
  lines.push(`**From:** ${doc.businessName}`);
  for (const addressLine of doc.businessAddress.split(/\r\n|\r|\n/)) {
    if (addressLine.trim()) lines.push(addressLine.trim());
  }
  if (doc.businessEmail) lines.push(doc.businessEmail);
  lines.push("");
  lines.push(`**Bill to:** ${doc.client}`);
  lines.push("");
  lines.push(`**Date:** ${doc.dateLabel}`);
  if (doc.periodLabel) {
    lines.push("");
    lines.push(`**Period:** ${doc.periodLabel}`);
  }
  lines.push("");

  lines.push("| Description | Hours | Rate | Amount |");
  lines.push("| --- | ---: | ---: | ---: |");
  for (const line of doc.lines) {
    lines.push(
      `| ${tableCell(line.description)} | ${formatHours(line.seconds)} | ` +
        `${formatMoney(line.rateMinor, doc.currency)} | ${formatMoney(line.amountMinor, doc.currency)} |`
    );
  }
  lines.push(
    `| **Total** | **${formatHours(doc.totalSeconds)}** | | **${formatMoney(doc.totalMinor, doc.currency)}** |`
  );
  lines.push("");
  lines.push(`**Amount due: ${formatMoney(doc.totalMinor, doc.currency)}**`);

  if (doc.paymentTerms.trim()) {
    lines.push("");
    lines.push(doc.paymentTerms.trim());
  }

  if (doc.notes.length > 0) {
    lines.push("");
    lines.push("---");
    lines.push("");
    lines.push("> [!note] Notes recorded when this invoice was issued");
    for (const note of doc.notes) lines.push(`> - ${note}`);
  }

  lines.push("");
  return lines.join("\n");
}
