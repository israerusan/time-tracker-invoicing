/**
 * The plugin, actually running.
 *
 * `onload`, the commands, the status bar, the settings tab and the whole
 * invoice flow execute here against a fake vault, a fake DOM and a
 * controllable clock. This is the code that had only ever been typechecked.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { loadCore, loadGlue } from "./harness.mjs";
import { FakeTimers, makeApp, notices, openModals, openNote } from "./fakeObsidian.mjs";

const core = await loadCore();
const { TimeTrackerPlugin } = await loadGlue();

const MANIFEST = { id: "time-tracker-invoicing", version: "2.0.0" };

/** A loaded plugin with a fake app, a fake clock, and nothing in the vault. */
async function boot(data = null) {
  notices.length = 0;
  openModals.length = 0;
  const timers = new FakeTimers().install();
  const app = makeApp();
  const plugin = new TimeTrackerPlugin(app, MANIFEST);
  plugin._data = data;
  await plugin.onload();
  return { plugin, app, timers };
}

/** Make the plugin believe it is licensed, the way a valid key would. */
function licence(plugin) {
  plugin.settings.isPro = true;
  plugin.settings.businessName = "Example Consulting";
  plugin.settings.businessEmail = "billing@example.com";
}

function lastNotice() {
  return notices[notices.length - 1]?.message ?? "";
}

// ------------------------------------------------------------- lifecycle --

test("plugin: onload completes and registers the expected surface", async () => {
  const { plugin, timers } = await boot();
  try {
    for (const id of [
      "start-tracking",
      "stop-tracking",
      "toggle-tracking",
      "discard-tracking",
      "show-totals",
      "generate-invoice",
      "void-invoice",
      "verify-license",
    ]) {
      assert.ok(plugin.commands.has(id), `command "${id}" is registered`);
    }
    assert.equal(plugin.statusBarItems.length, 1);
    assert.equal(plugin.ribbonIcons.length, 1);
    assert.equal(plugin.settingTabs.length, 1);
    assert.ok(plugin.registeredEvents.length >= 1, "the rename handler is registered");
  } finally {
    plugin.onunload();
    timers.uninstall();
  }
});

test("plugin: the preview is open to Lite; only voiding is hidden", async () => {
  const { plugin, timers } = await boot();
  try {
    // The gate is on the write, not on seeing the number. A free user who
    // cannot reach the preview never finds out what the paid half is worth.
    assert.equal(plugin.commandAvailable("generate-invoice"), true);
    assert.equal(plugin.commandAvailable("start-tracking"), true);
    // Voiding is not a preview of value, and there is nothing to void.
    assert.equal(plugin.commandAvailable("void-invoice"), false);

    licence(plugin);
    assert.equal(plugin.commandAvailable("generate-invoice"), true);
    assert.equal(plugin.commandAvailable("void-invoice"), true);
  } finally {
    plugin.onunload();
    timers.uninstall();
  }
});

test("plugin: an idle vault schedules no repeating timer at all", async () => {
  const { plugin, timers } = await boot();
  try {
    // The whole point of the status-bar rework: nothing ticks while nothing
    // is being tracked.
    assert.equal(timers.activeIntervals(), 0);
    assert.equal(plugin.statusBarItems[0].textContent, "Not tracking");
  } finally {
    plugin.onunload();
    timers.uninstall();
  }
});

test("plugin: the ticker starts with the timer and stops with it", async () => {
  const { plugin, app, timers } = await boot();
  try {
    openNote(app, "Work.md", { client: "Acme", project: "Build" });
    await plugin.startTracking();
    assert.equal(timers.activeIntervals(), 1, "ticking while tracking");

    timers.tickIntervals();
    assert.match(plugin.statusBarItems[0].textContent, /Acme/);

    await plugin.stopTracking();
    assert.equal(timers.activeIntervals(), 0, "and not a moment longer");
    assert.equal(plugin.statusBarItems[0].textContent, "Not tracking");
  } finally {
    plugin.onunload();
    timers.uninstall();
  }
});

