/**
 * Test entry point.
 *
 * Re-exports every module that is supposed to be free of Obsidian. The test
 * harness bundles this WITHOUT marking `obsidian` external, so if one of these
 * modules ever grows an `import { ... } from "obsidian"` — directly or through
 * a barrel — the bundle fails to resolve and the test run stops. That is the
 * import boundary, enforced by the build rather than by a comment.
 */
export * from "../src/core/ids";
export * from "../src/core/money";
export * from "../src/core/text";
export * from "../src/core/period";
export * from "../src/core/intervals";
export * from "../src/core/invoiceModel";
export * from "../src/core/markdown";
export * from "../src/core/migrate";
export * from "../src/pdf/winAnsi";
export * from "../src/pdf/fontMetrics";
export * from "../src/pdf/pdfWriter";
export * from "../src/pdf/invoicePdf";
export { DEFAULT_SETTINGS, CURRENT_SCHEMA } from "../src/types";
