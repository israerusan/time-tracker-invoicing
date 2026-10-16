/**
 * Glyph widths for Helvetica and Helvetica-Bold, in 1/1000 em.
 *
 * Needed so money columns can be right-aligned and long descriptions wrapped.
 * The values are the standard Adobe AFM metrics for the two base-14 fonts.
 *
 * Accented composites are not listed separately because in these fonts they
 * are exactly the width of their base glyph (Aacute is an A with a mark drawn
 * above it, not a wider letter). Deriving them from ACCENT_BASE keeps ~90
 * numbers out of this file that would otherwise each be a chance to mistype a
 * digit and misalign a column.
 *
 * Caveat worth stating plainly: a viewer that substitutes its own
 * Helvetica-compatible face may measure slightly differently, so these widths
 * position text correctly but are not a guarantee of pixel-identical output
 * across viewers.
 */

export type FontName = "Helvetica" | "Helvetica-Bold";

/** Widths for WinAnsi bytes 0x20–0x7E, in order. */
const ASCII_REGULAR = [
  278, 278, 355, 556, 556, 889, 667, 222, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  222, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

const ASCII_BOLD = [
  278, 333, 474, 556, 556, 889, 722, 278, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
  278, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
  611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];

/** Non-letter glyphs at 0x80–0x9F and 0xA0–0xBF, plus the odd letters. */
const SPECIAL_REGULAR: Record<number, number> = {
  0x80: 556, 0x82: 222, 0x83: 556, 0x84: 333, 0x85: 1000, 0x86: 556, 0x87: 556,
  0x88: 333, 0x89: 1000, 0x8a: 667, 0x8b: 333, 0x8c: 1000, 0x8e: 611,
  0x91: 222, 0x92: 222, 0x93: 333, 0x94: 333, 0x95: 350, 0x96: 556, 0x97: 1000,
  0x98: 333, 0x99: 1000, 0x9a: 500, 0x9b: 333, 0x9c: 944, 0x9e: 500, 0x9f: 667,
  0xa0: 278, 0xa1: 333, 0xa2: 556, 0xa3: 556, 0xa4: 556, 0xa5: 556, 0xa6: 260,
  0xa7: 556, 0xa8: 333, 0xa9: 737, 0xaa: 370, 0xab: 556, 0xac: 584, 0xad: 333,
  0xae: 737, 0xaf: 333, 0xb0: 400, 0xb1: 584, 0xb2: 333, 0xb3: 333, 0xb4: 333,
  0xb5: 556, 0xb6: 537, 0xb7: 278, 0xb8: 333, 0xb9: 333, 0xba: 365, 0xbb: 556,
  0xbc: 834, 0xbd: 834, 0xbe: 834, 0xbf: 611,
  0xc6: 1000, 0xd0: 556, 0xd7: 584, 0xd8: 778, 0xde: 556, 0xdf: 611,
  0xe6: 889, 0xf0: 556, 0xf7: 584, 0xf8: 611, 0xfe: 556,
};

const SPECIAL_BOLD: Record<number, number> = {
  0x80: 556, 0x82: 278, 0x83: 556, 0x84: 500, 0x85: 1000, 0x86: 556, 0x87: 556,
  0x88: 333, 0x89: 1000, 0x8a: 667, 0x8b: 333, 0x8c: 1000, 0x8e: 611,
  0x91: 278, 0x92: 278, 0x93: 500, 0x94: 500, 0x95: 350, 0x96: 556, 0x97: 1000,
  0x98: 333, 0x99: 1000, 0x9a: 556, 0x9b: 333, 0x9c: 944, 0x9e: 500, 0x9f: 667,
  0xa0: 278, 0xa1: 333, 0xa2: 556, 0xa3: 556, 0xa4: 556, 0xa5: 556, 0xa6: 280,
  0xa7: 556, 0xa8: 333, 0xa9: 737, 0xaa: 370, 0xab: 556, 0xac: 584, 0xad: 333,
  0xae: 737, 0xaf: 333, 0xb0: 400, 0xb1: 584, 0xb2: 333, 0xb3: 333, 0xb4: 333,
  0xb5: 611, 0xb6: 556, 0xb7: 278, 0xb8: 333, 0xb9: 333, 0xba: 365, 0xbb: 556,
  0xbc: 834, 0xbd: 834, 0xbe: 834, 0xbf: 611,
  0xc6: 1000, 0xd0: 611, 0xd7: 584, 0xd8: 778, 0xde: 611, 0xdf: 611,
  0xe6: 889, 0xf0: 611, 0xf7: 584, 0xf8: 611, 0xfe: 611,
};

/**
 * Accented glyph -> the base glyph whose width it shares.
 * Covers 0xC0–0xFF apart from the entries listed in SPECIAL_* above.
 */
const ACCENT_BASE: Record<number, number> = {
  0xc0: 0x41, 0xc1: 0x41, 0xc2: 0x41, 0xc3: 0x41, 0xc4: 0x41, 0xc5: 0x41,
  0xc7: 0x43,
  0xc8: 0x45, 0xc9: 0x45, 0xca: 0x45, 0xcb: 0x45,
  0xcc: 0x49, 0xcd: 0x49, 0xce: 0x49, 0xcf: 0x49,
  0xd1: 0x4e,
  0xd2: 0x4f, 0xd3: 0x4f, 0xd4: 0x4f, 0xd5: 0x4f, 0xd6: 0x4f,
  0xd9: 0x55, 0xda: 0x55, 0xdb: 0x55, 0xdc: 0x55,
  0xdd: 0x59,
  0xe0: 0x61, 0xe1: 0x61, 0xe2: 0x61, 0xe3: 0x61, 0xe4: 0x61, 0xe5: 0x61,
  0xe7: 0x63,
  0xe8: 0x65, 0xe9: 0x65, 0xea: 0x65, 0xeb: 0x65,
  0xec: 0x69, 0xed: 0x69, 0xee: 0x69, 0xef: 0x69,
  0xf1: 0x6e,
  0xf2: 0x6f, 0xf3: 0x6f, 0xf4: 0x6f, 0xf5: 0x6f, 0xf6: 0x6f,
  0xf9: 0x75, 0xfa: 0x75, 0xfb: 0x75, 0xfc: 0x75,
  0xfd: 0x79, 0xff: 0x79,
};

function buildTable(ascii: number[], specials: Record<number, number>): number[] {
  const widths = new Array<number>(256).fill(0);
  for (let i = 0; i < ascii.length; i++) widths[0x20 + i] = ascii[i];
  for (const key of Object.keys(specials)) {
    widths[Number(key)] = specials[Number(key)];
  }
  for (const key of Object.keys(ACCENT_BASE)) {
    const code = Number(key);
    if (widths[code] === 0) widths[code] = widths[ACCENT_BASE[code]];
  }
  return widths;
}

const WIDTHS: Record<FontName, number[]> = {
  "Helvetica": buildTable(ASCII_REGULAR, SPECIAL_REGULAR),
  "Helvetica-Bold": buildTable(ASCII_BOLD, SPECIAL_BOLD),
};

/** Width of one WinAnsi byte, in 1/1000 em. Unknown bytes measure as a space. */
export function glyphWidth(font: FontName, byte: number): number {
  const w = WIDTHS[font][byte] ?? 0;
  return w === 0 ? WIDTHS[font][0x20] : w;
}

/** Width of an encoded string at a given point size, in points. */
export function measureBytes(font: FontName, bytes: readonly number[], size: number): number {
  let total = 0;
  for (const byte of bytes) total += glyphWidth(font, byte);
  return (total * size) / 1000;
}

/** Widths array for the font dictionary, covering bytes 32–255. */
export function widthsArray(font: FontName): number[] {
  return WIDTHS[font].slice(32, 256);
}
