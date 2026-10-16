/**
 * Structural validation of the generated PDF.
 *
 * Golden bytes would not help here: a generator can deterministically produce
 * a file that no viewer will open. So these tests re-derive the things a
 * parser checks — that every xref offset really lands on its object header,
 * that `startxref` really points at the `xref` keyword, that each stream's
 * declared `/Length` really is its byte count — from the bytes themselves.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { entry, loadCore } from "./harness.mjs";

const core = await loadCore();

const SETTINGS_BASE = { rateMinor: 10000, roundHoursTo: 0.25, legacyUnknownBefore: null };

function makeDoc(overrides = {}, entries = null) {
  const { buildDraft, draftToDocument, DEFAULT_SETTINGS } = core;
  const rows =
    entries ??
    [entry("a", "Acme GmbH", "Phase One", "2026-10-01T09:00:00", "2026-10-01T12:30:00")];
  const client = overrides.client ?? "Acme GmbH";
  const draft = buildDraft({ entries: rows, invoices: [], client, period: null, ...SETTINGS_BASE });
  return draftToDocument(draft, {
    number: overrides.number ?? "2026-0001",
    client,
    issuedAt: new Date("2026-10-15T12:00:00").getTime(),
    period: null,
    settings: {
      ...DEFAULT_SETTINGS,
      businessName: "Example Consulting",
      businessAddress: "12 Example Street\nLondon",
      businessEmail: "billing@example.com",
      ...overrides.settings,
    },
  });
}

function render(doc, pageSize = "A4") {
  return core.renderInvoicePdf(doc, {
    pageSize,
    createdAt: new Date("2026-10-15T12:00:00Z"),
    creator: "Time Tracker and Invoicing test",
  });
}

/** Decode as latin1 so byte offsets and string indices are the same number. */
function latin1(bytes) {
  let out = "";
  for (const b of bytes) out += String.fromCharCode(b);
  return out;
}

test("pdf: the file has a header, a binary marker and an EOF", () => {
  const bytes = render(makeDoc());
  const text = latin1(bytes);
  assert.ok(text.startsWith("%PDF-1.4\n"), "version header");
  // Second line must contain high bytes so the file is treated as binary.
  assert.ok(bytes[9] === 0x25 && bytes[10] > 0x7f, "binary comment line");
  assert.ok(text.trimEnd().endsWith("%%EOF"), "EOF marker");
});

test("pdf: every cross-reference offset lands exactly on its object header", () => {
  const bytes = render(makeDoc());
  const text = latin1(bytes);

  const startxrefIndex = text.lastIndexOf("startxref");
  assert.ok(startxrefIndex > 0, "startxref present");
  const declaredXref = Number(text.slice(startxrefIndex + "startxref".length).trim().split(/\s/)[0]);
  assert.equal(text.slice(declaredXref, declaredXref + 4), "xref", "startxref points at the xref keyword");

  const header = /xref\n0 (\d+)\n/.exec(text.slice(declaredXref));
  assert.ok(header, "xref subsection header");
  const size = Number(header[1]);

  const tableStart = declaredXref + header[0].length;
  // The free head entry, then one 20-byte entry per object.
  assert.equal(text.slice(tableStart, tableStart + 20), "0000000000 65535 f\r\n", "free object 0");

  for (let i = 1; i < size; i++) {
    const row = text.slice(tableStart + i * 20, tableStart + (i + 1) * 20);
    assert.match(row, /^\d{10} 00000 n\r\n$/, `entry ${i} is exactly 20 bytes and well formed`);
    const offset = Number(row.slice(0, 10));
    assert.equal(
      text.slice(offset, offset + `${i} 0 obj`.length),
      `${i} 0 obj`,
      `offset for object ${i} points at its header`
    );
  }

  const trailer = /\/Size (\d+)/.exec(text.slice(text.lastIndexOf("trailer")));
  assert.equal(Number(trailer[1]), size, "trailer /Size matches the table");
});

test("pdf: every stream's declared length is its real byte count", () => {
  const bytes = render(makeDoc());
  const text = latin1(bytes);

  const pattern = /<< \/Length (\d+)[^>]*>>\nstream\n/g;
  let match;
  let streams = 0;
  while ((match = pattern.exec(text)) !== null) {
    const declared = Number(match[1]);
    const dataStart = match.index + match[0].length;
    assert.equal(
      text.slice(dataStart + declared, dataStart + declared + "\nendstream".length),
      "\nendstream",
      "the declared length ends exactly where endstream begins"
    );
    streams += 1;
  }
  assert.ok(streams >= 2, "at least the ToUnicode map and one content stream");
});

