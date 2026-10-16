/**
 * Entry point for testing the Obsidian-facing glue.
 *
 * Unlike `tests/entry.ts`, this one DOES import modules that use the Obsidian
 * API. The harness resolves `obsidian` to a fake vault, so the real
 * `InvoiceWriter` runs against an in-memory file system and can be subjected
 * to the failures that only happen on somebody else's disk.
 */
export { InvoiceWriter } from "../src/invoice";
