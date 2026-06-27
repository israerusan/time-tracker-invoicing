# Borrowed from Vault Spotlight

This plugin was scaffolded fresh, but its conventions are adapted from the
existing **Vault Spotlight** plugin (`C:\Users\iavil\obsidian-vault-spotlight`),
a shipped paid Obsidian plugin. What we took and why:

## Licensing (the big one)
- **Offline Ed25519 verification** instead of a stubbed network call. A key is
  `base64url(payload).base64url(sig)`, verified locally with
  [tweetnacl](https://www.npmjs.com/package/tweetnacl) against an embedded
  public key. This is an especially good fit here — the plugin is advertised as
  **fully local**, and offline licensing keeps that promise (the original stub
  "called" a remote endpoint).
  → `src/license/LicenseManager.ts`, `src/license/publicKey.ts`
- **`base64ToBytes` helper** copied verbatim.
- **Minimal `tweetnacl` type shim** → `src/types/tweetnacl.d.ts`.
- **Author tooling**: `scripts/generate-license.mjs` + `customer-license-template.txt`,
  plus an added `scripts/keygen.mjs` so the keypair flow is reproducible.
  Private key is gitignored.
- **`isPro` / `licenseEmail` cached in settings**, re-verified by
  `refreshLicense()` on load and on key change.

## Settings tab patterns
- `new Setting(...).setName(...).setHeading()` section headers.
- **License status block** with a purchase link + configurable `purchaseUrl`.
- **Locked premium rows**: the reference's `proSearch()` helper (renamed
  `premium()`) greys out invoice-only settings with a "(Premium)" hint until
  licensed (`.tti-setting-locked`). Applied to business identity + invoice folder.
- `refreshLicense().then(() => this.display())` to re-render on key change.

## main.ts patterns
- `settings: T = DEFAULT_SETTINGS` and the `loadData()` unknown-guard.
- **`checkCallback` gating** for the "Generate invoice" command so it's hidden
  from the palette without a license.
- `void this.saveAll()` fire-and-forget pattern.

## Build / project setup
- `esbuild.config.mjs` shape, `tsconfig.json` (`**/*.d.ts` include).
- `package.json`: `"type": "module"`, `tweetnacl` dep, `test` +
  `license:generate` scripts, esbuild-only `build` + separate `typecheck`.
- `.gitignore` that **commits `main.js`** and ignores
  `scripts/.license-private.key`.
- **`.github/workflows/release.yml`** tag-driven release.
- `tests/license.test.mjs` mirroring the sign→verify round-trip (+ tamper check).

## Not borrowed
- Search internals (ripgrep/fuzzy/canvas/PDF) — irrelevant here.
- The feature set; time tracking, aggregation, and invoicing are original.
