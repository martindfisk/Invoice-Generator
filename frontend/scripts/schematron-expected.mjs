#!/usr/bin/env node
// Runs the currently built Schematron rule sets over tests/golden/* and prints a unified diff
// against the EXPECTED table pinned in tests/schematron-goldens.test.ts. Print-only, never
// writes: rule ids legitimately change between rule-set versions, and the point of EXPECTED is
// that every change is pasted in by a human with a justification. Run after a version bump
// (`make schemas && make sef`), review the diff, then update EXPECTED and the reviewed-version
// pin in the test together. Exit code: 0 in sync, 1 differences, 2 cannot run.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const FRONTEND = resolve(fileURLToPath(import.meta.url), "../..");
const SEF_DIR = join(FRONTEND, "public", "sef");
const GOLDEN = join(FRONTEND, "tests", "golden");
const TEST_FILE = join(FRONTEND, "tests", "schematron-goldens.test.ts");
const MANIFEST = join(SEF_DIR, "manifest.json");

const require = createRequire(join(FRONTEND, "package.json"));
const SaxonJS = require("saxon-js");

const SYNTAXES = [
  { syntax: "ubl", suffix: ".ubl.xml" },
  { syntax: "xrechnung", suffix: ".xrechnung.xml" },
  { syntax: "cii", suffix: ".cii.xml" },
];

// Mirrors SCHEMATRON_RULE_SETS in src/schematron-sets.ts; used when manifest.json is absent.
const FALLBACK_RULE_SETS = {
  ubl: ["cen-ubl", "peppol-ubl"],
  xrechnung: ["cen-ubl", "xrechnung-ubl"],
  cii: ["en16931-cii"],
};

// Mirrors severityOf in src/svrl.ts.
const SEVERITIES = {
  fatal: "fatal",
  error: "error",
  warning: "warning",
  warn: "warning",
  info: "info",
  information: "info",
};

function die(message) {
  console.error(`ERROR: ${message}`);
  process.exit(2);
}

function readManifest() {
  if (!existsSync(MANIFEST)) return null;
  try {
    const parsed = JSON.parse(readFileSync(MANIFEST, "utf8"));
    return Array.isArray(parsed.ruleSets) && parsed.ruleSets.length > 0 ? parsed : null;
  } catch {
    return null;
  }
}

function ruleSetPlan(manifest) {
  const map = {};
  const versions = new Map();
  for (const { syntax } of SYNTAXES) {
    const fromManifest = (manifest?.ruleSets ?? [])
      .filter((entry) => Array.isArray(entry.formats) && entry.formats.includes(syntax))
      .sort((a, b) => a.order - b.order)
      .map((entry) => entry.id);
    map[syntax] = fromManifest.length > 0 ? fromManifest : (FALLBACK_RULE_SETS[syntax] ?? []);
  }
  for (const entry of manifest?.ruleSets ?? []) versions.set(entry.id, entry.version);
  return { map, versions };
}

function extractExpected() {
  const source = readFileSync(TEST_FILE, "utf8");
  const match = /const EXPECTED[^=]*=\s*(\{[\s\S]*?\n\});/.exec(source);
  if (!match) die(`could not find the EXPECTED table in ${TEST_FILE}`);
  // The captured text is a plain JS object literal (comments and trailing commas included),
  // so evaluating it is exactly what tsc does — no hand-rolled parser to drift.
  return new Function(`"use strict"; return ${match[1]};`)();
}

const sheets = new Map();

function sheet(ruleSet) {
  let parsed = sheets.get(ruleSet);
  if (!parsed) {
    const file = join(SEF_DIR, `${ruleSet}.sef.json`);
    if (!existsSync(file)) die(`${file} is missing — run "make sef"`);
    parsed = JSON.parse(readFileSync(file, "utf8"));
    sheets.set(ruleSet, parsed);
  }
  return parsed;
}

async function firedBy(ruleSets, xml) {
  const fired = [];
  for (const ruleSet of ruleSets) {
    const result = SaxonJS.transform(
      { stylesheetInternal: sheet(ruleSet), sourceText: xml, destination: "serialized" },
      "sync",
    );
    const svrl = await SaxonJS.getResource({ type: "xml", text: result.principalResult });
    const nodes = SaxonJS.XPath.evaluate("//*:failed-assert | //*:successful-report", svrl, {
      resultForm: "array",
    });
    for (const node of nodes) {
      const attr = (name) => SaxonJS.XPath.evaluate(`string(@${name})`, node);
      const id = attr("id") || attr("role") || "(unnamed rule)";
      const severity = SEVERITIES[attr("flag").trim().toLowerCase()] || "error";
      fired.push(`${id}:${severity}`);
    }
  }
  return fired;
}

