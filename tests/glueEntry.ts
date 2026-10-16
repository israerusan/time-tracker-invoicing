/**
 * Entry point for testing the Obsidian-facing code.
 *
 * Unlike `tests/entry.ts`, this one DOES import modules that use the Obsidian
 * API — including the plugin itself. The harness resolves `obsidian` to a
 * fake, so `onload`, the commands, the settings tab and the invoice flow all
 * really execute.
 */
export { InvoiceWriter } from "../src/invoice";
export { TimeStore } from "../src/timeStore";
export { TimeTrackerSettingTab } from "../src/settings";
export { default as TimeTrackerPlugin } from "../src/main";
