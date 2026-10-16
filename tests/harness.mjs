/**
 * Builds the pure modules once and hands them to the tests.
 *
 * The existing tests could not import the plugin's TypeScript at all, so the
 * only things under test were the license signature and the manifest's shape —
 * a billing product with no test over its arithmetic. This bridges that with
 * the toolchain already present (esbuild) instead of adding a test framework.
 *
 * `obsidian` is deliberately NOT marked external: these modules must not
 * import it, and a build failure here is exactly the signal we want.
 */
import esbuild from "esbuild";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let cached = null;

export async function loadCore() {
  if (cached) return cached;

  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "tti-test-"));
  const outFile = path.join(outDir, "core.mjs");

  await esbuild.build({
    entryPoints: [path.join(root, "tests/entry.ts")],
    bundle: true,
    format: "esm",
    platform: "neutral",
    target: "es2020",
    outfile: outFile,
    logLevel: "silent",
  });

  cached = await import(pathToFileURL(outFile).href);
  // Keep the file around for the process lifetime; remove the directory after.
  process.on("exit", () => {
    try {
      fs.rmSync(outDir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  });
  return cached;
}

/** Build a completed entry. Times are given in ISO strings for readability. */
export function entry(id, client, project, startIso, endIso) {
  return {
    id,
    filePath: `${project}.md`,
    fileName: project,
    client,
    project,
    start: new Date(startIso).getTime(),
    end: endIso === null ? null : new Date(endIso).getTime(),
  };
}

let cachedGlue = null;

/**
 * Build the Obsidian-facing glue with `obsidian` resolved to the fake vault.
 * This is the one place an `obsidian` import is deliberately allowed.
 */
export async function loadGlue() {
  if (cachedGlue) return cachedGlue;

  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "tti-glue-"));
  const outFile = path.join(outDir, "glue.mjs");
  // Resolved as an EXTERNAL import, not inlined. If esbuild bundled a copy,
  // the `TFile`/`TFolder` classes inside the glue would be different objects
  // from the ones a test imports, and every `instanceof` across that boundary
  // would silently be false.
  const shim = pathToFileURL(path.join(root, "tests/obsidianShim.mjs")).href;

  await esbuild.build({
    entryPoints: [path.join(root, "tests/glueEntry.ts")],
    bundle: true,
    format: "esm",
    // "node", not "neutral": the plugin has a real runtime dependency
    // (tweetnacl) that must resolve from node_modules.
    platform: "node",
    target: "es2020",
    outfile: outFile,
    logLevel: "silent",
    // tweetnacl's CJS build reaches for `require("crypto")` when it cannot
    // find a browser CSPRNG. ESM output has no `require`, so supply one.
    // Test-only: the shipped bundle is CJS and never takes this path.
    banner: {
      js: "import { createRequire as __tti_cr } from \"node:module\"; const require = __tti_cr(import.meta.url);",
    },
    plugins: [
      {
        name: "obsidian-fake",
        setup(build) {
          build.onResolve({ filter: /^obsidian$/ }, () => ({ path: shim, external: true }));
        },
      },
    ],
  });

  cachedGlue = await import(pathToFileURL(outFile).href);
  process.on("exit", () => {
    try {
      fs.rmSync(outDir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  });
  return cachedGlue;
}
