# Changelog

All notable changes to Time Tracker and Invoicing are documented here. This
project follows [Semantic Versioning](https://semver.org/).

## [2.0.1] - 2026-10-16

The Obsidian-facing half of 2.0.0 had been typechecked and linted but never
run. It now runs under a test harness that supplies the parts of the API it
uses — a small DOM, the vault, the modals, the settings tab, a controllable
clock — so `onload`, the commands, the status bar, the settings pane and the
whole invoice flow execute on every test run. Two real defects fell out of
that immediately.

### Fixed
- **A recovered invoice no longer forgets its PDF.** Where the PDF was going
  was held in memory only, so an invoice recovered after a crash — the one
  case the memory is gone — was recorded without it, even with the file
  sitting next to the Markdown. The path is now part of the durable marker.
- **An unreadable pending-issuance marker is quarantined rather than dropped.**
  It is still evidence that an issuance was interrupted, and silently
  discarding it hid the one clue that something needed looking at.
- **A failure inside reconciliation is reported.** It ran as a discarded
  promise, so if it threw, nothing was shown.

### Internal
- `tests/fakeObsidian.mjs` and `tests/plugin.test.mjs`: the real plugin, driven
  end to end. 98 tests, up from 76.

## [2.0.0] - 2026-10-15

### Added
- **PDF export, for real.** Previous releases listed PDF export as a Premium
  feature; the code behind it (`exportPdfStub`) only showed a notice telling you
  to use Obsidian's own export. There is now an actual PDF generator: written
  locally, no network, no bundled font engine, works on mobile as well as
  desktop. A4 or US Letter, with pagination, a repeated table header and
  carried-forward totals on long invoices.
  - It draws with the standard PDF fonts, so it covers Latin-1 (`Müller GmbH`,
    `Société Générale`, `£`, `€`). A client name in a script outside that set
    makes PDF export **refuse and say which characters it cannot draw**, rather
    than transliterate or substitute them. The Markdown invoice is always
    written and has no such limit.
- **Billing periods.** Invoices now cover last month, this month, all unbilled
  time, or a custom range. An entry spanning the boundary is split at it.
- **An invoice preview.** Nothing is written until you have seen every line, the
  hours, the total, and any warnings.
- **Void an issued invoice** — returns its hours to the billable pool and leaves
  the invoice file untouched.
- **Discard running timer without recording it.**
- **Payment terms**, **PDF page size** and **next invoice number** settings.
- `Show tracked time totals` now reports unbilled hours alongside total tracked.

### Fixed
- **Invoices no longer re-bill hours that were already invoiced.** Generating a
  second invoice for a client used to include every hour ever tracked for them,
  because nothing recorded what had been billed. Each invoice now records the
  exact *intervals* of each entry it billed, and a later invoice can only bill
  what is left. Recording a count of seconds would not have been enough: two
  invoices covering overlapping custom periods could consume an entry's whole
  duration between them while billing the overlap twice and the remainder never.
- **The exclusive end of a custom billing period is the next local midnight,**
  not twenty-four hours later. Across a daylight-saving transition the latter
  lands on 01:00 or 23:00 and bills an hour belonging to the next period.
- **Two invoice previews open at once can no longer be issued under the same
  number.** The number shown in the preview is provisional; it is claimed
  against the ledger at the moment you confirm, and only one invoice is issued
  at a time. Voided invoices keep their number — they may already have been sent.
- **An invoice that would bill nothing is refused** rather than issued, since
  issuing it would mark the hours billed while charging for none of them.
- **Saves are serialized.** A rename burst, a settings blur and a timer stop
  could previously have three writes of the whole ledger in flight at once, and
  an older one completing last would write back stale state. A save that fails
  now says so instead of failing silently.
- **Migration rejects allocations that cannot be true** — naming an entry that
  does not exist, or claiming time outside the entry's own span — which would
  otherwise leave that entry permanently over-allocated and all of its real
  hours suppressed.
- **Rounding no longer hides the difference between hours tracked and hours
  billed.** Where it exceeds a minute, the preview and the invoice say so.
- **Long sender details wrap** instead of running under the "Bill to" column.
- **A failure to create the invoice folder is reported** instead of being
  mistaken for a harmless concurrent creation.
- **An invoice interrupted mid-write is reconciled rather than lost.** Writing
  the invoice files and recording the invoice are two operations and cannot be
  made one. The intent is now written down first, including where the files are
  going; on the next load the vault is asked which way it went. If the invoice
  is there it is recorded — it may already have been sent, and its hours must
  not become billable again. If it is not, the hours stay available. A
  `vault.create` that reaches storage and *then* reports failure is handled the
  same way, because the error alone cannot tell you which happened.
- **A corrupt or missing allocation list quarantines the invoice** instead of
  being read as "this invoice billed nothing", which would have returned
  already-invoiced hours to the billable pool.
- **Duplicate invoice numbers are quarantined** on load, not just duplicate
  internal ids.
- **A settings edit made in the last moments before unload is no longer
  discarded.**
- **Invoices no longer overwrite each other.** The old file name was derived
  from the year, month and client, and a collision called `vault.modify()` — so
  a deposit and a final invoice to the same client in the same month silently
  destroyed the first. Numbering is sequential and writes are create-only.
- **Entries spanning a month boundary are no longer billed entirely to the month
  they started in.**
- **Client and project names can no longer corrupt the invoice.** A name
  containing a quote broke the YAML frontmatter; one containing a pipe broke the
  table and shifted every money column; one containing a slash wrote the invoice
  into an unintended folder. All three are escaped now.
- **Money is computed in integer minor units** rather than floats, and
  currencies with no minor unit (JPY) or three digits (KWD) are handled.
- **A blank hourly rate is refused** instead of being read as zero.
- **Time entries can no longer be given a duplicate identifier.** Ids were
  derived from the array length plus a counter that reset on every load.
- **Entries follow their note when it is renamed.**

### Changed
- **Performance:** the status-bar timer now runs only while a timer is actually
  running. It previously held a 1 Hz interval for the whole session and rewrote
  the same "Not tracking" text 86,400 times a day. On an idle vault the plugin
  now schedules nothing.
- **Performance:** settings edits are debounced. Every keystroke used to
  serialise the entire ledger — settings, every time entry, the running timer —
  to disk. The license key is verified when you leave the field rather than on
  each character, which also stops the settings pane rebuilding mid-typing and
  throwing focus out of the field.
- **The data file is schema-versioned and migrates non-destructively.** Records
  that cannot be read are quarantined verbatim rather than dropped, unknown
  fields are preserved, and a file written by a newer version of the plugin
  opens read-only instead of being overwritten.
- **Entries recorded before this release are marked "billing status unknown"**,
  not "unbilled". The old code kept no record of what it had invoiced, so
  claiming those hours were never billed would be a guess — and the direction of
  that guess is "bill the client again". You are warned before they are included.

### Internal
- All arithmetic, aggregation, escaping, migration, reconciliation and PDF
  generation moved into `src/core` and `src/pdf`, which import nothing from
  Obsidian. The test runner bundles those directories *without* marking
  `obsidian` external, so an accidental import there fails the build.
- A fake-vault harness runs the real `InvoiceWriter` against injected disk
  failures — a create that rejects, a create that commits and then rejects, a
  path already taken, an invoice folder that is really a file. 76 tests, up
  from 2 that only checked the license key and the manifest.

## [1.0.1] - 2026-07-05

### Internal
- **`npm run lint` now runs `eslint-plugin-obsidianmd` — the exact ruleset
  Obsidian's automated community-plugin review uses** — as a hard gate
  (`eslint . --max-warnings 0`), so review failures are caught locally before a
  release instead of after (a failed review delists the plugin). Added a
  **manifest-contract test** and a reusable **release checklist** in `docs/`.

### Fixed
- Four `no-misused-promises` issues surfaced by the new lint gate: the settings
  render callbacks were given block bodies so they return `void` (behavior
  unchanged). The license test now skips gracefully when the signing key is
  absent, matching the other plugins.
