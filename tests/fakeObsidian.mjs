/**
 * Enough of Obsidian to run the actual plugin.
 *
 * `main.ts`, `settings.ts` and `ui/modals.ts` had never executed. They
 * typechecked and linted, which says nothing about whether `onload` throws,
 * whether the settings tab renders, or whether the invoice flow actually
 * reaches the vault. This supplies the slice of the API they touch — a tiny
 * DOM with Obsidian's `createEl`/`setText` extensions, `Plugin`, `Modal`,
 * the suggest modals, `Setting`, and `Notice` — so the real code can be
 * driven and its real failures observed.
 *
 * It is not Obsidian and does not pretend to be. It is the difference
 * between "compiles" and "runs".
 */
import { FakeVault, TFile, TFolder, normalizePath } from "./fakeVault.mjs";

export { FakeVault, TFile, TFolder, normalizePath };

// ---------------------------------------------------------------- DOM -----

export class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.attrs = {};
    this.classList = new Set();
    this.textContent = "";
    this.listeners = new Map();
    this.style = {};
    this.parentEl = null;
  }

  createEl(tag, opts = {}) {
    const el = new El(tag);
    if (opts.text !== undefined) el.textContent = opts.text;
    if (opts.cls) for (const c of String(opts.cls).split(/\s+/)) el.classList.add(c);
    if (opts.href !== undefined) el.attrs.href = opts.href;
    if (opts.attr) Object.assign(el.attrs, opts.attr);
    el.parentEl = this;
    this.children.push(el);
    return el;
  }

  createDiv(opts = {}) {
    return this.createEl("div", opts);
  }

  createSpan(opts = {}) {
    return this.createEl("span", opts);
  }

  setText(text) {
    this.textContent = String(text);
    this.children = [];
    return this;
  }

  appendText(text) {
    this.textContent += String(text);
    return this;
  }

  addClass(...cls) {
    for (const c of cls) this.classList.add(c);
    return this;
  }

  removeClass(...cls) {
    for (const c of cls) this.classList.delete(c);
    return this;
  }

  toggleClass(cls, on) {
    if (on) this.classList.add(cls);
    else this.classList.delete(cls);
    return this;
  }

  hasClass(cls) {
    return this.classList.has(cls);
  }

  setAttr(key, value) {
    this.attrs[key] = value;
    return this;
  }

  getAttr(key) {
    return this.attrs[key];
  }

  empty() {
    this.children = [];
    this.textContent = "";
    // Settings are rebuilt from scratch on every `display()`.
    this.settings = [];
    return this;
  }

  detach() {
    if (this.parentEl) {
      this.parentEl.children = this.parentEl.children.filter((c) => c !== this);
      this.parentEl = null;
    }
  }

  addEventListener(type, fn) {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }

  removeEventListener(type, fn) {
    const list = (this.listeners.get(type) ?? []).filter((f) => f !== fn);
    this.listeners.set(type, list);
  }

  /** Fire a listener the plugin registered, e.g. the license field's blur. */
  dispatch(type, event = {}) {
    for (const fn of this.listeners.get(type) ?? []) fn(event);
  }

  onClickEvent(fn) {
    this.addEventListener("click", fn);
    return this;
  }

  /** Every element in this subtree, including itself. */
  walk() {
    const out = [this];
    for (const child of this.children) out.push(...child.walk());
    return out;
  }

  /** All text in this subtree, joined — what a user would read. */
  allText() {
    return this.walk()
      .map((el) => el.textContent)
      .filter(Boolean)
      .join("\n");
  }
}

// -------------------------------------------------------------- Setting ---

class ValueComponent {
  constructor(kind) {
    this.kind = kind;
    this.value = "";
    this.placeholder = "";
    this.changeHandlers = [];
    this.inputEl = new El(kind === "textarea" ? "textarea" : "input");
    this.options = [];
  }

  setPlaceholder(text) {
    this.placeholder = text;
    return this;
  }

  setValue(value) {
    this.value = value;
    return this;
  }

  getValue() {
    return this.value;
  }

  onChange(fn) {
    this.changeHandlers.push(fn);
    return this;
  }

  addOption(value, label) {
    this.options.push({ value, label });
    return this;
  }

  setDisabled() {
    return this;
  }

  /** Drive it the way a user would: type, then let the handlers run. */
  type(value) {
    this.value = value;
    for (const fn of this.changeHandlers) fn(value);
    return this;
  }

  blur() {
    this.inputEl.dispatch("blur");
  }
}

class ButtonComponent {
  constructor() {
    this.text = "";
    this.cta = false;
    this.clickHandler = null;
    this.buttonEl = new El("button");
  }

  setButtonText(text) {
    this.text = text;
    this.buttonEl.setText(text);
    return this;
  }

  setCta() {
    this.cta = true;
    return this;
  }

  setIcon() {
    return this;
  }

  setTooltip() {
    return this;
  }

  onClick(fn) {
    this.clickHandler = fn;
    // Also wire it to the element, so a test can press the button by finding
    // it in the rendered tree rather than by reaching for the component.
    this.buttonEl.addEventListener("click", fn);
    return this;
  }

