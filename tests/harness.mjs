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
