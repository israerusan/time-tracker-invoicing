# Hero shot — what to capture

The community plugin page and the top of the README both want one image, and there isn't one yet.
It was not captured here because Obsidian cannot be driven from the environment this was written in,
and a mock-up, a generated picture or a hand-assembled "screenshot" would be a claim about what the
plugin looks like that nobody has checked. So: shoot it, save it as `docs/assets/hero.png`, and
un-comment the image line at the top of `README.md`.

One image. Two things must be legible in it: **a timer running on a real note**, and **an invoice
this plugin produced**.

## Setup

1. A throwaway vault, default theme, light mode (it reads better as a thumbnail than dark).
2. Install this plugin into it (`main.js`, `manifest.json`, `styles.css`) and enable it.
3. Paste a key so invoicing is unlocked, then in **Settings → Time Tracker and Invoicing**:
   - Default hourly rate `120`, currency `USD`, round hours to `0.25`
   - Business name something plausible and clearly not a real company — e.g. `Rivet & Co`
   - Invoice folder `Invoices`
4. A note called `Acme Co — Landing page.md` with properties:
   ```yaml
   ---
   client: Acme Co
   project: Landing page
   ---
   ```
   Give it a few lines of ordinary-looking work notes. No real client names, no real addresses, no
   real email in frame.
5. Track two or three blocks of time against two notes for `Acme Co` so the invoice has more than
   one line. (Fastest honest route: track for real across a couple of sessions, or edit the entry
   `start`/`end` values in the vault's `data.json` before issuing — the invoice is then still
   computed from the ledger.)
6. Run **Generate invoice** → `Acme Co` → **All unbilled time** → **Issue invoice**. It opens the
   invoice note.

## The frame

- Window about 1600 px wide, 1000 tall. Two panes side by side: the client note on the left, the
  generated invoice note on the right.
- **Bottom right, unmistakable:** the status bar mid-run — `0:12:34 · Acme Co`. Start the timer on
  the left-hand note just before the shot so it is genuinely counting.
- The invoice pane must show the heading (`# Invoice 2026-0001`), at least two line items with hours
  and amounts, and the **total**. Scroll it so the total is in frame; the total is the point.
- No vault names, file paths, personal folders or real email addresses visible in the sidebar, the
  title bar or the invoice.

## Save

- `docs/assets/hero.png`, PNG, 1600 px wide, under ~400 KB.
- Then in `README.md` replace the commented slot with:
  `![The status-bar timer running on a client note, beside a generated invoice](docs/assets/hero.png)`

## Worth having later

- A second, narrower shot of the **invoice preview** (the dialog listing lines, hours and total
  before anything is written). It is the strongest single screen in the plugin, and it is what the
  free tier can reach. `docs/assets/preview.png`.
