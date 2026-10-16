/**
 * A small stateful stand-in for the handful of Obsidian APIs `InvoiceWriter`
 * touches, with failure injection.
 *
 * The glue between the pure core and the vault is where this plugin's one
 * remaining transaction lives: write two files, then record the invoice. It
 * is also the part that had never executed. A fake is not as good as running
 * in Obsidian, but it exercises the real `InvoiceWriter` code against the
 * failures that matter — a create that rejects, a path already taken, a
 * folder that is actually a file — which no amount of typechecking covers.
 */

export class TFile {
  constructor(path) {
    this.path = path;
    const name = path.split("/").pop() ?? "";
    this.basename = name.replace(/\.[^.]+$/, "");
    this.extension = name.includes(".") ? name.split(".").pop() : "";
  }
}

export class TFolder {
  constructor(path) {
    this.path = path;
    this.children = [];
  }
}

export class FakeVault {
  constructor() {
    /** path -> TFile | TFolder */
    this.nodes = new Map();
    /** path -> string | Uint8Array */
    this.contents = new Map();
    /** Paths whose next create should reject, with the given message. */
    this.failCreates = new Map();
    /**
     * Paths whose next create should COMMIT and then reject — the case a
     * caller cannot distinguish from a create that did nothing, and the one
     * that produces a sendable invoice whose hours stay billable.
     */
    this.commitThenFail = new Map();
    this.createdOrder = [];
  }

  failOn(path, message = "injected failure") {
    this.failCreates.set(path, message);
  }

  /** The create reaches storage, then reports failure anyway. */
  commitThenFailOn(path, message = "write reported failure after committing") {
    this.commitThenFail.set(path, message);
  }

  getAbstractFileByPath(path) {
    return this.nodes.get(path) ?? null;
  }

  async createFolder(path) {
    if (this.failCreates.has(path)) {
      const message = this.failCreates.get(path);
      this.failCreates.delete(path);
      throw new Error(message);
    }
    if (this.nodes.has(path)) throw new Error(`Folder already exists: ${path}`);
    const folder = new TFolder(path);
    this.nodes.set(path, folder);
    return folder;
  }

  async create(path, data) {
    if (this.commitThenFail.has(path)) {
      const message = this.commitThenFail.get(path);
      this.commitThenFail.delete(path);
      this.nodes.set(path, new TFile(path));
      this.contents.set(path, data);
      this.createdOrder.push(path);
      throw new Error(message);
    }
    if (this.failCreates.has(path)) {
      const message = this.failCreates.get(path);
      this.failCreates.delete(path);
      throw new Error(message);
    }
    if (this.nodes.has(path)) throw new Error(`File already exists: ${path}`);
    const file = new TFile(path);
    this.nodes.set(path, file);
    this.contents.set(path, data);
    this.createdOrder.push(path);
    return file;
  }

  async createBinary(path, buffer) {
    const file = await this.create(path, new Uint8Array(buffer));
    return file;
  }

  /** Seed an existing file without going through create(). */
  seedFile(path, data = "") {
    this.nodes.set(path, new TFile(path));
    this.contents.set(path, data);
  }

  seedFolder(path) {
    this.nodes.set(path, new TFolder(path));
  }
}

export function fakeApp() {
  const vault = new FakeVault();
  return { app: { vault }, vault };
}

/** Obsidian's `normalizePath`, close enough for path assembly. */
export function normalizePath(path) {
  return path.replace(/\\/g, "/").replace(/\/{2,}/g, "/").replace(/^\/+|\/+$/g, "");
}