// --------------------------------------------------------------- tracking -

test("plugin: tracking a note records an entry tagged from its frontmatter", async () => {
  const { plugin, app, timers } = await boot();
  try {
    openNote(app, "Projects/Redesign.md", { client: "Acme GmbH", project: "Phase One" });
    await plugin.startTracking();

    const active = plugin.store.getActiveTimer();
    assert.equal(active.client, "Acme GmbH");
    assert.equal(active.project, "Phase One");

    await plugin.stopTracking();
    const entries = plugin.store.getEntries();
    assert.equal(entries.length, 1);
    assert.equal(entries[0].client, "Acme GmbH");
    assert.equal(entries[0].filePath, "Projects/Redesign.md");
    assert.ok(entries[0].end !== null);

    // And it is durable, serialisable, and schema-stamped.
    assert.equal(plugin._data.schemaVersion, core.CURRENT_SCHEMA);
    assert.equal(plugin._data.entries.length, 1);
  } finally {
    plugin.onunload();
    timers.uninstall();
  }
});

test("plugin: a note with no client frontmatter falls back to the defaults", async () => {
  const { plugin, app, timers } = await boot();
  try {
    openNote(app, "Loose Note.md");
    await plugin.startTracking();
    const active = plugin.store.getActiveTimer();
    assert.equal(active.client, "Unassigned");
    assert.equal(active.project, "Loose Note", "the note name becomes the project");
  } finally {
    plugin.onunload();
    timers.uninstall();
  }
});

test("plugin: tracking with no note open is refused, not crashed", async () => {
  const { plugin, timers } = await boot();
  try {
    await plugin.startTracking();
    assert.match(lastNotice(), /Open a note/);
    assert.equal(plugin.store.isRunning(), false);
  } finally {
    plugin.onunload();
    timers.uninstall();
  }
});

test("plugin: renaming a tracked note retargets its entries", async () => {
  const { plugin, app, timers } = await boot();
  try {
    const file = openNote(app, "Old Name.md", { client: "Acme" });
    await plugin.startTracking();
    await plugin.stopTracking();

    await app.vault.rename(file, "Renamed.md");
    const entry = plugin.store.getEntries()[0];
    assert.equal(entry.filePath, "Renamed.md");
    assert.equal(entry.fileName, "Renamed");
  } finally {
    plugin.onunload();
    timers.uninstall();
  }
});

test("plugin: discarding a running timer records nothing", async () => {
  const { plugin, app, timers } = await boot();
  try {
    openNote(app, "Work.md", { client: "Acme" });
    await plugin.startTracking();
    assert.equal(plugin.commandAvailable("discard-tracking"), true);
    plugin.runCommand("discard-tracking");
    await new Promise((r) => setImmediate(r));

    assert.equal(plugin.store.getEntries().length, 0);
    assert.equal(plugin.store.isRunning(), false);
    assert.match(lastNotice(), /nothing was recorded/);
  } finally {
    plugin.onunload();
    timers.uninstall();
  }
});

// -------------------------------------------------------------- invoicing -

/** Track a completed block of time for a client, without the clock. */
async function recordTime(plugin, app, { client, project, hours, startIso }) {
  openNote(app, `${project}.md`, { client, project });
  await plugin.startTracking();
  const active = plugin.store.getActiveTimer();
  active.start = new Date(startIso).getTime();
  await plugin.store.stop(active.start + hours * 3600_000);
}

/** Drive the whole invoice flow the way a user clicks it. */
async function issueInvoice(plugin, { clientIndex = 0, periodIndex = 2 } = {}) {
  openModals.length = 0;
  plugin.runCommand("generate-invoice");

  const clientPicker = openModals.at(-1);
  clientPicker.choose(clientIndex);

  const periodPicker = openModals.at(-1);
  periodPicker.choose(periodIndex); // 2 = "All unbilled time"

  const confirm = openModals.at(-1);
  const issue = confirm.button("Issue invoice");
  assert.ok(issue, `no "Issue invoice" button; modal said: ${confirm.contentEl.allText()}`);
  issue.dispatch("click");
  // The confirm handler kicks off an async issuance.
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setImmediate(r));
  return confirm;
}

