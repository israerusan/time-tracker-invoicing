# Time Tracker & Invoicing

Track billable time against your notes and projects, aggregate it by client, and generate invoices — built for freelancers and consultants who live in Obsidian. **Fully local: no external API, no account, your data stays in your vault.**

> **Open-core / one-time purchase.** Time tracking is free forever in the Lite tier. Invoicing & PDF export unlock with a one-time license — **~$29–39 (one-time)**.

---

## Lite vs. Premium

| Feature | Lite (free) | Premium (~$29–39 one-time) |
| --- | :---: | :---: |
| Start/stop tracking on the active note | ✅ | ✅ |
| Live timer in the status bar | ✅ | ✅ |
| Client/project tagging via frontmatter | ✅ | ✅ |
| Totals by client (command) | ✅ | ✅ |
| **Invoice generation (markdown)** | — | ✅ |
| **PDF export** | — | ✅ (stub today) |

All **time tracking is free**. **Invoicing/PDF export is gated** behind the license check (`LicenseManager.isPremium()`).

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

Default hourly rate, currency, hours rounding, client/project frontmatter property names, default client, business name/address/email, and invoice folder. License key + validation endpoint live under **License**.

> License validation is **stubbed** for development (any key starting with `PREMIUM-` or ≥16 chars validates). Real billing via **Lemon Squeezy / Gumroad** is a clean `TODO(billing)` in `src/licenseManager.ts`.

---

## Build

```bash
npm install
npm run build      # type-checks then bundles to main.js
npm run dev        # watch mode
```

`npm run build` produces `main.js` next to `manifest.json` and `styles.css`.

### Install into a vault for testing

Copy `main.js`, `manifest.json`, and `styles.css` into:

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
└── src/
    ├── main.ts            # entry, commands, status bar, persistence
    ├── settings.ts        # settings tab
    ├── licenseManager.ts  # open-core license gate (stubbed network call)
    ├── timeStore.ts       # entries, active timer, aggregation
    ├── invoice.ts         # invoice markdown generation + PDF stub (premium)
    └── types.ts           # shared interfaces & defaults
```

## License

MIT (plugin source). Premium feature access is governed by a commercial license key.
