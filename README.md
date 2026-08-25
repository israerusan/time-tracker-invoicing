# Time Tracker & Invoicing

**Stop leaking billable hours — clock time on the notes you're already working in, then turn it into client-ready invoices without leaving Obsidian.**

Track billable time against your notes and projects, aggregate it by client, and generate invoices — built for freelancers and consultants who live in Obsidian. **Fully local: no external API, no account, your data stays in your vault.**

<!-- SCREENSHOT SLOT — drop a real capture here to lift conversions.
     ![The live status-bar timer running on a note, and a generated client invoice](docs/assets/hero.png)
     Suggested shot: the running status-bar timer (⏺ 0:12:34 · Acme Co) plus a generated invoice note with line items. Save as docs/assets/hero.png -->


> **Open-core / one-time purchase.** Time tracking is free forever in the Lite tier. Invoicing & PDF export unlock with a one-time license — **$29 one-time** — [buy here](https://buymeacoffee.com/vaultspotlight/e/560212).

---

## Lite vs. Premium

| Feature | Lite (free) | Premium ($29 one-time) |
| --- | :---: | :---: |
| Start/stop tracking on the active note | ✅ | ✅ |
| Live timer in the status bar | ✅ | ✅ |
| Client/project tagging via frontmatter | ✅ | ✅ |
| Totals by client (command) | ✅ | ✅ |
| **Invoice generation (markdown)** | — | ✅ |
| **PDF export** | — | ✅ (stub today) |

All **time tracking is free** — no trial, no expiry. **Invoicing and PDF export** are the only paid features, gated behind the license check (`LicenseManager.isPremium()`).

Purchase: [Buy Me a Coffee — Time Tracker & Invoicing Premium](https://buymeacoffee.com/vaultspotlight/e/560212). License keys are verified **offline** (Ed25519) — no account, server, or subscription.

**Activate in three steps:**

1. Buy the one-time Premium license from the link above.
2. Your license key is emailed to you **automatically, within seconds** — delivery is fully automated, no waiting.
3. Paste it into the plugin's **License** setting — Premium unlocks instantly, verified offline.

---

## How it works

### Tracking time
- **Start tracking active note** — begins a timer against the currently open note. The note's `client` and `project` frontmatter (configurable) tag the entry; if absent, a default client is used and the note name becomes the project.
- **Stop tracking** — closes the timer and records a time entry.
- A **status bar item** shows the running timer (`⏺ 0:12:34 · Acme Co`); click it to start/stop.
- Entries are stored locally in the plugin's `data.json` (alongside settings) — fully in your vault.

### Aggregation
- **Show tracked time totals** — summarizes hours by client.
- Aggregation also powers invoicing (totals broken down by project → invoice line items).

### Invoicing (premium)
- **Generate invoice (Premium)** — pick a client; the plugin builds a markdown invoice (one line item per project, configurable rounding) and saves it to your invoice folder, with business details and totals.
- **PDF export** is stubbed today (`exportPdfStub`) — it saves the markdown and points you to Obsidian's built-in *Export to PDF*. A real local PDF generator is left as a clean `TODO(pdf)`.

---

## Commands

- **Start tracking active note** (Lite)
- **Stop tracking** (Lite)
- **Toggle tracking (start/stop)** (Lite)
- **Show tracked time totals** (Lite)
- **Generate invoice (Premium)**
- **Verify license key**

Plus a ribbon **clock** icon to toggle tracking.

## Settings

Default hourly rate, currency, hours rounding, client/project frontmatter property names, and default client (all free). Business name/address/email and invoice folder are premium (invoice-only) and locked until licensed. License key lives under **License**.

> Keys are verified **offline with Ed25519 signatures** ([tweetnacl](https://www.npmjs.com/package/tweetnacl)) — no account, server, or network call, keeping the plugin 100% local. A key is `base64url(payload).base64url(signature)`, verified against the public key in `src/license/publicKey.ts`.

**Selling keys (author workflow):**

```bash
node scripts/keygen.mjs                 # one-time: create keypair
npm run license:generate -- buyer@email.com   # after a sale: mint a key
```

---

## Feedback and support

Bug reports, feature requests, and questions all go to the GitHub issue tracker. It is
the only place I track them, so an issue will always get further than a review comment.

- **[Report a bug](https://github.com/israerusan/time-tracker-invoicing/issues/new?labels=bug)** — please include your Obsidian version, your operating system, and the steps that reproduce it.
- **[Request a feature](https://github.com/israerusan/time-tracker-invoicing/issues/new?labels=enhancement)** — describe the workflow you are trying to make faster; that is more useful than a proposed solution.
- **[Browse open issues](https://github.com/israerusan/time-tracker-invoicing/issues)** — worth a look first, in case it is already tracked.

## More plugins by the same author

Small, local-first Obsidian plugins that each do one job and keep your data in your vault.
All of them are in the community directory — search the name under
**Settings → Community plugins**.

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
- [Invoice Forge](https://github.com/israerusan/obsidian-invoice-forge) — turn `#billable` notes into numbered invoices, so nothing is missed or billed twice.

---

## Build

```bash
npm install
npm run build      # bundles to main.js
npm run dev        # watch mode
npm run typecheck  # tsc --noEmit
npm test           # offline license verification tests
```

`npm run build` produces `main.js` next to `manifest.json` and `styles.css`.

### Install

**Community plugins (recommended):** open **Settings → Community plugins**, search **Time Tracker and Invoicing**, and install it — one click, auto-updates.

**Manual install** — copy `main.js`, `manifest.json`, and `styles.css` into:

```
<your-vault>/.obsidian/plugins/time-tracker-invoicing/
```

Then enable **Time Tracker & Invoicing** in *Settings → Community plugins*.

---

## Project layout

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
├── tests/
│   └── license.test.mjs   # offline license sign/verify round-trip
└── src/
    ├── main.ts            # entry, commands, status bar, persistence
    ├── settings.ts        # settings tab
    ├── license/
    │   ├── LicenseManager.ts  # offline Ed25519 verification
    │   └── publicKey.ts       # embedded public key
    ├── types/tweetnacl.d.ts   # minimal tweetnacl type shim
    ├── timeStore.ts       # entries, active timer, aggregation
    ├── invoice.ts         # invoice markdown generation + PDF stub (premium)
    └── types.ts           # shared interfaces & defaults
```

> **Reference:** the licensing approach, settings-tab patterns, build/test setup, and project layout are adapted from the [Vault Spotlight](https://github.com/israerusan) plugin — see "Borrowed from Vault Spotlight" notes in the repo.

## License

MIT (plugin source). Premium feature access is governed by a signed license key.
