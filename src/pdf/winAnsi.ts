/**
 * WinAnsiEncoding (the PDF spec's variant of CP1252).
 *
 * The invoice PDF uses the 14 standard Type 1 fonts, which the viewer supplies
 * and which therefore need no font file embedded — that is what keeps this
 * feature a few kilobytes instead of a few hundred. The price is that only
 * this encoding's 224 characters can be drawn.
 *
 * That limit is enforced, not papered over. A client name containing a
 * character outside this table causes PDF export to REFUSE, naming the
 * characters it cannot draw. Transliterating or substituting them is not an
 * option available to a document that states a legal entity's name and asks
 * for money: "Müller GmbH" is inside Latin-1 and renders exactly, while
 * "株式会社アオイ" is not, and rendering it as "????" or "Kabushiki gaisha Aoi"
 * would be inventing a different company.
 */

/** Codes 0x80–0x9F, which are not Latin-1. Undefined slots are 0. */
const HIGH_SPECIALS: [number, number][] = [
  [0x80, 0x20ac], [0x82, 0x201a], [0x83, 0x0192], [0x84, 0x201e],
  [0x85, 0x2026], [0x86, 0x2020], [0x87, 0x2021], [0x88, 0x02c6],
  [0x89, 0x2030], [0x8a, 0x0160], [0x8b, 0x2039], [0x8c, 0x0152],
  [0x8e, 0x017d], [0x91, 0x2018], [0x92, 0x2019], [0x93, 0x201c],
  [0x94, 0x201d], [0x95, 0x2022], [0x96, 0x2013], [0x97, 0x2014],
  [0x98, 0x02dc], [0x99, 0x2122], [0x9a, 0x0161], [0x9b, 0x203a],
  [0x9c, 0x0153], [0x9e, 0x017e], [0x9f, 0x0178],
];

const UNICODE_TO_BYTE = new Map<number, number>();
const BYTE_TO_UNICODE = new Map<number, number>();

for (let code = 0x20; code <= 0x7e; code++) {
  UNICODE_TO_BYTE.set(code, code);
  BYTE_TO_UNICODE.set(code, code);
}
for (let code = 0xa0; code <= 0xff; code++) {
  UNICODE_TO_BYTE.set(code, code);
  BYTE_TO_UNICODE.set(code, code);
}
for (const [byte, unicode] of HIGH_SPECIALS) {
  UNICODE_TO_BYTE.set(unicode, byte);
  BYTE_TO_UNICODE.set(byte, unicode);
}
// A non-breaking space has no distinct glyph in this encoding; the spec maps it
// to the space glyph, and treating it as a plain space is both correct and what
// the user meant when they pasted it out of a web page.
UNICODE_TO_BYTE.set(0x00a0, 0x20);
// Likewise a soft hyphen renders as a hyphen.
UNICODE_TO_BYTE.set(0x00ad, 0x2d);

/** The WinAnsi byte for a code point, or null if the encoding has no glyph. */
export function toWinAnsiByte(codePoint: number): number | null {
  return UNICODE_TO_BYTE.get(codePoint) ?? null;
}

/** The Unicode code point a WinAnsi byte represents, for the ToUnicode map. */
export function fromWinAnsiByte(byte: number): number | null {
  return BYTE_TO_UNICODE.get(byte) ?? null;
}

/** Every WinAnsi byte that has a glyph, ascending. */
export function definedBytes(): number[] {
  return Array.from(BYTE_TO_UNICODE.keys()).sort((a, b) => a - b);
}

/**
 * Encode text to WinAnsi bytes.
 * Returns the characters that could not be encoded rather than dropping them,
 * so the caller can refuse the export and say precisely why.
 */
export function encodeWinAnsi(text: string): { bytes: number[]; unsupported: string[] } {
  const bytes: number[] = [];
  const unsupported: string[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp === undefined) continue;
    // Tabs and newlines are laid out by the caller, never drawn.
    if (ch === "\n" || ch === "\r" || ch === "\t") {
      bytes.push(0x20);
      continue;
    }
    const byte = toWinAnsiByte(cp);
    if (byte === null) {
      if (!unsupported.includes(ch)) unsupported.push(ch);
      continue;
    }
    bytes.push(byte);
  }
  return { bytes, unsupported };
}

/** Characters in `text` that cannot be drawn. Empty means the text is safe. */
export function unsupportedCharacters(text: string): string[] {
  return encodeWinAnsi(text).unsupported;
}
