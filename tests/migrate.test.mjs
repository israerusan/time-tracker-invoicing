/**
 * Migration of the persisted ledger.
 *
 * The file under test is somebody's record of billable work. Every assertion
 * here is about not losing it, not silently changing it, and not inventing
 * facts about it.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { loadCore } from "./harness.mjs";

const core = await loadCore();
const NOW = new Date("2026-10-15T12:00:00").getTime();
const ENTRY_START = new Date("2026-09-01T09:00:00").getTime();

function v1File() {
  return {
    settings: { defaultHourlyRate: 120, currency: "EUR", invoiceFolder: "Billing" },
    entries: [
      {
        id: "te_0_1",
        filePath: "Work.md",
        fileName: "Work",
        client: "Acme",
        project: "Build",
        start: ENTRY_START,
        end: new Date("2026-09-01T11:00:00").getTime(),
      },
    ],
    activeTimer: null,
  };
}

test("migrate: a pre-2.0 file keeps its entries and settings", () => {
  const { migrate, CURRENT_SCHEMA } = core;
  const { data, report } = migrate(v1File(), NOW);

  assert.equal(report.fromSchema, 1);
  assert.equal(data.schemaVersion, CURRENT_SCHEMA);
  assert.equal(data.entries.length, 1);
  assert.equal(data.settings.defaultHourlyRate, 120);
  assert.equal(data.settings.currency, "EUR");
  assert.equal(data.settings.invoiceFolder, "Billing");
  assert.equal(data.settings.exportPdf, true, "new settings take their default");
});

test("migrate: pre-2.0 entries are marked unknown, never assumed unbilled", () => {
  const { migrate, buildDraft } = core;
  const { data, report } = migrate(v1File(), NOW);

  assert.equal(data.legacyUnknownBefore, NOW);
  assert.ok(report.notes.some((n) => n.includes("billing status is unknown")));

  const draft = buildDraft({
    entries: data.entries,
    invoices: [],
    client: "Acme",
    period: null,
    rateMinor: 10000,
    roundHoursTo: 0.25,
    legacyUnknownBefore: data.legacyUnknownBefore,
  });
  assert.equal(draft.legacyUnknownCount, 1, "the user is warned before these are billed again");
});

test("migrate: an empty pre-2.0 file raises no legacy warning", () => {
  const { migrate } = core;
  const { data, report } = migrate({ settings: {}, entries: [], activeTimer: null }, NOW);
  assert.equal(data.legacyUnknownBefore, null);
  assert.equal(report.notes.length, 0);
});

test("migrate: duplicate and missing entry ids are replaced, and reported", () => {
  const { migrate } = core;
  const base = v1File();
  base.entries.push({ ...base.entries[0] }); // same id
  base.entries.push({ ...base.entries[0], id: undefined });

  const { data, report } = migrate(base, NOW);
  const ids = data.entries.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length, "every id is now unique");
  assert.equal(report.reassignedIds.length, 2);
  assert.ok(report.notes.some((n) => n.includes("duplicated identifier")));
});

test("migrate: unreadable records are quarantined, not discarded", () => {
  const { migrate } = core;
  const base = v1File();
  base.entries.push({ id: "bad", client: "Acme", project: "X", start: "not a number" });
  base.entries.push({ id: "backwards", client: "A", project: "X", start: 2000, end: 1000 });
  base.entries.push(null);

  const { data, report } = migrate(base, NOW);
  assert.equal(data.entries.length, 1, "only the valid entry is kept in the ledger");
  assert.equal(report.quarantined, 3);
  assert.equal(data.quarantined.length, 3, "the originals are preserved verbatim");
  assert.ok(report.notes.some((n) => n.includes("set aside")));
});

test("migrate: a newer schema opens read-only instead of being downgraded", () => {
  const { migrate, CURRENT_SCHEMA } = core;
  const future = { ...v1File(), schemaVersion: CURRENT_SCHEMA + 5, somethingNew: [1, 2] };
  const { data, report } = migrate(future, NOW);

  assert.equal(report.readOnly, true);
  assert.equal(data.schemaVersion, CURRENT_SCHEMA + 5, "the declared version is not rewritten");
  assert.ok(report.notes.some((n) => n.includes("read-only")));
});

test("migrate: unknown fields on an entry survive the round trip", () => {
  const { migrate } = core;
  const base = v1File();
  base.entries[0].futureField = { kept: true };

  const { data } = migrate(base, NOW);
  assert.deepEqual(data.entries[0].futureField, { kept: true });
});

test("migrate: the input object is never mutated", () => {
  const { migrate } = core;
  const base = v1File();
  const snapshot = JSON.stringify(base);
  migrate(base, NOW);
  assert.equal(JSON.stringify(base), snapshot);
});

test("migrate: an invoice with a malformed allocation is quarantined whole", () => {
  const { migrate } = core;
  const base = {
    ...v1File(),
    schemaVersion: 2,
    invoices: [
      {
        id: "i1",
        number: "2026-0001",
        client: "Acme",
        issuedAt: NOW,
        totalMinor: 1000,
        totalSeconds: 3600,
        allocations: [{ entryId: "te_0_1", from: ENTRY_START, to: ENTRY_START + 3600_000 }],
      },
      {
        id: "i2",
        number: "2026-0002",
        client: "Acme",
        issuedAt: NOW,
        totalMinor: 1000,
        totalSeconds: 3600,
        allocations: [{ entryId: "te_0_1", from: ENTRY_START }], // no end — cannot be trusted
      },
    ],
  };
  const { data, report } = migrate(base, NOW);
  assert.equal(data.invoices.length, 1, "the sound invoice is kept");
  assert.equal(report.quarantined, 1, "the unsound one is set aside rather than half-read");
});

test("migrate: a non-array entry list is quarantined rather than throwing", () => {
  const { migrate } = core;
  const { data, report } = migrate({ entries: "corrupt", settings: {} }, NOW);
  assert.equal(data.entries.length, 0);
  assert.equal(report.quarantined, 1);
});

test("migrate: garbage input yields a usable empty ledger", () => {
  const { migrate, CURRENT_SCHEMA } = core;
  for (const input of [null, undefined, 42, "nope", []]) {
    const { data } = migrate(input, NOW);
    assert.equal(data.schemaVersion, CURRENT_SCHEMA);
    assert.ok(Array.isArray(data.entries));
    assert.ok(Array.isArray(data.invoices));
  }
});

test("ids: generated identifiers do not collide", () => {
  const { newEntryId } = core;
  const seen = new Set();
  for (let i = 0; i < 20000; i++) seen.add(newEntryId());
  assert.equal(seen.size, 20000);
});

test("migrate: an allocation outside its entry's span quarantines the invoice", () => {
  const { migrate } = core;
  const base = v1File();
  const e = base.entries[0];
  base.schemaVersion = 2;
  base.invoices = [
    {
      id: "good", number: "2026-0001", client: "Acme", issuedAt: NOW,
      totalMinor: 1000, totalSeconds: 3600,
      allocations: [{ entryId: e.id, from: e.start, to: e.start + 3600_000 }],
    },
    {
      id: "impossible", number: "2026-0002", client: "Acme", issuedAt: NOW,
      totalMinor: 1000, totalSeconds: 100000,
      // Claims to have billed far more time than the entry ever contained,
      // which would leave that entry permanently over-allocated.
      allocations: [{ entryId: e.id, from: e.start, to: e.start + 100_000_000 }],
    },
  ];
  const { data, report } = migrate(base, NOW);
  assert.equal(data.invoices.length, 1);
  assert.equal(data.invoices[0].id, "good");
  assert.equal(report.quarantined, 1);
});

test("migrate: an allocation naming an unknown entry quarantines the invoice", () => {
  const { migrate } = core;
  const base = v1File();
  base.schemaVersion = 2;
  base.invoices = [
    {
      id: "orphan", number: "2026-0001", client: "Acme", issuedAt: NOW,
      totalMinor: 1000, totalSeconds: 3600,
      allocations: [{ entryId: "te_does_not_exist", from: 1, to: 2 }],
    },
  ];
  const { data, report } = migrate(base, NOW);
  assert.equal(data.invoices.length, 0);
  assert.equal(report.quarantined, 1);
});

test("migrate: an invoice with no allocation list is quarantined, not read as billing nothing", () => {
  const { migrate } = core;
  // This is the regression that mattered most: reading a missing or corrupt
  // allocation list as "[]" returns already-invoiced hours to the billable
  // pool, and the client gets charged for them a second time.
  for (const allocations of [undefined, null, "corrupt", 42, {}, []]) {
    const base = v1File();
    base.schemaVersion = 2;
    base.invoices = [
      {
        id: "i1", number: "2026-0001", client: "Acme", issuedAt: NOW,
        totalMinor: 1000, totalSeconds: 3600,
        ...(allocations === undefined ? {} : { allocations }),
      },
    ];
    const { data, report } = migrate(base, NOW);
    assert.equal(data.invoices.length, 0, `allocations=${JSON.stringify(allocations)} must not be kept`);
    assert.equal(report.quarantined, 1);
    assert.equal(data.quarantined.length, 1, "the original is preserved verbatim");
  }
});

test("migrate: a duplicate human-facing invoice number is quarantined", () => {
  const { migrate } = core;
  const base = v1File();
  const e = base.entries[0];
  base.schemaVersion = 2;
  const alloc = [{ entryId: e.id, from: e.start, to: e.start + 3600_000 }];
  base.invoices = [
    { id: "a", number: "2026-0001", client: "Acme", issuedAt: NOW, totalMinor: 1, totalSeconds: 1, allocations: alloc },
    { id: "b", number: "2026-0001", client: "Acme", issuedAt: NOW, totalMinor: 1, totalSeconds: 1, allocations: alloc },
  ];
  const { data, report } = migrate(base, NOW);
  assert.equal(data.invoices.length, 1);
  assert.equal(data.invoices[0].id, "a", "the first record keeps the number");
  assert.equal(report.quarantined, 1);
});

test("migrate: a pending issuance round-trips, and an impossible one is quarantined", () => {
  const { migrate } = core;
  const base = v1File();
  const e = base.entries[0];
  base.schemaVersion = 2;
  base.pendingIssue = {
    id: "p1", number: "2026-0007", client: "Acme", issuedAt: NOW,
    totalMinor: 1000, totalSeconds: 3600,
    markdownPath: "Invoices/Invoice 2026-0007 - Acme.md",
    allocations: [{ entryId: e.id, from: e.start, to: e.start + 3600_000 }],
  };
  const kept = migrate(base, NOW);
  assert.equal(kept.data.pendingIssue?.number, "2026-0007");
  assert.equal(kept.data.pendingIssue?.markdownPath, "Invoices/Invoice 2026-0007 - Acme.md");

  base.pendingIssue.allocations = [{ entryId: "te_nope", from: 1, to: 2 }];
  const dropped = migrate(base, NOW);
  assert.equal(dropped.data.pendingIssue, null);
  assert.equal(dropped.report.quarantined, 1);
});

test("migrate: a pending issuance does not count as billed until it is finalised", () => {
  const { migrate, buildDraft } = core;
  const base = v1File();
  const e = base.entries[0];
  base.schemaVersion = 2;
  base.pendingIssue = {
    id: "p1", number: "2026-0007", client: "Acme", issuedAt: NOW,
    totalMinor: 1000, totalSeconds: 3600, markdownPath: "Invoices/x.md",
    allocations: [{ entryId: e.id, from: e.start, to: e.end }],
  };
  const { data } = migrate(base, NOW);
  const draft = buildDraft({
    entries: data.entries, invoices: data.invoices, client: "Acme", period: null,
    rateMinor: 10000, roundHoursTo: 0.25, legacyUnknownBefore: null,
  });
  assert.equal(draft.totalSeconds, 2 * 3600, "the hours stay billable while the issuance is unresolved");
});
