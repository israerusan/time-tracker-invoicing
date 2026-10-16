/**
 * The `obsidian` module, as far as this plugin is concerned.
 *
 * The harness resolves `import ... from "obsidian"` here, so the real plugin
 * code runs unmodified against a fake vault, a fake DOM and a controllable
 * clock. Kept external to the test bundle so `instanceof` holds across the
 * boundary.
 */
export {
  TFile,
  TFolder,
  normalizePath,
  Notice,
  Modal,
  SuggestModal,
  FuzzySuggestModal,
  Setting,
  PluginSettingTab,
  Plugin,
  Component,
} from "./fakeObsidian.mjs";