/** Open the preview the way a user clicks it, and hand back the modal. */
function openPreview(plugin, { clientIndex = 0, periodIndex = 2 } = {}) {
  openModals.length = 0;
  plugin.runCommand("generate-invoice");
  openModals.at(-1).choose(clientIndex);
  openModals.at(-1).choose(periodIndex); // 2 = "All unbilled time"
  return openModals.at(-1);
}

test("plugin: a Lite user sees their own total, and confirming writes nothing", async () => {
  const { plugin, app, timers } = await boot();
  try {
    // No licence() call: this is the free tier throughout.
    await recordTime(plugin, app, {
      client: "Acme GmbH", project: "Phase One", hours: 3.5, startIso: "2026-10-01T09:00:00",
    });

    const preview = openPreview(plugin);
    const shown = preview.contentEl.allText();
    assert.match(shown, /Phase One/, "their own line is listed");
    assert.match(shown, /3\.50/, "their own hours");
    assert.match(shown, /USD 350\.00/, "their own money, at the default rate");

    // The same button a paying user presses - and it writes nothing.
    preview.button("Issue invoice").dispatch("click");
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setImmediate(r));

    const upsell = preview.contentEl.allText();
    assert.match(upsell, /Invoice Acme GmbH for USD 350\.00/, "the ask is their own amount");
    assert.match(upsell, /1 line, 3\.50h, USD 350\.00/);
    assert.match(upsell, /\$29 one-time, offline key, no account, no subscription\./);
    const buy = preview.contentEl
      .walk()
      .find((el) => el.tagName === "A" && /\$29/.test(el.textContent));
    assert.ok(buy, "a primary link to the purchase page");
    assert.equal(buy.attrs.href, plugin.settings.purchaseUrl);

    assert.equal(plugin.store.getInvoices().length, 0, "nothing was recorded");
    assert.equal(app.vault.contents.size, 1, "and nothing but the tracked note is in the vault");
    assert.equal(
      plugin.store.totalsByClient()[0].unbilledSeconds,
      3.5 * 3600,
      "the hours are still billable, so a later invoice cannot double-bill them"
    );
    // Not dumped into the settings pane with a Notice.
    assert.ok(!/Settings/i.test(lastNotice()), `unexpected notice: ${lastNotice()}`);
  } finally {
    plugin.onunload();
    timers.uninstall();
  }
});

test("plugin: pasting a key in the preview unlocks it there, not in settings", async () => {
  const { plugin, app, timers } = await boot();
  try {
    await recordTime(plugin, app, {
      client: "Acme GmbH", project: "Phase One", hours: 2, startIso: "2026-10-01T09:00:00",
    });

    // The real verification is covered by tests/license.test.mjs; what is
    // under test here is the wiring, so the signature check is stood in for.
    plugin.activateLicense = (key) => {
      if (key.trim() !== "good.key") return false;
      plugin.settings.isPro = true;
      return true;
    };

    const preview = openPreview(plugin);
    preview.button("Issue invoice").dispatch("click");
    preview.button("I have a key").dispatch("click");

    const field = modalComponent(preview, "License key");
    field.type("nonsense");
    field.blur();
    assert.match(
      preview.contentEl.allText(),
      /could not be verified/,
      "a bad key is answered in the dialog"
    );
    assert.equal(preview.button("Issue invoice"), null, "and does not unlock the write");

    field.type("good.key");
    field.blur();

    // Straight back to their invoice, with a button that now writes it.
    assert.match(preview.contentEl.allText(), /Invoice 2026-0001 — Acme GmbH/);
    const issue = preview.button("Issue invoice");
    assert.ok(issue, "the preview is back, confirmable");
    issue.dispatch("click");
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setImmediate(r));

    const invoices = plugin.store.getInvoices();
    assert.equal(invoices.length, 1, `nothing was written; last notice: ${lastNotice()}`);
    assert.ok(app.vault.getAbstractFileByPath(invoices[0].markdownPath));
  } finally {
    plugin.onunload();
    timers.uninstall();
  }
});

