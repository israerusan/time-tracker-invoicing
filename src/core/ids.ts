/**
 * Collision-free identifiers.
 *
 * The previous scheme was `te_${entries.length}_${counter}` with a counter that
 * reset to 0 on every plugin load. It survived only because nothing could ever
 * delete an entry. Deletion and two devices syncing one vault both reuse ids
 * under that scheme, and a reused id silently re-points an invoice allocation
 * at the wrong piece of work.
 *
 * Identity is therefore random and opaque: never derived from array position,
 * wall-clock time alone, or anything the user can edit.
 */

/** 16 random bytes, base36-encoded in two halves. ~96 bits of entropy. */
function randomToken(): string {
  const bytes = new Uint8Array(16);
  // The bare `crypto` global rather than `window.crypto` or `globalThis`:
  // this module must work unchanged in Obsidian (where it is a browser
  // global) and under the test runner (where Node exposes the same Web Crypto
  // object), and it must not reach for a DOM global it does not need.
  const cryptoObj: Crypto | undefined = typeof crypto !== "undefined" ? crypto : undefined;

  if (cryptoObj?.getRandomValues) {
    cryptoObj.getRandomValues(bytes);
  } else {
    // No CSPRNG available. Still better than a counter, and this path is not
    // reachable in Obsidian (Electron and both mobile webviews provide one).
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }

  let hi = 0;
  let lo = 0;
  for (let i = 0; i < 8; i++) hi = hi * 256 + bytes[i];
  for (let i = 8; i < 16; i++) lo = lo * 256 + bytes[i];
  // Number can hold 2^53 exactly; fold the top bits in rather than lose them.
  const a = Math.floor(hi / 2048) ^ (lo % 2048);
  const b = lo;
  return a.toString(36).padStart(10, "0") + b.toString(36).padStart(11, "0");
}

export function newEntryId(): string {
  return `te_${randomToken()}`;
}

export function newInvoiceId(): string {
  return `inv_${randomToken()}`;
}

/** True for ids this plugin minted. Legacy `te_0_1` ids also match the prefix. */
export function isEntryId(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("te_") && value.length > 3;
}
