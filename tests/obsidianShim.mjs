/**
 * The slice of the `obsidian` module that `src/invoice.ts` imports at runtime.
 * Types are erased by the compiler, so only the values are needed here.
 */
export { TFile, TFolder, normalizePath } from "./fakeVault.mjs";
export class Notice {
  constructor(message) {
    this.message = message;
  }
}