test("plugin: stopping a timer reports the money, not only the hours", async () => {
  const { plugin, app, timers } = await boot();
  try {
    openNote(app, "Work.md", { client: "Acme GmbH", project: "Build" });
    await plugin.startTracking();
    const active = plugin.store.getActiveTimer();
    active.start -= 2 * 3600_000; // two hours ago
    await plugin.stopTracking();

    assert.match(lastNotice(), /Logged 2\.00h to Acme GmbH/);
    assert.match(lastNotice(), /2\.00h unbilled for Acme GmbH — USD 200\.00/);

    // And the idle status bar carries the stake, rather than "Not tracking".
    assert.match(plugin.statusBarItems[0].textContent, /2\.00h unbilled · USD 200\.00/);
    assert.equal(timers.activeIntervals(), 0, "still nothing ticking while idle");
  } finally {
    plugin.onunload();
    timers.uninstall();
  }
});

test("plugin: a broken rate shows hours and names the rate, never a made-up total", async () => {
  const { plugin, app, timers } = await boot();
  try {
    openNote(app, "Work.md", { client: "Acme GmbH" });
    await plugin.startTracking();
    plugin.store.getActiveTimer().start -= 3600_000;
    plugin.settings.defaultHourlyRate = Number.NaN;
    await plugin.stopTracking();

    assert.match(lastNotice(), /1\.00h unbilled for Acme GmbH\./);
    assert.ok(!/USD/.test(lastNotice()), `no amount was invented: ${lastNotice()}`);
    assert.match(lastNotice(), /not a valid amount/);
    assert.equal(plugin.statusBarItems[0].textContent, "1.00h unbilled");

    plugin.runCommand("show-totals");
    assert.match(lastNotice(), /Acme GmbH: 1\.00h unbilled \(1\.00h tracked\)/);
    assert.match(lastNotice(), /not a valid amount/);
  } finally {
    plugin.onunload();
    timers.uninstall();
  }
});

test("plugin: the first stop on an untagged note explains the default client", async () => {
  const { plugin, app, timers } = await boot();
  try {
    openNote(app, "Loose Note.md");
    await plugin.startTracking();
    await plugin.stopTracking();
    assert.match(lastNotice(), /Set a "client" property on the note/);

    // Said once, not on every stop.
    openNote(app, "Another.md");
    await plugin.startTracking();
    await plugin.stopTracking();
    assert.ok(!/Set a "client" property/.test(lastNotice()), `nagged again: ${lastNotice()}`);
  } finally {
    plugin.onunload();
    timers.uninstall();
  }
});

test("plugin: totals list unbilled hours and what they are worth", async () => {
  const { plugin, app, timers } = await boot();
  try {
    await recordTime(plugin, app, {
      client: "Acme GmbH", project: "Phase One", hours: 3, startIso: "2026-10-01T09:00:00",
    });
    await recordTime(plugin, app, {
      client: "Globex", project: "Audit", hours: 1.5, startIso: "2026-10-02T09:00:00",
    });

    plugin.runCommand("show-totals");
    const message = lastNotice();
    assert.match(message, /Acme GmbH: 3\.00h unbilled — USD 300\.00 \(3\.00h tracked\)/);
    assert.match(message, /Globex: 1\.50h unbilled — USD 150\.00 \(1\.50h tracked\)/);
    assert.ok(
      notices.at(-1).timeout >= 15000,
      "it stays up long enough to read more than one client"
    );
  } finally {
    plugin.onunload();
    timers.uninstall();
  }
});

