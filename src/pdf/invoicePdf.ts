import { InvoiceDocument } from "../core/invoiceModel";
import { formatHours, formatMoney } from "../core/money";
import { FontName, measureBytes } from "./fontMetrics";
import { ContentStream, PAGE_SIZES, PageSizeName, PdfPage, buildPdf } from "./pdfWriter";
import { encodeWinAnsi, unsupportedCharacters } from "./winAnsi";

/**
 * Laying an invoice out on paper.
 *
 * Reads the same `InvoiceDocument` the Markdown renderer reads, so the two can
 * never disagree about a figure. Everything here is layout: pagination,
 * wrapping, where the rules go.
 */

const REGULAR: FontName = "Helvetica";
const BOLD: FontName = "Helvetica-Bold";
const F_REGULAR = "F1";
const F_BOLD = "F2";

const MARGIN = 56;
const FOOTER_SPACE = 48;
const ROW_PAD = 6;
const LINE_HEIGHT = 13;
const BODY_SIZE = 9.5;
const SMALL_SIZE = 8;

interface Column {
  /** x of the column's left edge. */
  left: number;
  /** x of the column's right edge. */
  right: number;
}

interface Layout {
  width: number;
  height: number;
  description: Column;
  hours: Column;
  rate: Column;
  amount: Column;
}

function layoutFor(size: PageSizeName): Layout {
  const { width, height } = PAGE_SIZES[size];
  const contentRight = width - MARGIN;
  // Money columns are sized from the right; the description takes the rest.
  const amount = { left: contentRight - 96, right: contentRight };
  const rate = { left: amount.left - 86, right: amount.left - 10 };
  const hours = { left: rate.left - 62, right: rate.left - 10 };
  const description = { left: MARGIN, right: hours.left - 10 };
  return { width, height, description, hours, rate, amount };
}

/** Greedy word wrap. Words longer than the column are split mid-word. */
export function wrapText(font: FontName, size: number, maxWidth: number, text: string): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];
  const measure = (s: string): number => measureBytes(font, encodeWinAnsi(s).bytes, size);

  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (measure(candidate) <= maxWidth || current === "") {
      if (measure(candidate) <= maxWidth) {
        current = candidate;
        continue;
      }
      // A single word wider than the column: break it by characters.
      let chunk = "";
      for (const ch of word) {
        if (measure(chunk + ch) > maxWidth && chunk !== "") {
          lines.push(chunk);
          chunk = ch;
        } else {
          chunk += ch;
        }
      }
      current = chunk;
      continue;
    }
    lines.push(current);
    current = word;
  }
  if (current) lines.push(current);
  return lines;
}

/** Every field that reaches the page, so unsupported characters can be named. */
function textFields(doc: InvoiceDocument): { label: string; value: string }[] {
  const fields = [
    { label: "invoice number", value: doc.number },
    { label: "client name", value: doc.client },
    { label: "business name", value: doc.businessName },
    { label: "business address", value: doc.businessAddress },
    { label: "business email", value: doc.businessEmail },
    { label: "payment terms", value: doc.paymentTerms },
    { label: "currency", value: doc.currency },
  ];
  for (const line of doc.lines) {
    fields.push({ label: `line item "${line.description}"`, value: line.description });
  }
  return fields;
}

export interface UnsupportedField {
  label: string;
  characters: string[];
}

/**
 * Characters the base-14 fonts cannot draw, grouped by the field they are in.
 *
 * PDF export refuses when this is non-empty. The alternative — dropping or
 * transliterating the characters — would silently alter a legal entity's name
 * on a document that demands payment, which is a worse outcome than not
 * producing the file. The Markdown invoice has no such limit and is always
 * written.
 */
export function findUnsupported(doc: InvoiceDocument): UnsupportedField[] {
  const out: UnsupportedField[] = [];
  for (const field of textFields(doc)) {
    const chars = unsupportedCharacters(field.value);
    if (chars.length > 0) out.push({ label: field.label, characters: chars });
  }
  return out;
}

interface PageBuilder {
  stream: ContentStream;
  y: number;
}

