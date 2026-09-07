import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

// src/bt-catalog.json is committed; regeneration needs the EN 16931 BT/BG reference sheet,
// which is not distributed with this repo. Point BT_REFERENCE_MD at your copy to rebuild.
const sourceDefault =
  "file:///Users/martin.dutzler/Documents/GitHub/E-Invoicing-Formats-and-Profiles/Outputted files/EN16931_BT_BG_Reference.md";
const sourceFile = new URL(process.env.BT_REFERENCE_MD ?? sourceDefault);
const outFile = new URL("../src/bt-catalog.json", import.meta.url);

const ID = /^(BG|BT)-\d+(\.\d+)?$/;
const PARENT = /Parent:\s*(BG-\d+)/;
const CARDINALITY = /Card(?:inality)?:\s*(\d\.\.[\dn])/;

function cell(value) {
  return value.replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
}

function parseRows(markdown) {
  const entries = [];
  const seen = new Set();
  for (const line of markdown.split("\n")) {
    if (!line.startsWith("|")) continue;
    const cells = line
      .slice(1, line.endsWith("|") ? -1 : undefined)
      .split("|")
      .map(cell);
    if (cells.length < 5) continue;
    const [id, name, cardinality, datatype, description, relationships = ""] = cells;
    if (!ID.test(id) || seen.has(id)) continue;
    seen.add(id);
    entries.push({
      id,
      group:
        id.startsWith("BG") && !PARENT.test(relationships)
          ? id
          : (PARENT.exec(relationships)?.[1] ?? ""),
      name,
      description,
      cardinality: cardinality || (CARDINALITY.exec(description)?.[1] ?? ""),
      datatype,
    });
  }
  return entries;
}

const markdown = await readFile(sourceFile, "utf8").catch((error) => {
  console.error(`build-bt-catalog: cannot read ${fileURLToPath(sourceFile)} - ${error.message}`);
  process.exit(1);
});

const entries = parseRows(markdown);
if (entries.length < 100) {
  console.error(
    `build-bt-catalog: only ${entries.length} entries parsed, expected the full BT/BG table`,
  );
  process.exit(1);
}

await writeFile(outFile, `${JSON.stringify(entries, null, 2)}\n`);
console.log(`build-bt-catalog: ${entries.length} entries -> src/bt-catalog.json`);