  click() {
    if (this.clickHandler) return this.clickHandler();
    return undefined;
  }
}

export class Setting {
  constructor(containerEl) {
    // Recorded so a test can reach the component behind a named row and
    // drive it the way a user would.
    containerEl.settings = containerEl.settings ?? [];
    containerEl.settings.push(this);
    this.settingEl = containerEl.createDiv({ cls: "setting-item" });
    this.infoEl = this.settingEl.createDiv({ cls: "setting-item-info" });
    this.nameEl = this.infoEl.createDiv({ cls: "setting-item-name" });
    this.descEl = this.infoEl.createDiv({ cls: "setting-item-description" });
    this.controlEl = this.settingEl.createDiv({ cls: "setting-item-control" });
    this.components = [];
    this.buttons = [];
    this.heading = false;
  }

  setName(name) {
    this.name = name;
    this.nameEl.setText(name);
    return this;
  }

  setDesc(desc) {
    this.desc = desc;
    this.descEl.setText(desc);
    return this;
  }

  setHeading() {
    this.heading = true;
    this.settingEl.addClass("setting-item-heading");
    return this;
  }

  setClass(cls) {
    this.settingEl.addClass(cls);
    return this;
  }

  addText(cb) {
    const c = new ValueComponent("text");
    this.components.push(c);
    cb(c);
    return this;
  }

  addTextArea(cb) {
    const c = new ValueComponent("textarea");
    this.components.push(c);
    cb(c);
    return this;
  }

  addToggle(cb) {
    const c = new ValueComponent("toggle");
    this.components.push(c);
    cb(c);
    return this;
  }

  addDropdown(cb) {
    const c = new ValueComponent("dropdown");
    this.components.push(c);
    cb(c);
    return this;
  }

  addButton(cb) {
    const b = new ButtonComponent();
    this.buttons.push(b);
    this.controlEl.children.push(b.buttonEl);
    cb(b);
    return this;
  }
}

// --------------------------------------------------------------- Modals ---

/** Every modal the plugin has opened, newest last. Tests drive these. */
export const openModals = [];

export class Modal {
  constructor(app) {
    this.app = app;
    this.contentEl = new El("div");
    this.containerEl = new El("div");
    this.isOpen = false;
  }

  open() {
    this.isOpen = true;
    openModals.push(this);
    if (this.onOpen) this.onOpen();
    return this;
  }

  close() {
    this.isOpen = false;
    if (this.onClose) this.onClose();
  }

  setPlaceholder(text) {
    this.placeholder = text;
  }

  /** Find a rendered button by its label, so a test can press it. */
  button(text) {
    const walk = (el) =>
      el.walk().find((e) => e.tagName === "BUTTON" && e.textContent === text);
    return walk(this.contentEl) ?? null;
  }
}

export class SuggestModal extends Modal {
  constructor(app) {
    super(app);
  }

  /** Pick the nth suggestion the way a user would. */
  choose(index = 0) {
    const items = this.getSuggestions("");
    const item = items[index];
    this.close();
    this.onChooseSuggestion(item, {});
    return item;
  }
}

export class FuzzySuggestModal extends Modal {
  constructor(app) {
    super(app);
  }

  choose(index = 0) {
    const items = this.getItems();
    const item = items[index];
    this.close();
    this.onChooseItem(item, {});
    return item;
  }

  chooseWhere(predicate) {
    const item = this.getItems().find(predicate);
    if (!item) throw new Error("no matching item in the picker");
    this.close();
    this.onChooseItem(item, {});
    return item;
  }
}

// --------------------------------------------------------------- Notice ---

/** Every Notice raised, in order. The plugin's only channel to the user. */
export const notices = [];

export class Notice {
  constructor(message, timeout) {
    this.message = String(message);
    this.timeout = timeout;
    notices.push(this);
  }

  setMessage(m) {
    this.message = String(m);
  }

  hide() {}
}

// --------------------------------------------------------------- Plugin ---

export class PluginSettingTab {
  constructor(app, plugin) {
    this.app = app;
    this.plugin = plugin;
    this.containerEl = new El("div");
  }
}

export class Component {
  constructor() {
    this.registered = [];
  }
}

export class Plugin {
  constructor(app, manifest) {
    this.app = app;
    this.manifest = manifest;
    this.commands = new Map();
    this.ribbonIcons = [];
    this.statusBarItems = [];
    this.settingTabs = [];
    this.registeredEvents = [];
    this.registeredIntervals = [];
    this._data = null;
    /** Set by a test to make the next saveData reject. */
    this.failNextSave = null;
  }

  addCommand(command) {
    this.commands.set(command.id, command);
    return command;
  }

  addRibbonIcon(icon, title, callback) {
    const el = new El("div");
    el.onClickEvent(callback);
    this.ribbonIcons.push({ icon, title, callback, el });
    return el;
  }

  addStatusBarItem() {
    const el = new El("div");
    this.statusBarItems.push(el);
    return el;
  }

