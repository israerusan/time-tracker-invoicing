import { FontName, measureBytes, widthsArray } from "./fontMetrics";
import { definedBytes, encodeWinAnsi, fromWinAnsiByte } from "./winAnsi";

/**
 * A minimal PDF 1.4 writer.
 *
 * Deliberately small: an invoice is text in a fixed layout, and the base-14
 * fonts mean no font program has to be embedded. The alternative was bundling
 * jsPDF (~350 KB) or pdfmake (~1 MB) into a plugin whose whole bundle is
 * currently 99 KB, with no option to fetch it lazily because the plugin makes
 * no network calls at all.
 *
 * Everything below exists because of a specific way naive PDF writers produce
 * a file that will not open:
 *
 *  - Offsets in the cross-reference table are BYTE offsets. The output is
 *    assembled as byte chunks and measured with `byteLength`, never with a
 *    JavaScript string's `.length` — one `é` written as UTF-8 would shift
 *    every later offset by one and break the file.
 *  - Every byte above 0x7E inside a content stream is written as a three-digit
 *    octal escape, so each object body really is ASCII and the two measures
 *    agree by construction.
 *  - A stream's `/Length` is the encoded byte count of the stream data.
 *  - The xref table starts with the free object 0 at generation 65535, every
 *    entry is exactly 20 bytes, and `startxref` points at the byte offset of
 *    the `xref` keyword itself.
 *  - Numbers are emitted through `num()`, which rejects NaN and Infinity and
 *    never produces exponential notation. (`toFixed` is locale-independent, so
 *    a comma decimal separator cannot leak into an operand.)
 *  - A `ToUnicode` CMap is attached to each font so selecting, copying and
 *    searching the text works, and so a screen reader gets real characters.
 */

export const PAGE_SIZES = {
  A4: { width: 595.28, height: 841.89 },
  Letter: { width: 612, height: 792 },
} as const;

export type PageSizeName = keyof typeof PAGE_SIZES;

/** Format a number for a PDF operand. Throws rather than emit `NaN`. */
export function num(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error(`Refusing to write a non-finite number (${value}) into a PDF.`);
  }
  // Page geometry never approaches this, but a number large enough for
  // `String()` to switch to exponential notation would emit a token no PDF
  // parser accepts, so refuse rather than write it.
  if (Math.abs(value) >= 1e15) {
    throw new Error(`Refusing to write an out-of-range number (${value}) into a PDF.`);
  }
  const rounded = Math.round(value * 1000) / 1000;
  if (Number.isInteger(rounded)) return rounded.toFixed(0);
  return rounded.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

/**
 * A PDF literal string from already-encoded WinAnsi bytes.
 * `(`, `)` and `\` are escaped; everything outside printable ASCII becomes an
 * octal escape so the result is pure ASCII.
 */
export function literalString(bytes: readonly number[]): string {
  let out = "(";
  for (const byte of bytes) {
    if (byte === 0x28) out += "\\(";
    else if (byte === 0x29) out += "\\)";
    else if (byte === 0x5c) out += "\\\\";
    else if (byte < 0x20 || byte > 0x7e) out += "\\" + byte.toString(8).padStart(3, "0");
    else out += String.fromCharCode(byte);
  }
  return out + ")";
}

/**
 * A PDF *text string* (document metadata), as UTF-16BE with a byte-order mark.
 *
 * Text strings are not WinAnsi. A string written with WinAnsi bytes is decoded
 * as PDFDocEncoding, whose 0x80-0x9F block differs — an em dash (0x97 in
 * WinAnsi) comes back out as a caron S. UTF-16BE sidesteps the question and,
 * unlike page content, has no glyph limit, so the title can carry any
 * character the client's name actually contains.
 */
export function textString(value: string): string {
  let out = "<FEFF";
  for (let i = 0; i < value.length; i++) {
    out += value.charCodeAt(i).toString(16).toUpperCase().padStart(4, "0");
  }
  return out + ">";
}

/** Assert-and-convert: every char must already be a single byte. */
function latin1Bytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code > 0xff) {
      throw new Error(
        `Internal error: a non-byte character (U+${code.toString(16).toUpperCase()}) reached the PDF serializer.`
      );
    }
    out[i] = code;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Content streams
// ---------------------------------------------------------------------------

/**
 * Drawing commands for one page. Coordinates are PDF points (1/72 inch) with
 * the origin at the bottom-left, which is why callers track a descending `y`.
 */