test("plugin: the whole invoice flow writes a markdown invoice and a PDF", async () => {
  const { plugin, app, timers } = await boot();
  try {
    licence(plugin);
    await recordTime(plugin, app, {
      client: "Acme GmbH", project: "Phase One", hours: 3.5, startIso: "2026-10-01T09:00:00",
    });

    await issueInvoice(plugin);

    const invoices = plugin.store.getInvoices();
    assert.equal(invoices.length, 1, `no invoice recorded; last notice: ${lastNotice()}`);
    const invoice = invoices[0];
    assert.equal(invoice.number, "2026-0001");
    assert.equal(invoice.client, "Acme GmbH");
    assert.equal(invoice.totalSeconds, 3.5 * 3600);
    assert.equal(invoice.voided, false);

    const md = app.vault.getAbstractFileByPath(invoice.markdownPath);
    assert.ok(md, `markdown invoice missing at ${invoice.markdownPath}`);
    assert.ok(app.vault.contents.get(invoice.markdownPath).includes("# Invoice 2026-0001"));

    assert.ok(invoice.pdfPath, "a PDF path was recorded");
    const pdf = app.vault.contents.get(invoice.pdfPath);
    assert.equal(String.fromCharCode(...pdf.slice(0, 8)), "%PDF-1.4");

    assert.ok(app.workspace.opened.includes(invoice.markdownPath), "the invoice was opened");
    assert.equal(plugin.pendingIssue ?? null, null, "no pending marker is left behind");
    assert.equal(plugin._data.pendingIssue, null);
  } finally {
    plugin.onunload();
    timers.uninstall();
  }
});

test("plugin: a second invoice for the same client bills nothing more", async () => {
  const { plugin, app, timers } = await boot();
  try {
    licence(plugin);
    await recordTime(plugin, app, {
      client: "Acme GmbH", project: "Phase One", hours: 2, startIso: "2026-10-01T09:00:00",
    });
    await issueInvoice(plugin);
    assert.equal(plugin.store.getInvoices().length, 1);

    // The defect this release exists to fix: the second invoice used to
    // re-bill the client's entire history.
    openModals.length = 0;
    plugin.runCommand("generate-invoice");
    openModals.at(-1).choose(0);
    openModals.at(-1).choose(2);
    const confirm = openModals.at(-1);
    assert.equal(confirm.button("Issue invoice"), null, "there is nothing to issue");
    assert.match(confirm.contentEl.allText(), /nothing left to bill/);
  } finally {
    plugin.onunload();
    timers.uninstall();
  }
});

test("plugin: voiding an invoice returns its hours and keeps the file", async () => {
  const { plugin, app, timers } = await boot();
  try {
    licence(plugin);
    await recordTime(plugin, app, {
      client: "Acme GmbH", project: "Phase One", hours: 2, startIso: "2026-10-01T09:00:00",
    });
    await issueInvoice(plugin);
    const invoice = plugin.store.getInvoices()[0];

    openModals.length = 0;
    plugin.runCommand("void-invoice");
    openModals.at(-1).choose(0);
    await new Promise((r) => setImmediate(r));

    assert.equal(plugin.store.getInvoices()[0].voided, true);
    assert.ok(
      app.vault.getAbstractFileByPath(invoice.markdownPath),
      "the invoice document is untouched"
    );
    const totals = plugin.store.totalsByClient();
    assert.equal(totals[0].unbilledSeconds, 2 * 3600, "the hours are billable again");
  } finally {
    plugin.onunload();
    timers.uninstall();
  }
});