test("pdf: the page tree is internally consistent", () => {
  const bytes = render(makeDoc());
  const text = latin1(bytes);

  const pages = /\/Type \/Pages \/Count (\d+) \/Kids \[ ([^\]]+) \]/.exec(text);
  assert.ok(pages, "pages node present");
  const kids = pages[2].trim().split(/\s+0 R\s*/).filter(Boolean);
  assert.equal(Number(pages[1]), kids.length, "/Count matches the number of kids");

  const pageObjects = text.match(/\/Type \/Page /g) ?? [];
  assert.equal(pageObjects.length, kids.length, "one page object per kid");

  // Every font a page references must exist in its resources.
  assert.ok(text.includes("/F1 "), "F1 declared");
  assert.ok(text.includes("/F2 "), "F2 declared");
  assert.ok(text.includes("/BaseFont /Helvetica "), "regular face");
  assert.ok(text.includes("/BaseFont /Helvetica-Bold "), "bold face");
  assert.ok(text.includes("/ToUnicode "), "text is extractable");
});

test("pdf: literal strings escape the characters that would end them early", () => {
  const { literalString, encodeWinAnsi } = core;
  assert.equal(literalString(encodeWinAnsi("ACME (East)").bytes), "(ACME \\(East\\))");
  assert.equal(literalString(encodeWinAnsi("back\\slash").bytes), "(back\\\\slash)");
  // High bytes become octal escapes so the object body stays ASCII.
  assert.equal(literalString(encodeWinAnsi("Müller").bytes), "(M\\374ller)");
});

test("pdf: a Latin-1 client name renders, and the file stays byte-consistent", () => {
  const doc = makeDoc({ client: "Müller & Söhne GmbH" });
  assert.deepEqual(core.findUnsupported(doc), [], "Latin-1 is inside WinAnsi");
  const bytes = render(doc);
  const text = latin1(bytes);
  assert.ok(text.includes("M\\374ller"), "the umlaut is written as an octal escape");
  // Re-run the offset check on this file too: the escape must not shift offsets.
  const startxrefIndex = text.lastIndexOf("startxref");
  const declared = Number(text.slice(startxrefIndex + 9).trim().split(/\s/)[0]);
  assert.equal(text.slice(declared, declared + 4), "xref");
});

test("pdf: a name outside the font's encoding is refused, by name, not mangled", () => {
  const doc = makeDoc({ client: "株式会社アオイ" });
  const unsupported = core.findUnsupported(doc);
  assert.ok(unsupported.length > 0, "the characters are detected");
  assert.equal(unsupported[0].label, "client name");
  assert.throws(() => render(doc), /cannot draw some characters/);
});

test("pdf: numbers never reach an operand as NaN or in exponential form", () => {
  const { num } = core;
  assert.equal(num(10), "10");
  assert.equal(num(10.5), "10.5");
  assert.equal(num(0.000001), "0");
  assert.equal(num(1e14), "100000000000000", "large but in range stays positional");
  // The old test asserted `num(1e21) === num(1e21)`, which is true of anything.
  // `String(1e21)` is "1e+21", a token no PDF parser accepts, so out-of-range
  // magnitudes are refused rather than written.
  assert.throws(() => num(1e21), /out-of-range/);
  assert.throws(() => num(-1e21), /out-of-range/);
  assert.throws(() => num(NaN), /non-finite/);
  assert.throws(() => num(Infinity), /non-finite/);

  const bytes = render(makeDoc());
  const text = latin1(bytes);
  assert.ok(!/\bNaN\b/.test(text), "no NaN anywhere in the file");
  assert.ok(!/\d[eE][+-]\d/.test(text), "no exponential notation in operands");
});

test("pdf: a long invoice paginates, repeats the table header and carries the total", () => {
  const rows = [];
  for (let i = 0; i < 60; i++) {
    const day = String((i % 27) + 1).padStart(2, "0");
    rows.push(
      entry(
        `e${i}`,
        "Acme GmbH",
        `Project number ${i} with a deliberately long description that must wrap across lines`,
        `2026-10-${day}T09:00:00`,
        `2026-10-${day}T11:00:00`
      )
    );
  }
  const doc = makeDoc({}, rows);
  assert.equal(doc.lines.length, 60);

  const text = latin1(render(doc));
  const pageCount = (text.match(/\/Type \/Page /g) ?? []).length;
  assert.ok(pageCount > 1, `expected more than one page, got ${pageCount}`);
  assert.ok(text.includes("DESCRIPTION \\(CONTINUED\\)"), "the table header repeats");
  assert.ok(text.includes("Carried forward"), "the running total is carried");
  assert.ok(text.includes("Brought forward"), "and brought onto the next page");
  assert.ok(text.includes("Page 1 of "), "pages are numbered");
});

test("pdf: Letter and A4 produce different media boxes", () => {
  const doc = makeDoc();
  const a4 = latin1(render(doc, "A4"));
  const letter = latin1(render(doc, "Letter"));
  assert.ok(a4.includes("/MediaBox [0 0 595.28 841.89]"));
  assert.ok(letter.includes("/MediaBox [0 0 612 792]"));
});

