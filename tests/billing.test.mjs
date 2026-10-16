/**
 * The arithmetic a client is asked to pay for.
 *
 * Every case here corresponds to a defect the pre-2.0 code had, or to a way
 * the new code could reintroduce one.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { entry, loadCore } from "./harness.mjs";

const core = await loadCore();

// ---------------------------------------------------------------- money ----

test("money: rounding to a billing increment is half-up", () => {
  const { roundSeconds } = core;
  // 7.5 minutes at a quarter-hour increment is an exact tie -> rounds up.
  assert.equal(roundSeconds(450, 0.25), 900);
  assert.equal(roundSeconds(449, 0.25), 0);
  assert.equal(roundSeconds(3600, 0.25), 3600);
  assert.equal(roundSeconds(3601, 0.25), 3600);
  // No rounding configured: seconds survive intact.
  assert.equal(roundSeconds(3661, 0), 3661);
  assert.equal(roundSeconds(0, 0.25), 0);
  assert.equal(roundSeconds(-5, 0.25), 0);
});

test("money: a short entry can round away to nothing, and that is detectable", () => {
  const { roundSeconds } = core;
  assert.equal(roundSeconds(120, 0.25), 0, "two minutes at 15-min rounding bills nothing");
});

test("money: amounts are exact integers, with no float drift across many lines", () => {
  const { amountMinor, sumMinor } = core;
  // 0.1h at 10.00/h = 1.00. Twenty of them must be exactly 20.00, which a
  // float accumulation of 0.1*10 would not guarantee.
  const one = amountMinor(360, 1000);
  assert.equal(one, 100);
  assert.equal(sumMinor(new Array(20).fill(one)), 2000);
});

test("money: rate parsing rejects what cannot be billed", () => {
  const { parseRateToMinor } = core;
  assert.equal(parseRateToMinor("87.50", "USD"), 8750);
  assert.equal(parseRateToMinor("87,50", "USD"), 8750, "comma decimal separator is accepted");
  assert.equal(parseRateToMinor(100, "USD"), 10000);
  assert.equal(parseRateToMinor("-1", "USD"), null);
  assert.equal(parseRateToMinor("abc", "USD"), null);
  assert.equal(parseRateToMinor("", "USD"), null);
  assert.equal(parseRateToMinor(Infinity, "USD"), null);
});

test("money: currencies with no minor unit do not grow cents", () => {
  const { parseRateToMinor, formatMoney } = core;
  assert.equal(parseRateToMinor("12000", "JPY"), 12000);
  assert.equal(formatMoney(12000, "JPY"), "JPY 12000");
  assert.equal(formatMoney(12345, "USD"), "USD 123.45");
  assert.equal(formatMoney(5, "USD"), "USD 0.05", "minor units pad, they do not truncate");
  assert.equal(formatMoney(1234, "KWD"), "KWD 1.234", "three-decimal currency");
  assert.equal(formatMoney(1234, "£"), "£ 12.34", "an unrecognised symbol falls back to 2 digits");
});

// --------------------------------------------------------------- period ----

test("period: an entry spanning midnight on the first is split, not misfiled", () => {
  const { overlapMs, monthPeriod } = core;
  const start = new Date(2026, 8, 30, 23, 0, 0).getTime(); // 30 Sep 23:00
  const end = new Date(2026, 9, 1, 1, 0, 0).getTime(); //  1 Oct 01:00
  const september = monthPeriod(new Date(2026, 8, 15).getTime());
  const october = monthPeriod(new Date(2026, 9, 15).getTime());

  assert.equal(overlapMs(start, end, september.from, september.to), 3600_000);
  assert.equal(overlapMs(start, end, october.from, october.to), 3600_000);
  assert.equal(
    overlapMs(start, end, september.from, september.to) +
      overlapMs(start, end, october.from, october.to),
    end - start,
    "the two halves account for the whole entry exactly once"
  );
});

test("period: a null bound means unbounded on that side", () => {
  const { overlapMs } = core;
  assert.equal(overlapMs(100, 200, null, null), 100);
  assert.equal(overlapMs(100, 200, 150, null), 50);
  assert.equal(overlapMs(100, 200, null, 150), 50);
  assert.equal(overlapMs(100, 200, 300, 400), 0);
});

// -------------------------------------------------------- invoice model ----

const SETTINGS_BASE = {
  rateMinor: 10000, // 100.00/hr
  roundHoursTo: 0.25,
  legacyUnknownBefore: null,
};

test("invoice: a second invoice does not re-bill the first invoice's hours", () => {
  const { buildDraft } = core;
  const entries = [
    entry("a", "Acme", "Build", "2026-10-01T09:00:00", "2026-10-01T11:00:00"),
    entry("b", "Acme", "Build", "2026-10-02T09:00:00", "2026-10-02T10:00:00"),
  ];

  const first = buildDraft({ entries, invoices: [], client: "Acme", period: null, ...SETTINGS_BASE });
  assert.equal(first.totalSeconds, 3 * 3600);
  assert.equal(first.totalMinor, 30000);

  const issued = {
    id: "inv1",
    voided: false,
    allocations: first.allocations,
  };

  const second = buildDraft({
    entries,
    invoices: [issued],
    client: "Acme",
    period: null,
    ...SETTINGS_BASE,
  });
  assert.equal(second.lines.length, 0, "nothing is left to bill");
  assert.equal(second.totalMinor, 0);
});

test("invoice: an entry crossing a month boundary bills once in each month, never twice overall", () => {
  const { buildDraft, monthPeriod } = core;
  const entries = [
    entry("x", "Acme", "Build", "2026-09-30T23:00:00", "2026-10-01T01:00:00"),
  ];
  const september = monthPeriod(new Date(2026, 8, 15).getTime());
  const october = monthPeriod(new Date(2026, 9, 15).getTime());

  const sepDraft = buildDraft({
    entries,
    invoices: [],
    client: "Acme",
    period: september,
    ...SETTINGS_BASE,
  });
  assert.equal(sepDraft.totalSeconds, 3600);

  const sepInvoice = { id: "i1", voided: false, allocations: sepDraft.allocations };
  const octDraft = buildDraft({
    entries,
    invoices: [sepInvoice],
    client: "Acme",
    period: october,
    ...SETTINGS_BASE,
  });
  assert.equal(octDraft.totalSeconds, 3600, "October bills its own hour");

  const octInvoice = { id: "i2", voided: false, allocations: octDraft.allocations };
  const leftover = buildDraft({
    entries,
    invoices: [sepInvoice, octInvoice],
    client: "Acme",
    period: null,
    ...SETTINGS_BASE,
  });
  assert.equal(leftover.totalSeconds, 0, "the entry is now fully billed and cannot be billed again");
});

test("invoice: voiding an invoice returns its hours to the billable pool", () => {
  const { buildDraft } = core;
  const entries = [entry("a", "Acme", "Build", "2026-10-01T09:00:00", "2026-10-01T11:00:00")];
  const draft = buildDraft({ entries, invoices: [], client: "Acme", period: null, ...SETTINGS_BASE });

  const voided = { id: "i1", voided: true, allocations: draft.allocations };
  const after = buildDraft({
    entries,
    invoices: [voided],
    client: "Acme",
    period: null,
    ...SETTINGS_BASE,
  });
  assert.equal(after.totalSeconds, 2 * 3600);
});

test("invoice: a running timer is excluded and said so", () => {
  const { buildDraft } = core;
  const entries = [
    entry("a", "Acme", "Build", "2026-10-01T09:00:00", "2026-10-01T10:00:00"),
    entry("b", "Acme", "Build", "2026-10-02T09:00:00", null),
  ];
  const draft = buildDraft({ entries, invoices: [], client: "Acme", period: null, ...SETTINGS_BASE });
  assert.equal(draft.totalSeconds, 3600);
  assert.ok(
    draft.warnings.some((w) => w.includes("still running")),
    "the user is told a timer was left out"
  );
});

test("invoice: a line that rounds to zero is surfaced, not silently dropped", () => {
  const { buildDraft } = core;
  const entries = [entry("a", "Acme", "Tiny", "2026-10-01T09:00:00", "2026-10-01T09:02:00")];
  const draft = buildDraft({ entries, invoices: [], client: "Acme", period: null, ...SETTINGS_BASE });
  assert.equal(draft.lines.length, 1);
  assert.equal(draft.lines[0].seconds, 0);
  assert.equal(draft.lines[0].roundedToZero, true);
  assert.ok(draft.warnings.some((w) => w.includes("rounded down to zero")));
});

test("invoice: pre-2.0 entries are flagged as unknown rather than assumed unbilled", () => {
  const { buildDraft } = core;
  const migratedAt = new Date("2026-10-10T00:00:00").getTime();
  const entries = [entry("old", "Acme", "Build", "2026-09-01T09:00:00", "2026-09-01T10:00:00")];
  const draft = buildDraft({
    entries,
    invoices: [],
    client: "Acme",
    period: null,
    ...SETTINGS_BASE,
    legacyUnknownBefore: migratedAt,
  });
  assert.equal(draft.legacyUnknownCount, 1);
  assert.ok(draft.warnings.some((w) => w.includes("may already have been invoiced")));
});

test("invoice: only the named client's time is billed", () => {
  const { buildDraft } = core;
  const entries = [
    entry("a", "Acme", "Build", "2026-10-01T09:00:00", "2026-10-01T10:00:00"),
    entry("b", "Other", "Build", "2026-10-01T09:00:00", "2026-10-01T10:00:00"),
  ];
  const draft = buildDraft({ entries, invoices: [], client: "Acme", period: null, ...SETTINGS_BASE });
  assert.equal(draft.totalSeconds, 3600);
});

// ----------------------------------------------------------- escaping ------

test("text: YAML scalars survive quotes, newlines and control characters", () => {
  const { yamlScalar } = core;
  assert.equal(yamlScalar('Acme "Holdings"'), '"Acme \\"Holdings\\""');
  assert.equal(yamlScalar("line1\nline2"), '"line1\\nline2"');
  assert.equal(yamlScalar("back\\slash"), '"back\\\\slash"');
  assert.equal(yamlScalar("NO"), '"NO"', "a bare NO would parse as boolean false");
});

test("text: a pipe in a project name cannot break the table", () => {
  const { tableCell } = core;
  assert.equal(tableCell("Phase 1 | Phase 2"), "Phase 1 \\| Phase 2");
  assert.equal(tableCell("two\nlines"), "two lines");
});

test("text: file name components cannot climb out of the invoice folder", () => {
  const { fileNameComponent } = core;
  assert.equal(fileNameComponent("North/West"), "North-West");
  assert.equal(fileNameComponent("../../etc/passwd"), "etc-passwd");
  assert.equal(fileNameComponent("CON"), "CON_");
  assert.equal(fileNameComponent("trailing."), "trailing");
  assert.equal(fileNameComponent(""), "Unnamed");
  assert.ok(fileNameComponent("x".repeat(500)).length <= 80);
});

// ------------------------------------------------------------- markdown ----

test("markdown: the rendered invoice agrees with the model and escapes its inputs", () => {
  const { buildDraft, draftToDocument, renderInvoiceMarkdown, DEFAULT_SETTINGS, formatMoney } = core;
  const entries = [
    entry("a", 'Acme "Holdings"', "Phase 1 | Phase 2", "2026-10-01T09:00:00", "2026-10-01T11:00:00"),
  ];
  const draft = buildDraft({ entries, invoices: [], client: 'Acme "Holdings"', period: null, ...SETTINGS_BASE });
  const doc = draftToDocument(draft, {
    number: "2026-0001",
    client: 'Acme "Holdings"',
    issuedAt: new Date("2026-10-15T12:00:00").getTime(),
    period: null,
    settings: { ...DEFAULT_SETTINGS, currency: "USD" },
  });
  const md = renderInvoiceMarkdown(doc);

  assert.ok(md.includes('client: "Acme \\"Holdings\\""'), "frontmatter is valid YAML");
  assert.ok(md.includes("Phase 1 \\| Phase 2"), "the pipe is escaped inside the table");
  assert.ok(md.includes(formatMoney(doc.totalMinor, "USD")), "the total shown is the model's total");
  assert.ok(md.includes("total: 200.00"), "the frontmatter total is a plain number");
  assert.equal(md.split("\n").filter((l) => l === "---").length, 2, "frontmatter is closed exactly once");
});

// ------------------------------------------------- interval allocations ----

test("intervals: subtraction removes exactly the taken parts", () => {
  const { subtract, durationMs, normalize } = core;
  assert.deepEqual(subtract({ from: 0, to: 100 }, [{ from: 20, to: 40 }]), [
    { from: 0, to: 20 },
    { from: 40, to: 100 },
  ]);
  assert.deepEqual(subtract({ from: 0, to: 100 }, [{ from: 0, to: 100 }]), []);
  assert.deepEqual(subtract({ from: 0, to: 100 }, []), [{ from: 0, to: 100 }]);
  // Overlapping cuts merge to [10,60) and must not double-subtract, so
  // [0,10) + [60,100) = 50 survives, not 100 - 40 - 20 = 40.
  assert.equal(
    durationMs(subtract({ from: 0, to: 100 }, [{ from: 10, to: 50 }, { from: 40, to: 60 }])),
    50
  );
  assert.deepEqual(normalize([{ from: 10, to: 20 }, { from: 15, to: 30 }]), [{ from: 10, to: 30 }]);
});

test("invoice: overlapping custom periods cannot bill the same hour twice", () => {
  const { buildDraft } = core;
  // The defect this replaced: with scalar second-counting, invoice 1 took
  // 1h and invoice 2 took 2h from a 3h entry — "fully allocated" — while
  // 10:00-11:00 was billed on both and 11:00-12:00 on neither.
  const entries = [entry("x", "Acme", "Build", "2026-10-01T09:00:00", "2026-10-01T12:00:00")];
  const p = (fromIso, toIso) => ({
    from: new Date(fromIso).getTime(),
    to: new Date(toIso).getTime(),
    label: "custom",
  });

  const first = buildDraft({
    entries, invoices: [], client: "Acme",
    period: p("2026-10-01T10:00:00", "2026-10-01T11:00:00"), ...SETTINGS_BASE,
  });
  assert.equal(first.totalSeconds, 3600);
  const inv1 = { id: "i1", voided: false, allocations: first.allocations };

  const second = buildDraft({
    entries, invoices: [inv1], client: "Acme",
    period: p("2026-10-01T09:00:00", "2026-10-01T11:00:00"), ...SETTINGS_BASE,
  });
  assert.equal(second.totalSeconds, 3600, "only 09:00-10:00 is left inside that window");
  const inv2 = { id: "i2", voided: false, allocations: second.allocations };

  const third = buildDraft({
    entries, invoices: [inv1, inv2], client: "Acme", period: null, ...SETTINGS_BASE,
  });
  assert.equal(third.totalSeconds, 3600, "11:00-12:00 is still billable and was never lost");

  const inv3 = { id: "i3", voided: false, allocations: third.allocations };
  const fourth = buildDraft({
    entries, invoices: [inv1, inv2, inv3], client: "Acme", period: null, ...SETTINGS_BASE,
  });
  assert.equal(fourth.totalSeconds, 0, "and now the entry is exactly used up");

  const billedMs = [inv1, inv2, inv3]
    .flatMap((i) => i.allocations)
    .reduce((sum, a) => sum + (a.to - a.from), 0);
  assert.equal(billedMs, 3 * 3600 * 1000, "the three invoices tile the entry exactly once");
});

test("invoice: rounding reports the gap between hours tracked and hours billed", () => {
  const { buildDraft } = core;
  // 1h08m consumed, billed at 1.25h under quarter-hour rounding.
  const entries = [entry("a", "Acme", "Build", "2026-10-01T09:00:00", "2026-10-01T10:08:00")];
  const draft = buildDraft({ entries, invoices: [], client: "Acme", period: null, ...SETTINGS_BASE });
  assert.equal(draft.lines[0].rawSeconds, 68 * 60);
  assert.equal(draft.totalSeconds, 1.25 * 3600);
  assert.equal(draft.roundingDeltaSeconds, 1.25 * 3600 - 68 * 60);
  assert.ok(draft.warnings.some((w) => w.includes("more than the")));
  // The allocation still covers the real time, never the rounded time.
  const allocatedMs = draft.allocations.reduce((s, a) => s + (a.to - a.from), 0);
  assert.equal(allocatedMs, 68 * 60 * 1000);
});

test("period: a custom range's exclusive end is the next local midnight, not +24h", () => {
  const { parseLocalDate } = core;
  // 2026-03-08 is the US spring-forward date; that civil day is 23 hours long.
  const from = parseLocalDate("2026-03-08");
  const next = parseLocalDate("2026-03-09");
  assert.ok(from !== null && next !== null);
  const naive = from + 24 * 3600 * 1000;
  if (naive !== next) {
    // Only meaningful in a DST-observing zone; elsewhere the two agree.
    assert.notEqual(naive, next, "the naive +24h boundary misses local midnight");
  }
  assert.equal(new Date(next).getHours(), 0, "the real boundary is local midnight");
});