test("plugin: a write that commits and then fails is recovered in the same session", async () => {
  const { plugin, app, timers } = await boot();
  try {
    licence(plugin);
    await recordTime(plugin, app, {
      client: "Acme GmbH", project: "Phase One", hours: 2, startIso: "2026-10-01T09:00:00",
    });

    openModals.length = 0;
    plugin.runCommand("generate-invoice");
    openModals.at(-1).choose(0);
    openModals.at(-1).choose(2);
    const planned = "Invoices/Invoice 2026-0001 - Acme GmbH.md";
    // The file reaches the vault and the call reports failure anyway — the
    // state the caller cannot tell apart from "nothing was written".
    app.vault.commitThenFailOn(planned, "storage reported failure after writing");
    openModals.at(-1).button("Issue invoice").dispatch("click");
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setImmediate(r));

    assert.ok(app.vault.getAbstractFileByPath(planned), "the invoice reached the vault");
    assert.equal(plugin.store.getInvoices().length, 1, "and was recorded despite the error");
    assert.ok(
      notices.some((n) => /was written but not recorded/.test(n.message)),
      `expected a recovery notice, got: ${notices.map((n) => n.message).join(" | ")}`
    );
    assert.equal(
      plugin.store.totalsByClient()[0].unbilledSeconds,
      0,
      "its hours cannot be billed a second time"
    );
    assert.equal(plugin._data.pendingIssue, null, "and no marker is left behind");
  } finally {
    plugin.onunload();
    timers.uninstall();
  }
});

test("plugin: a pending issuance left by a crash is reconciled on the next load", async () => {
  // The process died between writing the files and recording the invoice, so
  // the marker is still in the data file and nothing cleaned it up.
  const timers = new FakeTimers().install();
  try {
    notices.length = 0;
    const app = makeApp();
    const first = new TimeTrackerPlugin(app, MANIFEST);
    first._data = null;
    await first.onload();
    licence(first);
    await recordTime(first, app, {
      client: "Acme GmbH", project: "Phase One", hours: 2, startIso: "2026-10-01T09:00:00",
    });

    openModals.length = 0;
    first.runCommand("generate-invoice");
    openModals.at(-1).choose(0);
    openModals.at(-1).choose(2);
    openModals.at(-1).button("Issue invoice").dispatch("click");
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setImmediate(r));

    const invoice = first.store.getInvoices()[0];
    assert.ok(invoice, "a baseline invoice was issued");

    // Rewind the data file to the instant after the files were written and
    // before the invoice was recorded.
    // The marker as the plugin writes it: both paths planned, nothing
    // recorded yet.
    const crashed = JSON.parse(JSON.stringify(first._data));
    crashed.invoices = [];
    crashed.pendingIssue = { ...invoice };
    first.onunload();

    notices.length = 0;
    const restarted = new TimeTrackerPlugin(app, MANIFEST);
    restarted._data = crashed;
    await restarted.onload();
    assert.equal(restarted.store.getInvoices().length, 0, "nothing is recorded before layout is ready");

    await app.workspace.triggerLayoutReady();
    // `onLayoutReady` does not await the callback, so let it settle.
    await new Promise((r) => setImmediate(r));

    const recovered = restarted.store.getInvoices();
    assert.equal(recovered.length, 1, "the interrupted invoice is recorded");
    assert.equal(recovered[0].number, invoice.number);
    assert.equal(recovered[0].pdfPath, invoice.pdfPath, "the PDF path is recovered, not lost");
    assert.ok(notices.some((n) => /was written but not recorded/.test(n.message)));
    assert.equal(restarted.store.totalsByClient()[0].unbilledSeconds, 0);
    restarted.onunload();
  } finally {
    timers.uninstall();
  }
});