test("pdf: word wrapping never produces a line wider than its column", () => {
  const { wrapText, measureBytes, encodeWinAnsi } = core;
  const width = 120;
  const lines = wrapText(
    "Helvetica",
    9.5,
    width,
    "Supercalifragilisticexpialidocious retainer work for the month including review"
  );
  for (const line of lines) {
    assert.ok(
      measureBytes("Helvetica", encodeWinAnsi(line).bytes, 9.5) <= width + 0.01,
      `"${line}" fits the column`
    );
  }
});

test("pdf: the creation date uses PDF date syntax", () => {
  const { pdfDate } = core;
  assert.match(pdfDate(new Date("2026-10-15T12:00:00Z")), /^D:\d{14}(Z|[+-]\d{2}'\d{2}')$/);
});

test("pdf: metadata is UTF-16BE, so it is not misdecoded as PDFDocEncoding", () => {
  const { textString } = core;
  // An em dash is 0x97 in WinAnsi but a different character in PDFDocEncoding,
  // which is how it used to come back out of the title.
  assert.equal(textString("A—B"), "<FEFF004120140042>");
  assert.equal(textString(""), "<FEFF>");

  const text = latin1(render(makeDoc({ client: "Müller & Söhne GmbH" })));
  const title = /\/Title <([0-9A-F]+)>/.exec(text);
  assert.ok(title, "title is a hex string");
  assert.ok(title[1].startsWith("FEFF"), "with a byte-order mark");
  const decoded = title[1]
    .slice(4)
    .match(/.{4}/g)
    .map((h) => String.fromCharCode(parseInt(h, 16)))
    .join("");
  assert.equal(decoded, "Invoice 2026-0001 — Müller & Söhne GmbH", "round-trips exactly");
});

/** Every text-drawing op in a rendered PDF, with its position and width. */
function drawnText(bytes) {
  const { measureBytes, encodeWinAnsi } = core;
  const text = latin1(bytes);
  const out = [];
  const re = /BT \/(F\d) ([\d.]+) Tf 1 0 0 1 ([-\d.]+) ([-\d.]+) Tm \((.*?)\) Tj ET/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const [, font, size, x, y, raw] = m;
    // Undo the literal-string escapes to recover the drawn bytes.
    const bytesOut = [];
    for (let i = 0; i < raw.length; i++) {
      if (raw[i] !== "\\") {
        bytesOut.push(raw.charCodeAt(i));
      } else if (/[0-7]/.test(raw[i + 1])) {
        bytesOut.push(parseInt(raw.slice(i + 1, i + 4), 8));
        i += 3;
      } else {
        bytesOut.push(raw.charCodeAt(i + 1));
        i += 1;
      }
    }
    const face = font === "F2" ? "Helvetica-Bold" : "Helvetica";
    out.push({
      x: Number(x),
      y: Number(y),
      width: measureBytes(face, bytesOut, Number(size)),
      value: bytesOut.map((b) => String.fromCharCode(b)).join(""),
    });
    void encodeWinAnsi;
  }
  return out;
}

test("pdf: nothing drawn ever crosses the right page margin", () => {
  const doc = makeDoc({
    client: "Müller & Söhne Beteiligungsgesellschaft mbH & Co. Kommanditgesellschaft",
    settings: {
      businessName: "Example Consulting and Advisory Services Limited Partnership",
      businessAddress: "Unit 4, The Exceptionally Long Business Park Name, Somewhere",
      businessEmail: "accounts.receivable.department@example-consulting-partners.com",
      paymentTerms:
        "Payment due within 14 days by bank transfer to the account named on this invoice; " +
        "please quote the invoice number shown above with your remittance advice.",
    },
  });
  const CONTENT_RIGHT = 595.28 - 56;
  for (const run of drawnText(render(doc))) {
    assert.ok(
      run.x + run.width <= CONTENT_RIGHT + 0.5,
      `"${run.value}" ends at ${(run.x + run.width).toFixed(1)}, past the ${CONTENT_RIGHT} margin`
    );
  }
});

test("pdf: a long business name wraps instead of running under BILL TO", () => {
  const doc = makeDoc({
    settings: { businessName: "Example Consulting and Advisory Services Limited Partnership" },
  });
  const runs = drawnText(render(doc));
  // The "BILL TO" column starts here; the sender block must stop short of it.
  const billToX = runs.find((r) => r.value === "BILL TO")?.x;
  assert.ok(billToX !== undefined, "the BILL TO label is drawn");

  const senderRuns = runs.filter((r) => r.x === 56 && r.y > 600);
  const nameRuns = senderRuns.filter((r) => r.value.includes("Example") || r.value.includes("Partnership"));
  assert.ok(nameRuns.length > 1, "the long name was split across lines");
  for (const run of senderRuns) {
    assert.ok(
      run.x + run.width < billToX,
      `sender line "${run.value}" reaches ${(run.x + run.width).toFixed(1)}, into the BILL TO column at ${billToX}`
    );
  }
});