export function renderInvoicePdf(
  doc: InvoiceDocument,
  opts: { pageSize: PageSizeName; createdAt: Date; creator: string }
): Uint8Array {
  const unsupported = findUnsupported(doc);
  if (unsupported.length > 0) {
    const detail = unsupported
      .map((f) => `${f.label}: ${f.characters.join(" ")}`)
      .join("; ");
    throw new Error(
      `PDF export cannot draw some characters in this invoice (${detail}). ` +
        `The Markdown invoice was written and contains them correctly.`
    );
  }

  const L = layoutFor(opts.pageSize);
  const pages: PageBuilder[] = [];
  const bottomLimit = MARGIN + FOOTER_SPACE;

  const newPage = (): PageBuilder => {
    const page: PageBuilder = { stream: new ContentStream(), y: L.height - MARGIN };
    pages.push(page);
    return page;
  };

  let page = newPage();

  // ---- masthead ------------------------------------------------------------
  page.stream.grey(0).text(F_BOLD, 20, MARGIN, page.y - 14, "INVOICE");
  page.stream.textRight(F_BOLD, BOLD, 11, L.amount.right, page.y - 14, doc.number);
  page.y -= 34;

  page.stream.grey(0.75).rect(MARGIN, page.y, L.amount.right - MARGIN, 0.8);
  page.y -= 18;

  // From / Bill to, side by side.
  const columnTop = page.y;
  page.stream.grey(0.45).text(F_REGULAR, SMALL_SIZE, MARGIN, page.y, "FROM");
  page.stream.grey(0.45).text(F_REGULAR, SMALL_SIZE, L.hours.left, page.y, "BILL TO");
  let leftY = page.y - 14;
  let rightY = page.y - 14;

  // The sender block must stay inside its own column. A long legal name or an
  // unbroken address line would otherwise run under "BILL TO" and overlap it.
  const senderWidth = L.hours.left - MARGIN - 12;
  page.stream.grey(0);
  for (const nameLine of wrapText(BOLD, 10.5, senderWidth, doc.businessName)) {
    page.stream.text(F_BOLD, 10.5, MARGIN, leftY, nameLine);
    leftY -= LINE_HEIGHT;
  }
  for (const addressLine of doc.businessAddress.split(/[\r\n]+/)) {
    if (!addressLine.trim()) continue;
    for (const wrapped of wrapText(REGULAR, BODY_SIZE, senderWidth, addressLine.trim())) {
      page.stream.text(F_REGULAR, BODY_SIZE, MARGIN, leftY, wrapped);
      leftY -= LINE_HEIGHT;
    }
  }
  if (doc.businessEmail) {
    for (const wrapped of wrapText(REGULAR, BODY_SIZE, senderWidth, doc.businessEmail)) {
      page.stream.text(F_REGULAR, BODY_SIZE, MARGIN, leftY, wrapped);
      leftY -= LINE_HEIGHT;
    }
  }

  for (const clientLine of wrapText(BOLD, 10.5, L.amount.right - L.hours.left, doc.client)) {
    page.stream.text(F_BOLD, 10.5, L.hours.left, rightY, clientLine);
    rightY -= LINE_HEIGHT;
  }
  page.stream.grey(0.35).text(F_REGULAR, BODY_SIZE, L.hours.left, rightY, `Issued ${doc.dateLabel}`);
  rightY -= LINE_HEIGHT;
  if (doc.periodLabel) {
    page.stream.text(F_REGULAR, BODY_SIZE, L.hours.left, rightY, `Period ${doc.periodLabel}`);
    rightY -= LINE_HEIGHT;
  }

  page.y = Math.min(leftY, rightY) - 16;
  void columnTop;

  // ---- table ---------------------------------------------------------------
  const drawTableHeader = (target: PageBuilder, continued: boolean): void => {
    target.stream.grey(0.93).rect(MARGIN, target.y - 4, L.amount.right - MARGIN, 18);
    const baseline = target.y + 2;
    target.stream.grey(0.25);
    target.stream.text(
      F_BOLD,
      SMALL_SIZE,
      L.description.left + 4,
      baseline,
      continued ? "DESCRIPTION (CONTINUED)" : "DESCRIPTION"
    );
    target.stream.textRight(F_BOLD, BOLD, SMALL_SIZE, L.hours.right, baseline, "HOURS");
    target.stream.textRight(F_BOLD, BOLD, SMALL_SIZE, L.rate.right, baseline, "RATE");
    target.stream.textRight(F_BOLD, BOLD, SMALL_SIZE, L.amount.right, baseline, "AMOUNT");
    target.y -= 22;
  };

  drawTableHeader(page, false);

  let carried = 0;
  for (const line of doc.lines) {
    const wrapped = wrapText(REGULAR, BODY_SIZE, L.description.right - L.description.left - 8, line.description);
    const rowHeight = wrapped.length * LINE_HEIGHT + ROW_PAD;

    // Measure the finished row before committing to it: a row that fits by
    // line count before wrapping can still cross the footer after wrapping.
    if (page.y - rowHeight < bottomLimit) {
      page.stream.grey(0.45).textRight(
        F_REGULAR,
        REGULAR,
        SMALL_SIZE,
        L.amount.right,
        page.y - 2,
        `Carried forward  ${formatMoney(carried, doc.currency)}`
      );
      page = newPage();
      drawTableHeader(page, true);
      page.stream.grey(0.45).text(
        F_REGULAR,
        SMALL_SIZE,
        L.description.left + 4,
        page.y + 4,
        `Brought forward  ${formatMoney(carried, doc.currency)}`
      );
      page.y -= 14;
    }

    const baseline = page.y - LINE_HEIGHT + 4;
    page.stream.grey(0);
    wrapped.forEach((text, i) => {
      page.stream.text(F_REGULAR, BODY_SIZE, L.description.left + 4, baseline - i * LINE_HEIGHT, text);
    });
    page.stream.textRight(F_REGULAR, REGULAR, BODY_SIZE, L.hours.right, baseline, formatHours(line.seconds));
    page.stream.textRight(
      F_REGULAR,
      REGULAR,
      BODY_SIZE,
      L.rate.right,
      baseline,
      formatMoney(line.rateMinor, doc.currency)
    );
    page.stream.textRight(
      F_REGULAR,
      REGULAR,
      BODY_SIZE,
      L.amount.right,
      baseline,
      formatMoney(line.amountMinor, doc.currency)
    );

    page.y -= rowHeight;
    page.stream.grey(0.88).rect(MARGIN, page.y + 2, L.amount.right - MARGIN, 0.5);
    carried += line.amountMinor;
  }

  // ---- totals --------------------------------------------------------------
  const totalsHeight = 70 + (doc.paymentTerms.trim() ? LINE_HEIGHT : 0);
  if (page.y - totalsHeight < bottomLimit) {
    page = newPage();
  }

  page.y -= 10;
  page.stream.grey(0).text(F_BOLD, BODY_SIZE, L.description.left + 4, page.y, "Total");
  page.stream.textRight(F_BOLD, BOLD, BODY_SIZE, L.hours.right, page.y, formatHours(doc.totalSeconds));
  page.stream.textRight(
    F_BOLD,
    BOLD,
    BODY_SIZE,
    L.amount.right,
    page.y,
    formatMoney(doc.totalMinor, doc.currency)
  );
  page.y -= 16;

  page.stream.grey(0.15).rect(L.hours.left, page.y + 4, L.amount.right - L.hours.left, 0.9);
  page.y -= 22;
  page.stream.grey(0).text(F_BOLD, 12, L.hours.left, page.y, "Amount due");
  page.stream.textRight(F_BOLD, BOLD, 12, L.amount.right, page.y, formatMoney(doc.totalMinor, doc.currency));
  page.y -= 20;

  if (doc.paymentTerms.trim()) {
    for (const termsLine of wrapText(REGULAR, BODY_SIZE, L.amount.right - MARGIN, doc.paymentTerms.trim())) {
      if (page.y < bottomLimit) page = newPage();
      page.stream.grey(0.3).text(F_REGULAR, BODY_SIZE, MARGIN, page.y, termsLine);
      page.y -= LINE_HEIGHT;
    }
  }

  // ---- notes ---------------------------------------------------------------
  if (doc.notes.length > 0) {
    page.y -= 8;
    for (const note of doc.notes) {
      for (const noteLine of wrapText(REGULAR, SMALL_SIZE, L.amount.right - MARGIN - 10, note)) {
        if (page.y < bottomLimit) page = newPage();
        page.stream.grey(0.5).text(F_REGULAR, SMALL_SIZE, MARGIN + 10, page.y, noteLine);
        page.y -= 11;
      }
      page.y -= 3;
    }
  }

  // ---- footers -------------------------------------------------------------
  pages.forEach((p, i) => {
    p.stream.grey(0.55).text(
      F_REGULAR,
      SMALL_SIZE,
      MARGIN,
      MARGIN - 10,
      `Invoice ${doc.number} — ${doc.client}`
    );
    p.stream.textRight(
      F_REGULAR,
      REGULAR,
      SMALL_SIZE,
      L.amount.right,
      MARGIN - 10,
      `Page ${i + 1} of ${pages.length}`
    );
  });

  const pdfPages: PdfPage[] = pages.map((p) => ({
    width: L.width,
    height: L.height,
    content: p.stream,
  }));

  return buildPdf({
    pages: pdfPages,
    fonts: [
      { ref: F_REGULAR, base: REGULAR },
      { ref: F_BOLD, base: BOLD },
    ],
    metadata: {
      title: `Invoice ${doc.number} — ${doc.client}`,
      author: doc.businessName,
      creator: opts.creator,
      created: opts.createdAt,
    },
  });
}