export class ContentStream {
  private ops: string[] = [];
  private unsupported = new Set<string>();

  /** Characters encountered that WinAnsi cannot draw. */
  unsupportedCharacters(): string[] {
    return Array.from(this.unsupported);
  }

  /** Set the non-stroking colour (0–1 greyscale). */
  grey(value: number): this {
    this.ops.push(`${num(value)} g`);
    return this;
  }

  /** Filled rectangle — also how every rule and table border is drawn, which
   * avoids depending on stroke width and dash state being in a known state. */
  rect(x: number, y: number, width: number, height: number): this {
    this.ops.push(`${num(x)} ${num(y)} ${num(width)} ${num(height)} re f`);
    return this;
  }

  /**
   * Draw text with its baseline at (x, y).
   * Uses `Tm` rather than `Td` so each run is positioned absolutely and a
   * mistake in one run cannot shift every run after it.
   */
  text(fontRef: string, size: number, x: number, y: number, value: string): this {
    const { bytes, unsupported } = encodeWinAnsi(value);
    for (const ch of unsupported) this.unsupported.add(ch);
    if (bytes.length === 0) return this;
    this.ops.push(
      `BT /${fontRef} ${num(size)} Tf 1 0 0 1 ${num(x)} ${num(y)} Tm ${literalString(bytes)} Tj ET`
    );
    return this;
  }

  /** Right-align text so its last glyph ends at `right`. */
  textRight(
    fontRef: string,
    font: FontName,
    size: number,
    right: number,
    y: number,
    value: string
  ): this {
    const { bytes } = encodeWinAnsi(value);
    const width = measureBytes(font, bytes, size);
    return this.text(fontRef, size, right - width, y, value);
  }

  build(): string {
    return this.ops.join("\n");
  }
}

// ---------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------

export interface PdfFontSpec {
  /** Resource name used in content streams, e.g. "F1". */
  ref: string;
  base: FontName;
}

export interface PdfPage {
  width: number;
  height: number;
  content: ContentStream;
}

export interface PdfMetadata {
  title: string;
  author: string;
  creator: string;
  /** Creation instant. Written in PDF's own date syntax, with a UTC offset. */
  created: Date;
}

/** PDF date syntax: D:YYYYMMDDHHmmSSOHH'mm'. */
export function pdfDate(date: Date): string {
  const pad = (n: number, w = 2) => String(Math.abs(n)).padStart(w, "0");
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes === 0 ? "Z" : offsetMinutes > 0 ? "+" : "-";
  const body =
    `D:${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  if (sign === "Z") return `${body}Z`;
  return `${body}${sign}${pad(Math.floor(Math.abs(offsetMinutes) / 60))}'${pad(
    Math.abs(offsetMinutes) % 60
  )}'`;
}

/** The ToUnicode CMap that makes the text selectable and searchable. */
function toUnicodeCMap(): string {
  const codes = definedBytes();
  const chunks: string[] = [];
  // bfchar sections are capped at 100 entries by the specification.
  for (let i = 0; i < codes.length; i += 100) {
    const slice = codes.slice(i, i + 100);
    const body = slice
      .map((byte) => {
        const unicode = fromWinAnsiByte(byte) ?? 0x20;
        return `<${byte.toString(16).padStart(2, "0")}> <${unicode
          .toString(16)
          .padStart(4, "0")}>`;
      })
      .join("\n");
    chunks.push(`${slice.length} beginbfchar\n${body}\nendbfchar`);
  }
  return [
    "/CIDInit /ProcSet findresource begin",
    "12 dict begin",
    "begincmap",
    "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def",
    "/CMapName /Adobe-Identity-UCS def",
    "/CMapType 2 def",
    "1 begincodespacerange",
    "<00> <ff>",
    "endcodespacerange",
    ...chunks,
    "endcmap",
    "CMapName currentdict /CMap defineresource pop",
    "end",
    "end",
  ].join("\n");
}

/**
 * Serialize pages into a PDF file.
 * Throws if any page contains characters WinAnsi cannot represent — callers
 * should check `ContentStream.unsupportedCharacters()` first and produce a
 * useful message instead of letting this fire.
 */
