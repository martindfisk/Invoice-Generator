import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import openapiTS, { astToString } from "openapi-typescript";

const specDir = new URL("../../spec/", import.meta.url);
const manifestFile = new URL("spec.json", specDir);
const outFile = new URL("../src/gen/uapi.d.ts", import.meta.url);

async function activeSpec() {
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestFile, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  if (manifest.spec) return manifest.spec.file;
  return manifest.fallback?.find((entry) => entry.country === "it")?.file ?? null;
}

const active = await activeSpec();
if (!active) {
  console.error(
    `gen-types: no active spec recorded in ${fileURLToPath(manifestFile)} - run tools/fetch_spec.py (make spec) first.`,
  );
  process.exit(1);
}

const ast = await openapiTS(new URL(active, specDir));
await mkdir(new URL("./", outFile), { recursive: true });
await writeFile(outFile, astToString(ast));
console.log(`gen-types: ${active} -> src/gen/uapi.d.ts`);
