/**
 * Resolving an interrupted issuance.
 *
 * These branches are only reachable by crashing at an exact moment, so the
 * decision is a pure function and every crash point is enumerated here.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { loadCore } from "./harness.mjs";

const core = await loadCore();

const MD = "Invoices/Invoice 2026-0007 - Acme.md";
const PDF = "Invoices/Invoice 2026-0007 - Acme.pdf";

function pending(overrides = {}) {
  return {
    id: "p1",
    number: "2026-0007",
    client: "Acme",
    issuedAt: Date.now(),
    periodFrom: null,
    periodTo: null,
    currency: "EUR",
    rateMinor: 12500,
    roundHoursTo: 0.25,
    allocations: [{ entryId: "te_1", from: 1000, to: 5000 }],
    totalSeconds: 4,
    totalMinor: 14,
    markdownPath: MD,
    pdfPath: null,
    voided: false,
    ...overrides,
  };
}

const existing = (...paths) => (path) => paths.includes(path);

test("reconcile: crash before any file was written — discard, hours stay billable", () => {
  const out = core.resolvePendingIssue(pending(), existing(), PDF);
  assert.equal(out.action, "discard");
  assert.equal(out.record, null);
  assert.match(out.message, /still available to invoice/);
});

test("reconcile: crash after the markdown but before the PDF — record it, without a PDF path", () => {
  const out = core.resolvePendingIssue(pending(), existing(MD), PDF);
  assert.equal(out.action, "record");
  assert.equal(out.record.markdownPath, MD);
  assert.equal(out.record.pdfPath, null, "no PDF path is claimed for a file that is not there");
  assert.match(out.message, /will not be billed again/);
});

test("reconcile: crash after both files — record it, and keep the PDF path", () => {
  const out = core.resolvePendingIssue(pending(), existing(MD, PDF), PDF);
  assert.equal(out.action, "record");
  assert.equal(out.record.pdfPath, PDF, "the PDF is not lost just because the record was never finalised");
});

test("reconcile: the allocations survive intact, so the hours cannot be billed twice", () => {
  const p = pending();
  const out = core.resolvePendingIssue(p, existing(MD), PDF);
  assert.deepEqual(out.record.allocations, p.allocations);
  assert.equal(out.record.totalMinor, p.totalMinor);
  assert.equal(out.record.number, p.number, "and it keeps the number it was issued under");
});

test("reconcile: with PDF export off, no PDF path is invented", () => {
  const out = core.resolvePendingIssue(pending(), existing(MD), null);
  assert.equal(out.action, "record");
  assert.equal(out.record.pdfPath, null);
});

test("reconcile: a pending record with no planned markdown path is discarded", () => {
  const out = core.resolvePendingIssue(pending({ markdownPath: null }), existing(MD), PDF);
  assert.equal(out.action, "discard");
});

test("reconcile: the vault is believed over the error — a committed write is recorded", () => {
  // The case that matters: `vault.create` reached storage and then threw. The
  // caller sees only a rejection; the file is there and may already have been
  // sent. Trusting the error would return its hours to the billable pool.
  const out = core.resolvePendingIssue(pending(), existing(MD), PDF);
  assert.equal(out.action, "record");
});

test("reconcile: a decision never mutates the pending record it was given", () => {
  const p = pending();
  const snapshot = JSON.stringify(p);
  core.resolvePendingIssue(p, existing(MD, PDF), PDF);
  assert.equal(JSON.stringify(p), snapshot);
});
