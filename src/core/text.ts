/**
 * Escaping for every place user text is interpolated into a structured format.
 *
 * All three functions exist because the previous code built YAML, Markdown
 * tables and file paths with bare template literals. A client called
 * `Acme "Holdings"` produced invalid frontmatter; a project called
 * `Phase 1 | Phase 2` silently shifted every money column one cell to the
 * right; a client called `North/West` wrote the invoice into a folder nobody
 * was looking in.
 */

/**
 * A YAML double-quoted scalar. Always quoted, never bare — a bare scalar can
 * be reinterpreted as a boolean (`client: NO`), a number (`client: 1.0`), or a
 * null (`client: ~`), and YAML's bare-scalar rules are not worth encoding here.
 */
export function yamlScalar(value: string): string {
  let out = '"';
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    if (ch === '"') out += '\\"';
    else if (ch === "\\") out += "\\\\";
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else if (code < 0x20 || code === 0x7f) out += "\\x" + code.toString(16).padStart(2, "0");
    else out += ch;
  }
  return out + '"';
}

/**
 * One cell of a Markdown table. Pipes are escaped and newlines folded, because
 * a newline ends the row and a pipe starts a new cell — both corrupt the table
 * without any visible error.
 */
export function tableCell(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .replace(/\r\n|\r|\n/g, " ")
    .trim();
}

/** Windows device names that cannot be used as a file name on any path. */
const RESERVED = new Set([
  "CON", "PRN", "AUX", "NUL",
  "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
  "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
]);

/**
 * One path *component* — never a path. Separators are replaced rather than
 * stripped so `North/West` becomes `North-West` instead of `NorthWest`, and
 * `..` cannot survive to climb out of the invoice folder.
 */
export function fileNameComponent(value: string, fallback = "Unnamed"): string {
  let out = "";
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) out += " ";
    else if ('\\/:*?"<>|'.includes(ch)) out += "-";
    else out += ch;
  }
  // Collapse runs of whitespace and separators introduced above.
  out = out.replace(/\s+/g, " ").replace(/-{2,}/g, "-").trim();
  // `..` can no longer traverse anywhere now that separators are gone, but it
  // should not survive into a file name either.
  out = out.replace(/\.{2,}/g, ".");
  // Windows silently drops trailing dots and spaces, so a path built with one
  // would not be the path that ends up on disk. Strip both ends.
  out = out.replace(/^[-. ]+/g, "").replace(/[-. ]+$/g, "");
  if (RESERVED.has(out.toUpperCase())) out = `${out}_`;
  if (out.length > 80) out = out.slice(0, 80).trim();
  return out || fallback;
}
