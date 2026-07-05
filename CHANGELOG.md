# Changelog

All notable changes to Time Tracker and Invoicing are documented here. This
project follows [Semantic Versioning](https://semver.org/).

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