  addSettingTab(tab) {
    this.settingTabs.push(tab);
    return tab;
  }

  registerEvent(ref) {
    this.registeredEvents.push(ref);
    return ref;
  }

  registerInterval(id) {
    this.registeredIntervals.push(id);
    return id;
  }

  registerDomEvent(el, type, fn) {
    el.addEventListener(type, fn);
  }

  async loadData() {
    return this._data;
  }

  async saveData(data) {
    if (this.failNextSave) {
      const message = this.failNextSave;
      this.failNextSave = null;
      throw new Error(message);
    }
    // Round-trip through JSON exactly as Obsidian does, so anything that is
    // not serialisable is caught here rather than in a user's vault.
    this._data = JSON.parse(JSON.stringify(data));
  }

  /** Run a registered command the way the palette would. */
  runCommand(id) {
    const command = this.commands.get(id);
    if (!command) throw new Error(`no command registered with id "${id}"`);
    if (command.checkCallback) {
      if (!command.checkCallback(true)) return false;
      command.checkCallback(false);
      return true;
    }
    return command.callback();
  }

  /** Whether a check-gated command would appear in the palette. */
  commandAvailable(id) {
    const command = this.commands.get(id);
    if (!command) return false;
    if (command.checkCallback) return command.checkCallback(true) === true;
    return true;
  }
}

// ------------------------------------------------------------------ App ---

class Workspace {
  constructor() {
    this.activeFile = null;
    this.opened = [];
    this.layoutReadyCallbacks = [];
  }

  getActiveFile() {
    return this.activeFile;
  }

  getLeaf() {
    return {
      openFile: async (file) => {
        this.opened.push(file.path);
      },
    };
  }

  onLayoutReady(cb) {
    this.layoutReadyCallbacks.push(cb);
  }

  /** Fire what Obsidian fires once the vault index is usable. */
  async triggerLayoutReady() {
    for (const cb of this.layoutReadyCallbacks) await cb();
  }
}

class MetadataCache {
  constructor() {
    this.frontmatter = new Map();
  }

  getFileCache(file) {
    const fm = this.frontmatter.get(file.path);
    return fm ? { frontmatter: fm } : null;
  }

  setFrontmatter(path, fm) {
    this.frontmatter.set(path, fm);
  }
}

class EventfulVault extends FakeVault {
  constructor() {
    super();
    this.handlers = new Map();
  }

  on(name, fn) {
    const list = this.handlers.get(name) ?? [];
    list.push(fn);
    this.handlers.set(name, list);
    return { name, fn };
  }

  /** Rename a file and fire the event the plugin listens for. */
  async rename(file, newPath) {
    const oldPath = file.path;
    this.nodes.delete(oldPath);
    const contents = this.contents.get(oldPath);
    this.contents.delete(oldPath);
    const moved = new TFile(newPath);
    this.nodes.set(newPath, moved);
    if (contents !== undefined) this.contents.set(newPath, contents);
    for (const fn of this.handlers.get("rename") ?? []) await fn(moved, oldPath);
    return moved;
  }
}

export function makeApp() {
  const vault = new EventfulVault();
  const workspace = new Workspace();
  const metadataCache = new MetadataCache();
  return { vault, workspace, metadataCache };
}

/** A tracked note, present in the vault and selected in the workspace. */
export function openNote(app, path, frontmatter = null) {
  const file = new TFile(path);
  app.vault.nodes.set(path, file);
  app.vault.contents.set(path, "");
  if (frontmatter) app.metadataCache.setFrontmatter(path, frontmatter);
  app.workspace.activeFile = file;
  return file;
}

// ------------------------------------------------------ timers / window ---

/**
 * A controllable clock. The plugin schedules a 1 Hz status-bar tick and a
 * 400 ms save debounce; both need to be driven deterministically, and the
 * ticker's lifecycle is one of the things under test.
 */
export class FakeTimers {
  constructor() {
    this.nextId = 1;
    this.intervals = new Map();
    this.timeouts = new Map();
  }

  install() {
    globalThis.window = {
      setInterval: (fn, ms) => {
        const id = this.nextId++;
        this.intervals.set(id, { fn, ms });
        return id;
      },
      clearInterval: (id) => this.intervals.delete(id),
      setTimeout: (fn, ms) => {
        const id = this.nextId++;
        this.timeouts.set(id, { fn, ms });
        return id;
      },
      clearTimeout: (id) => this.timeouts.delete(id),
      open: () => undefined,
    };
    return this;
  }

  uninstall() {
    delete globalThis.window;
  }

  /** How many repeating timers the plugin is holding right now. */
  activeIntervals() {
    return this.intervals.size;
  }

  tickIntervals() {
    for (const { fn } of [...this.intervals.values()]) fn();
  }

  /** Run every pending timeout, as the clock reaching their deadline would. */
  flushTimeouts() {
    const pending = [...this.timeouts.entries()];
    this.timeouts.clear();
    for (const [, { fn }] of pending) fn();
  }
}