test("plugin: a pending issuance whose files never landed releases its hours", async () => {
  const timers = new FakeTimers().install();
  try {
    notices.length = 0;
    const app = makeApp();
    const first = new TimeTrackerPlugin(app, MANIFEST);
    first._data = null;
    await first.onload();
    licence(first);
    await recordTime(first, app, {
      client: "Acme GmbH", project: "Phase One", hours: 2, startIso: "2026-10-01T09:00:00",
    });

    const entry = first.store.getEntries()[0];
    const crashed = JSON.parse(JSON.stringify(first._data));
    crashed.pendingIssue = {
      id: "inv_crashed", number: "2026-0001", client: "Acme GmbH", issuedAt: Date.now(),
      periodFrom: null, periodTo: null, currency: "USD", rateMinor: 10000, roundHoursTo: 0.25,
      allocations: [{ entryId: entry.id, from: entry.start, to: entry.end }],
      totalSeconds: 7200, totalMinor: 20000,
      markdownPath: "Invoices/Invoice 2026-0001 - Acme GmbH.md", pdfPath: null, voided: false,
    };
    first.onunload();

    notices.length = 0;
    const restarted = new TimeTrackerPlugin(app, MANIFEST);
    restarted._data = crashed;
    await restarted.onload();
    await app.workspace.triggerLayoutReady();
    await new Promise((r) => setImmediate(r));

    assert.equal(restarted.store.getInvoices().length, 0, "no invoice is invented");
    assert.match(lastNotice(), /still available to invoice/);
    assert.equal(
      restarted.store.totalsByClient()[0].unbilledSeconds,
      2 * 3600,
      "the hours go back in the pool"
    );
    assert.equal(restarted._data.pendingIssue, null);
    restarted.onunload();
  } finally {
    timers.uninstall();
  }
});

test("plugin: an issuance that wrote nothing leaves the hours billable", async () => {
  const { plugin, app, timers } = await boot();
  try {
    licence(plugin);
    await recordTime(plugin, app, {
      client: "Acme GmbH", project: "Phase One", hours: 2, startIso: "2026-10-01T09:00:00",
    });

    openModals.length = 0;
    plugin.runCommand("generate-invoice");
    openModals.at(-1).choose(0);
    openModals.at(-1).choose(2);
    app.vault.failOn("Invoices/Invoice 2026-0001 - Acme GmbH.md", "disk full");
    openModals.at(-1).button("Issue invoice").dispatch("click");
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setImmediate(r));

    assert.equal(plugin.store.getInvoices().length, 0);
    assert.equal(plugin._data.pendingIssue, null, "the marker is cleared");
    assert.equal(plugin.store.totalsByClient()[0].unbilledSeconds, 2 * 3600);
    assert.match(lastNotice(), /disk full/);
  } finally {
    plugin.onunload();
    timers.uninstall();
  }
});

// -------------------------------------------------------------- settings --

test("plugin: the settings tab renders in both tiers without throwing", async () => {
  const { plugin, timers } = await boot();
  try {
    const tab = plugin.settingTabs[0];

    tab.display();
    const free = tab.containerEl.allText();
    assert.match(free, /Lite tier active/);
    assert.match(free, /\(Premium\)/, "premium rows are shown as locked");
    assert.match(free, /Run Generate invoice first/, "the preview is pointed at before the price");
    assert.match(free, /appear on the invoice itself/, "the locked rows say what they are for");
    assert.match(free, /\$29 one-time/, "and the ask names the price");

    licence(plugin);
    tab.display();
    const pro = tab.containerEl.allText();
    assert.match(pro, /Premium active/);
    assert.ok(!/Lite tier active/.test(pro));
    assert.match(pro, /No invoices issued yet/);
  } finally {
    plugin.onunload();
    timers.uninstall();
  }
});

test("plugin: typing in settings does not write once per keystroke", async () => {
  const { plugin, timers } = await boot();
  try {
    licence(plugin);
    const tab = plugin.settingTabs[0];
    tab.display();

    let saves = 0;
    const realSave = plugin.saveData.bind(plugin);
    plugin.saveData = async (d) => {
      saves += 1;
      return realSave(d);
    };

    const currency = findComponent(tab, "Currency");
    for (const ch of "GBP") currency.type(currency.getValue() + ch);
    assert.equal(saves, 0, "nothing is written while the user is still typing");

    timers.flushTimeouts();
    await new Promise((r) => setImmediate(r));
    assert.equal(saves, 1, "and exactly one write once they stop");
    assert.equal(plugin.settings.currency, "USDGBP".slice(-6));
  } finally {
    plugin.onunload();
    timers.uninstall();
  }
});

