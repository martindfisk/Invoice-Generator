import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

// Renders docs/handbook/04-mapping-reference.md from the mapping tables, loss tables and fate
// evidence that live as data in frontend/src — the tables in the handbook can therefore never
// drift from the code. `--check` regenerates in memory and fails (exit 1) when the committed
// file is stale; exit 2 means the generator itself could not run (same codes as gap-report.mjs).

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const OUT = join(ROOT, "docs", "handbook", "04-mapping-reference.md");
const check = process.argv.includes("--check");

function cannotRun(message) {
  console.error(`handbook-reference: ${message}`);
  process.exit(2);
}

async function load() {
  const server = await createServer({
    root: join(ROOT, "frontend"),
    server: { middlewareMode: true },
    appType: "custom",
    logLevel: "warn",
  });
  try {
    return {
      formats: await server.ssrLoadModule("/src/formats.ts"),
      uapiMap: await server.ssrLoadModule("/src/uapi-map.ts"),
      fates: await server.ssrLoadModule("/src/uapi-field-fate.ts"),
      close: () => server.close(),
    };
  } catch (error) {
    await server.close();
    cannotRun(`could not load the mapping modules: ${error.message}`);
  }
}

const esc = (text) =>
  String(text ?? "")
    .replaceAll("|", "\\|")
    .replaceAll("\n", " ");
const code = (text) => (text === "" || text == null ? "—" : `\`${esc(text)}\``);

function mappingTable(rows) {
  const lines = [
    "| Model field | Document path | BT / FPA | Meaning |",
    "| --- | --- | --- | --- |",
  ];
  for (const row of rows) {
    const term = [row.bt, row.fpa].filter(Boolean).join(" · ") || "—";
    lines.push(`| ${code(row.field)} | ${code(row.path)} | ${term} | ${esc(row.label)} |`);
  }
  return lines.join("\n");
}

function lossTable(byReason) {
  const lines = ["| Reason (verbatim from the loss table) | Model fields |", "| --- | --- |"];
  for (const [reason, fields] of Object.entries(byReason)) {
    lines.push(`| ${esc(reason)} | ${fields.map((f) => `\`${esc(f)}\``).join(", ")} |`);
  }
  return lines.join("\n");
}

function fateTable(entries) {
  const lines = [
    "| Operation pointer | Fate | XML element | Evidence note |",
    "| --- | --- | --- | --- |",
  ];
  for (const entry of entries) {
    lines.push(
      `| ${code(entry.pointer)} | **${entry.fate}** | ${code(entry.element)} | ${esc(entry.note)} |`,
    );
  }
  return lines.join("\n");
}

function render({ formats, uapiMap, fates }) {
  const registry = Object.values(formats.FORMATS);
  const parts = [
    "# Mapping reference",
    "",
    "<!-- GENERATED FILE — do not edit by hand. -->",
    "<!-- Source: frontend/src/{ubl,fatturapa,cii,xrechnung}-map.ts, uapi-map.ts, uapi-field-fate.ts. -->",
    "<!-- Regenerate with `make handbook`; `make handbook-check` fails CI when this file is stale. -->",
    "",
    "Every table below is rendered from the mapping data the writers themselves consume, so this",
    "reference cannot drift from the code. Concepts (how the tables are used, what lossiness and",
    "fates mean) live in [03 — Mappings](03-mappings.md); this chapter is the lookup.",
    "",
    'Reading the tables: **Model field** is the canonical `Invoice` `FieldId` (`""` / — means the',
    "element is a constant of the format, authored by the writer, not by a field). `{i}` marks a",
    "repeating group (invoice lines, VAT breakdown rows, recipients). **BT-x** ids are EN 16931",
    "business terms; **FPA** paths are FatturaPA blocks (specs 1.9.1).",
    "",
  ];

  for (const plugin of registry) {
    parts.push(
      `## ${plugin.label} (\`${plugin.id}\`)`,
      "",
      `XSD tier: ${plugin.xsdSchemaKey ? `\`${plugin.xsdSchemaKey}\`` : "none vendored — Schematron is the structural tier"} · ` +
        `declared validation stages: ${plugin.validationStages.map((s) => `\`${s}\``).join(", ")}`,
      "",
      mappingTable(plugin.map),
      "",
    );
  }

  parts.push(
    "## fiskaly JSON operation (`TRANSACTION::INVOICE`)",
    "",
    "The operation is composed by `toInvoiceTransaction` (`frontend/src/uapi-map.ts`); most model",
    "fields map structurally in code rather than through a row table. The tables here are the",
    "declared *extras and exceptions*: UAPI-only fields, and what the operation cannot carry.",
    "",
    "### UAPI-only fields (operation pointer → model field)",
    "",
    "Fields that exist because the operation offers them, addressed by JSON Pointer (`{i}` = any",
    "array index):",
    "",
    (() => {
      const lines = ["| Operation pointer | Model field |", "| --- | --- |"];
      for (const [pointer, field] of Object.entries(uapiMap.UAPI_POINTER_FIELDS)) {
        lines.push(`| ${code(pointer)} | ${code(field)} |`);
      }
      return lines.join("\n");
    })(),
    "",
    "### Lossy: model fields the operation cannot carry at all",
    "",
    lossTable(uapiMap.UAPI_LOSSY_FIELDS),
    "",
    "### Partial: model fields the operation carries incompletely",
    "",
    lossTable(uapiMap.UAPI_PARTIAL_FIELDS),
    "",
    "## Field fates (FatturaPA gateway evidence)",
    "",
    "What fiskaly's gateway actually did with each operation field in the captured exchange of",
    "2026-08-25 (`docs/reference/fatturapa/`). Scope: the Italian path only; a pointer that is",
    "absent here means *no evidence*, never *safe*. Fates: **mapped** reaches the XML ·",
    "**not-rendered** produces no element · **discarded** accepted then thrown away ·",
    "**platform** comes from the Taxpayer/System entity, not from the payload.",
    "",
    fateTable(fates.FATTURAPA_FATES),
    "",
  );

  return parts.join("\n");
}

const { close, ...modules } = await load();
try {
  const rendered = render(modules);
  if (check) {
    let committed = "";
    try {
      committed = readFileSync(OUT, "utf8");
    } catch {
      console.error(`handbook-check: ${OUT} is missing — run: make handbook`);
      process.exit(1);
    }
    if (committed !== rendered) {
      console.error(
        "handbook-check: docs/handbook/04-mapping-reference.md is stale — run: make handbook",
      );
      process.exit(1);
    }
    console.log("handbook-check: mapping reference in sync with frontend/src");
  } else {
    writeFileSync(OUT, rendered);
    console.log(`handbook: wrote ${OUT}`);
  }
} finally {
  await close();
}