export function buildPdf(opts: {
  pages: PdfPage[];
  fonts: PdfFontSpec[];
  metadata: PdfMetadata;
}): Uint8Array {
  const { pages, fonts, metadata } = opts;
  if (pages.length === 0) throw new Error("Refusing to write a PDF with no pages.");

  /** Object bodies, 1-indexed by position (index 0 is the free object). */
  const objects: string[] = [];
  const reserve = (): number => {
    objects.push("");
    return objects.length; // object numbers are 1-based
  };
  const put = (number: number, body: string): void => {
    objects[number - 1] = body;
  };

  const catalogNo = reserve();
  const pagesNo = reserve();
  const toUnicodeNo = reserve();
  const fontNos = fonts.map(() => reserve());
  const widthsNos = fonts.map(() => reserve());
  const pageNos = pages.map(() => reserve());
  const contentNos = pages.map(() => reserve());
  const infoNo = reserve();

  // ---- fonts ---------------------------------------------------------------
  const cmap = toUnicodeCMap();
  put(
    toUnicodeNo,
    `<< /Length ${latin1Bytes(cmap).length} >>\nstream\n${cmap}\nendstream`
  );

  fonts.forEach((font, i) => {
    put(widthsNos[i], `[ ${widthsArray(font.base).map((w) => String(w)).join(" ")} ]`);
    put(
      fontNos[i],
      `<< /Type /Font /Subtype /Type1 /BaseFont /${font.base} ` +
        `/Encoding /WinAnsiEncoding /FirstChar 32 /LastChar 255 ` +
        `/Widths ${widthsNos[i]} 0 R /ToUnicode ${toUnicodeNo} 0 R >>`
    );
  });

  const fontResources = fonts
    .map((font, i) => `/${font.ref} ${fontNos[i]} 0 R`)
    .join(" ");

  // ---- pages ---------------------------------------------------------------
  pages.forEach((page, i) => {
    const unsupported = page.content.unsupportedCharacters();
    if (unsupported.length > 0) {
      throw new Error(
        `This invoice contains characters the PDF font cannot draw: ${unsupported.join(" ")}`
      );
    }
    const body = page.content.build();
    put(contentNos[i], `<< /Length ${latin1Bytes(body).length} >>\nstream\n${body}\nendstream`);
    put(
      pageNos[i],
      `<< /Type /Page /Parent ${pagesNo} 0 R ` +
        `/MediaBox [0 0 ${num(page.width)} ${num(page.height)}] ` +
        `/Resources << /Font << ${fontResources} >> /ProcSet [/PDF /Text] >> ` +
        `/Contents ${contentNos[i]} 0 R >>`
    );
  });

  put(
    pagesNo,
    `<< /Type /Pages /Count ${pages.length} /Kids [ ${pageNos
      .map((n) => `${n} 0 R`)
      .join(" ")} ] >>`
  );
  put(catalogNo, `<< /Type /Catalog /Pages ${pagesNo} 0 R >>`);

  put(
    infoNo,
    `<< /Title ${textString(metadata.title)} /Author ${textString(metadata.author)} ` +
      `/Creator ${textString(metadata.creator)} /Producer ${textString(metadata.creator)} ` +
      `/CreationDate (${pdfDate(metadata.created)}) >>`
  );

  // ---- serialize -----------------------------------------------------------
  const chunks: Uint8Array[] = [];
  let offset = 0;
  const push = (bytes: Uint8Array): void => {
    chunks.push(bytes);
    offset += bytes.length;
  };
  const pushText = (text: string): void => push(latin1Bytes(text));

  pushText("%PDF-1.4\n");
  // A comment line of high bytes, so tools that sniff text-vs-binary treat the
  // file as binary and do not "helpfully" translate line endings in transit.
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

  const offsets = new Array<number>(objects.length).fill(0);
  objects.forEach((body, i) => {
    const number = i + 1;
    offsets[i] = offset;
    pushText(`${number} 0 obj\n${body}\nendobj\n`);
  });

  const xrefOffset = offset;
  const xrefLines = [`xref\n0 ${objects.length + 1}\n`, "0000000000 65535 f\r\n"];
  for (const objOffset of offsets) {
    xrefLines.push(`${String(objOffset).padStart(10, "0")} 00000 n\r\n`);
  }
  pushText(xrefLines.join(""));

  pushText(
    `trailer\n<< /Size ${objects.length + 1} /Root ${catalogNo} 0 R /Info ${infoNo} 0 R >>\n` +
      `startxref\n${xrefOffset}\n%%EOF\n`
  );

  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const chunk of chunks) {
    out.set(chunk, cursor);
    cursor += chunk.length;
  }
  return out;
}