function renderTable(table) {
  const lines = [];
  for (const key of Object.keys(table).sort()) {
    if (table[key].length === 0) continue;
    lines.push(`${key}:`);
    for (const entry of table[key]) lines.push(`  ${entry}`);
  }
  return lines;
}

function lcs(a, b) {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const table = Array.from({ length: rows }, () => new Array(cols).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i][j] =
        a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  return table;
}

function diffOps(a, b) {
  const table = lcs(a, b);
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      ops.push([" ", a[i]]);
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      ops.push(["-", a[i]]);
      i += 1;
    } else {
      ops.push(["+", b[j]]);
      j += 1;
    }
  }
  while (i < a.length) ops.push(["-", a[i++]]);
  while (j < b.length) ops.push(["+", b[j++]]);
  return ops;
}

function unifiedDiff(a, b, context = 3) {
  const ops = diffOps(a, b);
  if (!ops.some(([kind]) => kind !== " ")) return [];
  const keep = new Array(ops.length).fill(false);
  ops.forEach(([kind], index) => {
    if (kind === " ") return;
    for (
      let k = Math.max(0, index - context);
      k <= Math.min(ops.length - 1, index + context);
      k += 1
    ) {
      keep[k] = true;
    }
  });
  const lines = [];
  let index = 0;
  let oldLine = 1;
  let newLine = 1;
  while (index < ops.length) {
    if (!keep[index]) {
      if (ops[index][0] !== "+") oldLine += 1;
      if (ops[index][0] !== "-") newLine += 1;
      index += 1;
      continue;
    }
    const start = index;
    let end = index;
    while (end < ops.length && keep[end]) end += 1;
    const hunk = ops.slice(start, end);
    const oldCount = hunk.filter(([kind]) => kind !== "+").length;
    const newCount = hunk.filter(([kind]) => kind !== "-").length;
    lines.push(`@@ -${oldLine},${oldCount} +${newLine},${newCount} @@`);
    for (const [kind, text] of hunk) {
      lines.push(`${kind}${text}`);
      if (kind !== "+") oldLine += 1;
      if (kind !== "-") newLine += 1;
    }
    index = end;
  }
  return lines;
}

async function main() {
  if (!existsSync(SEF_DIR)) die(`${SEF_DIR} is missing — run "make sef"`);
  const manifest = readManifest();
  const { map, versions } = ruleSetPlan(manifest);

  const plan = SYNTAXES.map(({ syntax }) => {
    const named = map[syntax].map((id) => {
      const version = versions.get(id);
      return version ? `${id} ${version}` : id;
    });
    return `${syntax} -> ${named.join(", ")}`;
  }).join("; ");
  console.log(`Rule sets: ${plan}`);
  console.log(
    manifest
      ? `Versions from public/sef/manifest.json (generated ${manifest.generatedAt ?? "?"}).`
      : "public/sef/manifest.json is missing — run `make sef`; versions unknown, built-in rule-set list used.",
  );

  const actual = {};
  let goldenCount = 0;
  for (const { syntax, suffix } of SYNTAXES) {
    const files = readdirSync(GOLDEN)
      .filter((name) => name.endsWith(suffix))
      .sort();
    for (const file of files) {
      goldenCount += 1;
      actual[file] = await firedBy(map[syntax], readFileSync(join(GOLDEN, file), "utf8"));
    }
  }

  const expected = extractExpected();
  const diff = unifiedDiff(renderTable(expected), renderTable(actual));
  console.log(`\n--- EXPECTED (tests/schematron-goldens.test.ts)`);
  console.log(`+++ current rule sets over tests/golden (${goldenCount} goldens)`);
  if (diff.length === 0) {
    console.log("\nNo differences — EXPECTED matches the current rule sets.");
    return 0;
  }
  for (const line of diff) console.log(line);
  console.log(
    "\nReview each change, then paste the new expectations into EXPECTED in " +
      "tests/schematron-goldens.test.ts with a justification per change, and update " +
      "REVIEWED_RULE_SET_VERSIONS in the same commit.",
  );
  return 1;
}

main().then(
  (code) => process.exit(code),
  (error) => die(error?.stack ?? String(error)),
);
