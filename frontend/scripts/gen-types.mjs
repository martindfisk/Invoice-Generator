import { mkdir, readdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import openapiTS, { astToString } from "openapi-typescript";

const specDir = new URL("../../spec/", import.meta.url);
const outFile = new URL("../src/gen/uapi.d.ts", import.meta.url);
const pattern = /^fiskaly\.uapi\.e-invoice-it\.\d{4}-\d{2}-\d{2}\.yaml$/;

async function listSpecs() {
  try {
    return (await readdir(specDir)).filter((name) => pattern.test(name)).sort();
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

const specs = await listSpecs();
if (specs.length === 0) {
  console.error(
    `gen-types: no fiskaly.uapi.e-invoice-it.<version>.yaml in ${fileURLToPath(specDir)} - run tools/fetch_spec.py (make spec) first.`,
  );
  process.exit(1);
}

const latest = specs.at(-1);
const ast = await openapiTS(new URL(latest, specDir));
await mkdir(new URL("./", outFile), { recursive: true });
await writeFile(outFile, astToString(ast));
console.log(`gen-types: ${latest} -> src/gen/uapi.d.ts`);
