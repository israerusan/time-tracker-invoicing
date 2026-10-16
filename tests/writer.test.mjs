/**
 * `InvoiceWriter` against a fake vault.
 *
 * This is the transaction boundary the reviewers kept pointing at: two file
 * writes, a folder that may or may not exist, and paths a user can collide
 * with. None of it had ever executed. The fake is not Obsidian, but it runs
 * the real code against the failures that actually happen on disk.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { entry, loadCore, loadGlue } from "./harness.mjs";
import { fakeApp } from "./fakeVault.mjs";

const core = await loadCore();
const { InvoiceWriter } = await loadGlue();

const SETTINGS = {
  ...core.DEFAULT_SETTINGS,
  currency: "EUR",
  invoiceFolder: "Invoices",
  businessName: "Example Consulting",
  businessAddress: "12 Example Street",
  businessEmail: "billing@example.com",
};

function makeDoc(number = "2026-0001", client = "Acme GmbH") {
  const rows = [entry("a", client, "Phase One", "2026-10-01T09:00:00", "2026-10-01T12:30:00")];
  const draft = core.buildDraft({
    entries: rows, invoices: [], client, period: null,
    rateMinor: 12500, roundHoursTo: 0.25, legacyUnknownBefore: null,
  });
  return core.draftToDocument(draft, {
    number, client, issuedAt: new Date("2026-10-15T12:00:00").getTime(),
    period: null, settings: SETTINGS,
  });
}

const WRITE_OPTS = {
  exportPdf: true,
  pageSize: "A4",
  createdAt: new Date("2026-10-15T12:00:00"),
  creator: "test",
};

test("writer: writes the markdown and the PDF, creating the folder", async () => {
  const { app, vault } = fakeApp();
  const writer = new InvoiceWriter(app, SETTINGS);
  const result = await writer.write(makeDoc(), WRITE_OPTS);

  assert.equal(result.markdownPath, "Invoices/Invoice 2026-0001 - Acme GmbH.md");
  assert.equal(result.pdfPath, "Invoices/Invoice 2026-0001 - Acme GmbH.pdf");
  assert.equal(result.pdfError, null);
  assert.ok(vault.getAbstractFileByPath("Invoices"), "the folder was created");

  const md = vault.contents.get(result.markdownPath);
  assert.ok(md.includes("# Invoice 2026-0001"));
  const pdf = vault.contents.get(result.pdfPath);
  assert.ok(pdf instanceof Uint8Array && pdf.length > 1000, "the PDF has real bytes");
  assert.equal(String.fromCharCode(...pdf.slice(0, 8)), "%PDF-1.4");
});

test("writer: nested invoice folders are created a level at a time", async () => {
  const { app, vault } = fakeApp();
  const writer = new InvoiceWriter(app, { ...SETTINGS, invoiceFolder: "Clients/2026/Invoices" });
  const result = await writer.write(makeDoc(), WRITE_OPTS);
  for (const path of ["Clients", "Clients/2026", "Clients/2026/Invoices"]) {
    assert.ok(vault.getAbstractFileByPath(path), `${path} exists`);
  }
  assert.ok(result.markdownPath.startsWith("Clients/2026/Invoices/"));
});

test("writer: an existing invoice is never overwritten", async () => {
  const { app, vault } = fakeApp();
  vault.seedFolder("Invoices");
  vault.seedFile("Invoices/Invoice 2026-0001 - Acme GmbH.md", "ALREADY SENT");

  const writer = new InvoiceWriter(app, SETTINGS);
  await assert.rejects(() => writer.write(makeDoc(), WRITE_OPTS), /already exists/);
  assert.equal(
    vault.contents.get("Invoices/Invoice 2026-0001 - Acme GmbH.md"),
    "ALREADY SENT",
    "the sent invoice is untouched"
  );
});

test("writer: nextNumber skips numbers taken by a record or by a file", async () => {
  const { app, vault } = fakeApp();
  vault.seedFolder("Invoices");
  vault.seedFile("Invoices/Invoice 2026-0002 - Acme GmbH.md", "");

  const writer = new InvoiceWriter(app, SETTINGS);
  const existing = [
    { number: "2026-0001", voided: false },
    { number: "2026-0003", voided: true },
  ];
  // 0001 is recorded, 0002 is on disk, 0003 is voided but still reserved.
  const { number } = writer.nextNumber(
    new Date("2026-10-15T12:00:00").getTime(),
    existing,
    "Acme GmbH"
  );
  assert.equal(number, "2026-0004");
});

test("writer: a failed PDF leaves the markdown invoice intact and reports why", async () => {
  const { app, vault } = fakeApp();
  const writer = new InvoiceWriter(app, SETTINGS);
  vault.failOn("Invoices/Invoice 2026-0001 - Acme GmbH.pdf", "disk full");

  const result = await writer.write(makeDoc(), WRITE_OPTS);
  assert.ok(vault.getAbstractFileByPath(result.markdownPath), "the invoice exists");
  assert.equal(result.pdfPath, null);
  assert.match(result.pdfError, /disk full/);
});

test("writer: a client name the PDF font cannot draw still produces the markdown", async () => {
  const { app, vault } = fakeApp();
  const writer = new InvoiceWriter(app, SETTINGS);
  const result = await writer.write(makeDoc("2026-0001", "株式会社アオイ"), WRITE_OPTS);

  assert.ok(vault.getAbstractFileByPath(result.markdownPath));
  assert.equal(result.pdfPath, null);
  assert.match(result.pdfError, /cannot draw some characters/);
  assert.ok(
    vault.contents.get(result.markdownPath).includes("株式会社アオイ"),
    "the markdown carries the name correctly"
  );
});

test("writer: a failure to create the folder is reported, not swallowed", async () => {
  const { app, vault } = fakeApp();
  vault.failOn("Invoices", "permission denied");
  const writer = new InvoiceWriter(app, SETTINGS);
  await assert.rejects(() => writer.write(makeDoc(), WRITE_OPTS), /permission denied/);
});

test("writer: a concurrent folder creation is not mistaken for a failure", async () => {
  const { app, vault } = fakeApp();
  // createFolder throws because something else created it first — the
  // outcome we wanted. The write must proceed.
  const original = vault.createFolder.bind(vault);
  vault.createFolder = async (path) => {
    vault.seedFolder(path);
    throw new Error("Folder already exists");
  };
  const writer = new InvoiceWriter(app, SETTINGS);
  const result = await writer.write(makeDoc(), WRITE_OPTS);
  assert.ok(vault.getAbstractFileByPath(result.markdownPath));
  vault.createFolder = original;
});

test("writer: an invoice folder that is actually a file is refused", async () => {
  const { app, vault } = fakeApp();
  vault.seedFile("Invoices", "not a folder");
  const writer = new InvoiceWriter(app, SETTINGS);
  await assert.rejects(() => writer.write(makeDoc(), WRITE_OPTS), /is a file/);
});

test("writer: a client name with a slash cannot escape the invoice folder", async () => {
  const { app, vault } = fakeApp();
  const writer = new InvoiceWriter(app, SETTINGS);
  const result = await writer.write(makeDoc("2026-0001", "../../Secrets/North"), WRITE_OPTS);
  assert.ok(
    result.markdownPath.startsWith("Invoices/"),
    `wrote to ${result.markdownPath}, outside the invoice folder`
  );
  assert.ok(!result.markdownPath.includes(".."), "no traversal survives");
  assert.ok(vault.getAbstractFileByPath(result.markdownPath));
});

test("writer: plannedPaths predicts exactly where write() will put the files", async () => {
  const { app } = fakeApp();
  const writer = new InvoiceWriter(app, SETTINGS);
  // The pending-issuance marker is written at these paths before anything is
  // created, and reconciliation looks for them afterwards. If they disagree,
  // an interrupted issuance is reconciled the wrong way.
  const planned = writer.plannedPaths("2026-0001", "Acme GmbH");
  const result = await writer.write(makeDoc(), WRITE_OPTS);
  assert.equal(planned.markdownPath, result.markdownPath);
  assert.equal(planned.pdfPath, result.pdfPath);
});

test("writer: with PDF export off, only the markdown is written", async () => {
  const { app, vault } = fakeApp();
  const writer = new InvoiceWriter(app, SETTINGS);
  const result = await writer.write(makeDoc(), { ...WRITE_OPTS, exportPdf: false });
  assert.equal(result.pdfPath, null);
  assert.equal(result.pdfError, null);
  assert.equal(vault.createdOrder.length, 1);
});

test("writer: a create that commits and then rejects still leaves the file behind", async () => {
  const { app, vault } = fakeApp();
  const writer = new InvoiceWriter(app, SETTINGS);
  const planned = writer.plannedPaths("2026-0001", "Acme GmbH");
  vault.commitThenFailOn(planned.markdownPath);

  await assert.rejects(() => writer.write(makeDoc(), WRITE_OPTS));
  // This is the state the caller cannot infer from the error. The plugin must
  // ask the vault rather than assume the rejection means nothing was written,
  // which is what `resolvePendingIssue` is for.
  assert.ok(
    vault.getAbstractFileByPath(planned.markdownPath),
    "the invoice is on disk despite the rejection"
  );
});