test("plugin: the license is verified on blur, not on every character", async () => {
  const { plugin, timers } = await boot();
  try {
    const tab = plugin.settingTabs[0];
    tab.display();
    const field = findComponent(tab, "License key");

    let renders = 0;
    const realDisplay = tab.display.bind(tab);
    tab.display = () => {
      renders += 1;
      realDisplay();
    };

    for (const ch of "abc.def") field.type(field.getValue() + ch);
    assert.equal(renders, 0, "the pane is not rebuilt mid-typing");

    field.blur();
    assert.equal(renders, 1, "and exactly once when the field is left");
    assert.equal(plugin.settings.isPro, false, "a bogus key does not unlock anything");
  } finally {
    plugin.onunload();
    timers.uninstall();
  }
});

/** The input component behind a setting row rendered inside a modal. */
function modalComponent(modal, name) {
  const setting = (modal.contentEl.settings ?? [])
    .concat(
      modal.contentEl
        .walk()
        .flatMap((el) => el.settings ?? [])
    )
    .find((s) => s.name === name);
  if (!setting || setting.components.length === 0) {
    throw new Error(`no input for "${name}" in this modal`);
  }
  return setting.components[0];
}

/** The input component behind the setting row with this name. */
function findComponent(tab, name) {
  const setting = (tab.containerEl.settings ?? []).find((s) => s.name === name);
  if (!setting || setting.components.length === 0) {
    const names = (tab.containerEl.settings ?? []).map((s) => s.name).join(", ");
    throw new Error(`no input for setting "${name}". Rendered: ${names}`);
  }
  return setting.components[0];
}

// ------------------------------------------------------------- migration --

test("plugin: a pre-2.0 data file loads, warns, and keeps its entries", async () => {
  const legacy = {
    settings: { defaultHourlyRate: 120, currency: "EUR" },
    entries: [
      {
        id: "te_0_1",
        filePath: "Work.md",
        fileName: "Work",
        client: "Acme",
        project: "Build",
        start: new Date("2026-09-01T09:00:00").getTime(),
        end: new Date("2026-09-01T11:00:00").getTime(),
      },
    ],
    activeTimer: null,
  };
  const { plugin, timers } = await boot(legacy);
  try {
    assert.equal(plugin.store.getEntries().length, 1);
    assert.equal(plugin.settings.defaultHourlyRate, 120);
    assert.equal(plugin.settings.currency, "EUR");
    assert.ok(
      notices.some((n) => /billing status is unknown/.test(n.message)),
      "the user is warned about hours whose billing status cannot be known"
    );
  } finally {
    plugin.onunload();
    timers.uninstall();
  }
});

test("plugin: a data file from a newer version opens read-only and writes nothing", async () => {
  const future = { schemaVersion: core.CURRENT_SCHEMA + 3, settings: {}, entries: [] };
  const { plugin, app, timers } = await boot(future);
  try {
    assert.equal(plugin.isReadOnly(), true);
    openNote(app, "Work.md", { client: "Acme" });
    await plugin.startTracking();
    assert.equal(plugin.store.isRunning(), false, "tracking is refused");
    assert.match(lastNotice(), /read-only/);
    assert.equal(plugin._data.schemaVersion, core.CURRENT_SCHEMA + 3, "the file is untouched");
  } finally {
    plugin.onunload();
    timers.uninstall();
  }
});

test("plugin: a save failure is reported rather than swallowed", async () => {
  const { plugin, app, timers } = await boot();
  try {
    openNote(app, "Work.md", { client: "Acme" });
    plugin.failNextSave = "no space left on device";
    await plugin.startTracking().catch(() => undefined);
    assert.ok(
      notices.some((n) => /could not save/i.test(n.message)),
      `expected a save-failure notice, got: ${notices.map((n) => n.message).join(" | ")}`
    );
  } finally {
    plugin.onunload();
    timers.uninstall();
  }
});
