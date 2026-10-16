# Time Tracker & Invoicing

**The hours are already in your vault. They just never become an invoice.**

Start a timer on the note you are working in. The time is tagged with that note's client and
project, totalled per client, and kept as a ledger of what is still unbilled — so at the end of the
month you are not reconstructing a week from memory or from file timestamps.

**Free, forever:** the timer, the status bar, the ribbon toggle, client/project tagging from note
properties, and unbilled totals per client in your own currency.

**Premium — $29 one-time, no account, no subscription:** turn those unbilled hours into a numbered
invoice (Markdown, and a PDF beside it), with the record of which hours it billed so the same hour
is never billed twice. [**Buy a key — $29 one-time**](https://buymeacoffee.com/vaultspotlight/e/560212)

You do not have to pay to find out what it would say: run **Generate invoice** on the free tier and
the preview shows your own lines, your own hours and your own total before anything is written.

<!-- SCREENSHOT SLOT — un-comment once docs/assets/hero.png exists.
     ![The status-bar timer running on a client note, beside a generated invoice](docs/assets/hero.png)
     Not captured yet: Obsidian cannot be driven from this environment, and a mock would be a lie
     about what the plugin looks like. Shot list in docs/assets/hero-shot.md — one 1600px-wide
     capture, two panes: a client note with the status bar reading `0:12:34 · Acme Co`, and a
     generated invoice note showing line items and a total. -->

---

## Lite vs. Premium

| | Lite (free) | Premium ($29 one-time) |
| --- | :---: | :---: |
| Start/stop tracking on the active note | ✅ | ✅ |
| Live timer in the status bar | ✅ | ✅ |
| Client/project from note properties | ✅ | ✅ |
| Unbilled hours **and amounts** per client | ✅ | ✅ |
| **Invoice preview** — your lines, hours and total | ✅ | ✅ |
| Writing the invoice (Markdown) | — | ✅ |
| PDF export | — | ✅ |
| Billing periods, and never billing the same hour twice | — | ✅ |
| Voiding an issued invoice | — | ✅ |

Time tracking is free with no trial, no expiry and no cap on how much you may track. The preview is
free too. What the key buys is the write: the invoice file, the PDF, and the allocation record that
makes "never billed twice" true.

**Activating a key:** paste it into the invoice preview when it asks (**I have a key**), or into
**License key** in the plugin's settings. Either way it is verified offline — no account, no server,
no network call.

---

## How it works

### Tracking time

- **Start tracking active note** — begins a timer against the note you have open. The note's
  `client` and `project` properties (both configurable) tag the entry; with no `client` property the
  entry falls to your default client, and the note's name becomes the project.
- **Stop tracking** — records the entry, and tells you what that client now has unbilled, in money
  as well as hours.
- The **status bar** shows the running timer (`0:12:34 · Acme Co`); click it to start or stop. When
  nothing is running it shows what is sitting unbilled instead, so the stake stays visible. It
  schedules no repeating timer while idle.
- **Discard running timer without recording it** — for the timer you forgot to stop.
- Entries live in the plugin's own `data.json` inside your vault. Nothing leaves the machine.

### Seeing where you stand

- **Show tracked time totals** — each client's unbilled hours and what they come to at your default
  rate, plus what you have tracked in total. If the rate is not a usable number it says so rather
  than inventing one.

### Invoicing

- **Generate invoice** — pick a client, then a period (last month, this month, all unbilled time, or
  a custom range). You see exactly what would be billed — every line, the hours, the total — before
  anything is written. This preview is free.
- **The same hour is never billed twice.** Each issued invoice records *which intervals* of each
  entry it billed, and a later invoice can only bill what is left. An entry that straddles midnight
  on the first of the month is split at the boundary, so it bills once in each month and never twice
  overall — and two invoices covering overlapping date ranges still cannot bill the overlap twice.
- **Invoices are never overwritten.** Numbers are sequential (`2026-0001`), and if a file with that
  name exists already the plugin takes the next free number rather than writing over a document you
  may have sent. A correction is a new invoice plus **Void an issued invoice**, which returns those
  hours to the billable pool and leaves the original file untouched.
- **PDF export** — a real PDF, generated locally and written next to the Markdown invoice. A4 or US
  Letter; long invoices paginate with a repeated table header and carried-forward totals.

#### What the PDF can and cannot set

The PDF is drawn with the standard PDF fonts (Helvetica), which every viewer already has. That is
what keeps this feature a few kilobytes instead of the few hundred a bundled font engine would
cost — a real consideration in a plugin that loads at startup and makes no network calls.

The trade-off is the character set: **Latin-1 and the usual punctuation**. `Müller GmbH`, `Société
Générale`, `Łukasz` and `£`/`€` all render exactly. A name in Japanese, Chinese, Greek, Cyrillic or
Hebrew does not, and in that case **PDF export refuses and tells you which characters it cannot
draw**. It will not transliterate or substitute them: a document that states a company's legal name
and asks for money is the wrong place to quietly print a different name. The Markdown invoice has no
such limit and is always written, so nothing is lost but the PDF.

The PDF is built in plain JavaScript and written through the vault API — there is no `fs`, no
`child_process` and no other desktop-only call anywhere in that path, which is why this plugin is
not marked desktop-only.

---

## Commands

- **Start tracking active note**
- **Stop tracking**
- **Toggle tracking (start/stop)**
- **Discard running timer without recording it**
- **Show tracked time totals**
- **Generate invoice** — preview on any tier; writing needs a key
- **Void an issued invoice** — premium
- **Verify license key**

Plus a ribbon **clock** icon to toggle tracking. No default hotkeys are registered; bind what you
use.

## Settings

Free: default hourly rate, currency, hours rounding, the client/project property names, and the
default client. These are all a free user needs to make the preview true.

Premium: business name, address and email, payment terms, invoice folder, PDF export, PDF page size,
and the next invoice number. They are the things that *appear on* the invoice, so they stay locked
until a key is pasted — you are never asked to type your business address before you have seen what
an invoice would come to.

The currency setting accepts a code or a symbol. A code sets the decimal places correctly — `JPY`
has none, `KWD` has three — and anything unrecognised is treated as two.

## Install

**Community plugins (recommended):** open **Settings → Community plugins**, search **Time Tracker
and Invoicing**, and install it — one click, auto-updates.

**Manual install** — copy `main.js`, `manifest.json` and `styles.css` into:

```
<your-vault>/.obsidian/plugins/time-tracker-invoicing/
```

Then enable **Time Tracker & Invoicing** under *Settings → Community plugins*.

## Feedback and support

Bug reports, feature requests and questions all go to the GitHub issue tracker. It is the only place
I track them, so an issue will always get further than a review comment.

- **[Report a bug](https://github.com/israerusan/time-tracker-invoicing/issues/new?labels=bug)** — please include your Obsidian version, your operating system, and the steps that reproduce it.
- **[Request a feature](https://github.com/israerusan/time-tracker-invoicing/issues/new?labels=enhancement)** — describe the workflow you are trying to make faster; that is more useful than a proposed solution.
- **[Browse open issues](https://github.com/israerusan/time-tracker-invoicing/issues)** — worth a look first, in case it is already tracked.

## More plugins by the same author

Small, local-first plugins that each do one job and keep your data in your vault. All of them are in
the community directory — search the name under **Settings → Community plugins**.

**Search and views**

- [Vault Spotlight](https://github.com/israerusan/obsidian-vault-spotlight) — keyboard-first command center — fuzzy search, saved workflows, and result actions.
- [Bases Power Pack](https://github.com/israerusan/bases-power-pack) — kanban, calendar, Gantt, and outline views over your notes or a `.base` file.

**Vault health**

- [Vault Triage](https://github.com/israerusan/vault-triage) — find stale, orphaned, unfinished, and metadata-broken notes, then work through them.
- [Attachment Audit](https://github.com/israerusan/attachment-audit) — find orphaned, duplicate, oversized, and misplaced attachments, then clean them up safely.
- [Patina](https://github.com/israerusan/patina) — score every note's staleness from edits, opens, and inbound links.
- [Vault Router](https://github.com/israerusan/vault-router) — move new notes out of Inbox with fast local routing rules.
- [FlowKit Health Dashboard](https://github.com/israerusan/flowkit-health-dashboard) — find which add-on is breaking your vault, and score every one installed.

**Writing and research**

- [Prose Lens](https://github.com/israerusan/prose-lens) — live writing feedback — passive voice, adverbs, hedges, cliches, and a reading grade.
- [Prior Art](https://github.com/israerusan/prior-art) — show similar existing notes while you write, and merge duplicates without losing links.
- [Standing Questions](https://github.com/israerusan/standing-questions) — track the open questions in your vault and surface new notes that may answer them.
- [Unwritten](https://github.com/israerusan/unwritten) — report the notes you never wrote — unexplained link pairs, stub hubs, unreasoned decisions.
- [Effort Index](https://github.com/israerusan/effort-index) — measure the editing time behind every note and resurface the expensive ones.

**Time and billing**

- [Task Calendar Bridge](https://github.com/israerusan/obsidian-task-calendar-bridge) — export dated Markdown tasks to standards-based ICS calendar files.
- [Invoice Forge](https://github.com/israerusan/obsidian-invoice-forge) — a different starting point: it builds invoices from `#billable` lines you have already typed, where this plugin clocks the time itself on the note you have open. Use whichever matches how you record work; they are not the same tool.

---

## Maintainer

Everything below here is for working on the plugin, not for using it.

### Build

```bash
npm install
npm run build      # bundles to main.js
npm run dev        # watch mode
npm run typecheck  # tsc --noEmit
npm test           # lint + the full suite
```

`npm run build` produces `main.js` next to `manifest.json` and `styles.css`. Release steps are in
[docs/obsidian-release-checklist.md](docs/obsidian-release-checklist.md).

### Licensing

Keys are verified **offline with Ed25519 signatures**
([tweetnacl](https://www.npmjs.com/package/tweetnacl)) — no account, server, or network call. A key
is `base64url(payload).base64url(signature)`, verified against the public key embedded in
`src/license/publicKey.ts`. The price and the checkout URL live in one place, `src/product.ts`, so
the settings pane, the in-preview offer and this file cannot quote different numbers.

Selling keys (author workflow):

```bash
node scripts/keygen.mjs                       # one-time: create the keypair
npm run license:generate -- buyer@email.com   # after a sale: mint a key
```

The private key lives only in `scripts/.license-private.key`, which is gitignored and never ships.

### Project layout

```
time-tracker-invoicing/
├── manifest.json
├── versions.json
├── package.json
├── tsconfig.json
├── esbuild.config.mjs
├── styles.css
├── .github/workflows/
│   └── release.yml        # tag-driven GitHub release (build + attach assets)
├── scripts/
│   ├── keygen.mjs         # one-time Ed25519 keypair generator (author)
│   ├── generate-license.mjs   # mint a customer key (author)
│   └── customer-license-template.txt
├── tests/                 # the plugin actually runs here, against a fake vault
└── src/
    ├── main.ts            # entry, commands, status bar, persistence
    ├── settings.ts        # settings tab
    ├── product.ts         # the price and the purchase URL, in one place
    ├── license/
    │   ├── LicenseManager.ts  # offline Ed25519 verification
    │   └── publicKey.ts       # embedded public key
    ├── types/tweetnacl.d.ts   # minimal tweetnacl type shim
    ├── timeStore.ts       # entries, active timer, issued invoices
    ├── invoice.ts         # writing invoices into the vault (create-only)
    ├── ui/modals.ts       # client / period pickers, invoice preview, the offer
    ├── core/              # pure, no Obsidian imports — all of it unit-tested
    │   ├── money.ts           # integer minor units, rounding, formatting
    │   ├── period.ts          # billing periods, interval intersection
    │   ├── invoiceModel.ts    # entries + invoices -> what is billable
    │   ├── markdown.ts        # InvoiceDocument -> markdown
    │   ├── migrate.ts         # schema-versioned, non-destructive migration
    │   ├── text.ts            # YAML / table / file-name escaping
    │   └── ids.ts             # collision-free identifiers
    ├── pdf/               # pure, no Obsidian imports — a small PDF 1.4 writer
    │   ├── pdfWriter.ts       # objects, xref, content streams, ToUnicode
    │   ├── invoicePdf.ts      # InvoiceDocument -> pages
    │   ├── fontMetrics.ts     # standard-14 glyph widths
    │   └── winAnsi.ts         # encoding, and what it cannot represent
    └── types.ts           # shared interfaces & defaults
```

> **Reference:** the licensing approach, settings-tab patterns, build/test setup and project layout
> are adapted from the [Vault Spotlight](https://github.com/israerusan) plugin — see
> "Borrowed from Vault Spotlight" notes in the repo.

## License

MIT (plugin source). Premium feature access is governed by a signed license key.
