#!/usr/bin/env node
// Spike M1(b): prove SaxonJS executes the official EN 16931 / Peppol XSLT 2.0 rule sets
// from the compiled SEF, and that a BR-xx unit fixture yields exactly its rule id.
// Plain node (not Vitest) - run: node scripts/schematron-smoke.mjs
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const FRONTEND = resolve(fileURLToPath(import.meta.url), "../..");
const SEF_DIR = join(FRONTEND, "public", "sef");
// The unit fixtures are vendored (tests/fixtures/cen-br, EUPL-1.2). The positive full-invoice
// document defaults to this repo's own schematron-clean golden; point EN16931_DIR at a clone of
// the CEN validation artefacts to use the official BIS3_Invoice_positive example instead.
const EN16931 = process.env.EN16931_DIR ?? "";
const UNIT = join(FRONTEND, "tests", "fixtures", "cen-br");
const POSITIVE = EN16931
  ? join(EN16931, "ubl", "examples", "BIS3_Invoice_positive.XML")
  : join(FRONTEND, "tests", "golden", "be-peppol.ubl.xml");
const POSITIVE_NAME = EN16931 ? "BIS3_Invoice_positive" : "be-peppol golden";

// The SEFs actually shipped since 2026-09-03 (en16931-ubl/xrechnung-cii were dropped as
// unreachable — ADR-0007).
const SEFS = ["peppol-ubl.sef.json", "cen-ubl.sef.json", "xrechnung-ubl.sef.json"];
// The BE golden is a Peppol invoice, so XRechnung's German CIUS rules rightly fire on it: only
// assert "clean" for the rule sets the fixture actually targets. All three still must execute.
const CLEAN_SEFS = new Set(["peppol-ubl.sef.json", "cen-ubl.sef.json"]);
// One fixture per rule family: a plain BR-*, a calculation rule, a VAT-category rule.
const UNIT_FIXTURES = ["BR-16.xml", "BR-CO-15.xml", "BR-S-08-1.xml"];

const require = createRequire(join(FRONTEND, "package.json"));
const SaxonJS = require("saxon-js");

const SVRL = "http://purl.oclc.org/dsdl/svrl";
const results = [];
const checks = [];

function check(name, ok, detail) {
  checks.push({ name, ok, detail });
}

function need(path, hint) {
  if (!existsSync(path)) {
    console.error(`ERROR: ${path} missing - ${hint}`);
    process.exit(1);
  }
  return path;
}

async function parse(text) {
  return SaxonJS.getResource({ type: "xml", text });
}

// The CEN unit fixtures are vefa-validator <testSet> documents: each <test> holds an inline
// <Invoice>/<CreditNote> plus the rule id it must trigger (<error>) or satisfy (<success>).
// The documents are deliberate fragments, so every other mandatory-content rule fires too -
// vefa scopes the assertion to the one rule id (<assert><scope>), and so do we.
async function unitCases(file, kind) {
  const doc = await parse(readFileSync(file, "utf8"));
  const tests = SaxonJS.XPath.evaluate(`//*:test[*:assert/*:${kind}]`, doc, {
    resultForm: "array",
  });
  return tests.map((t) => {
    const doc2 = SaxonJS.XPath.evaluate(
      "*[local-name()='Invoice' or local-name()='CreditNote'][1]",
      t,
    );
    return {
      expected: SaxonJS.XPath.evaluate(`string(*:assert/*:${kind}[1])`, t),
      description: SaxonJS.XPath.evaluate("normalize-space(string(*:assert/*:description[1]))", t),
      xml: SaxonJS.serialize(doc2, { method: "xml", indent: false, "omit-xml-declaration": true }),
    };
  });
}

async function run(sef, xml) {
  const started = performance.now();
  const out = await SaxonJS.transform(
    { stylesheetFileName: join(SEF_DIR, sef), sourceText: xml, destination: "serialized" },
    "async",
  );
  const ms = performance.now() - started;
  const svrl = await parse(out.principalResult);
  const asserts = SaxonJS.XPath.evaluate("//*:failed-assert", svrl, { resultForm: "array" });
  const attr = (n, name) => SaxonJS.XPath.evaluate(`string(@${name})`, n);
  return {
    ms,
    fired: SaxonJS.XPath.evaluate("count(//*:fired-rule)", svrl),
    root: SaxonJS.XPath.evaluate("local-name(/*)", svrl),
    rootNs: SaxonJS.XPath.evaluate("namespace-uri(/*)", svrl),
    findings: asserts.map((a) => ({
      id: attr(a, "id"),
      flag: attr(a, "flag"),
      location: attr(a, "location"),
      test: attr(a, "test"),
      text: SaxonJS.XPath.evaluate("normalize-space(string(*:text))", a),
    })),
  };
}

function table(rows) {
  const head = ["fixture", "sef", "case", "failed-assert", "scoped rule", "result", "ms"];
  const body = rows.map((r) => [
    r.fixture,
    r.sef.replace(".sef.json", ""),
    r.kind,
    String(r.findings.length),
    r.expected || "-",
    r.result,
    r.ms.toFixed(0),
  ]);
  const w = head.map((h, i) => Math.max(h.length, ...body.map((b) => b[i].length)));
  const line = (cells) => "  " + cells.map((c, i) => c.padEnd(w[i])).join("  ");
  console.log(line(head));
  console.log("  " + w.map((n) => "-".repeat(n)).join("  "));
  body.forEach((b) => console.log(line(b)));
}

async function main() {
  need(SEF_DIR, "run: make sef");
  SEFS.forEach((s) => need(join(SEF_DIR, s), "run: make sef"));
  need(POSITIVE, "positive fixture not found - set EN16931_DIR or run from a full checkout");
  UNIT_FIXTURES.forEach((f) => need(join(UNIT, f), "EN 16931 unit fixtures not found"));

  console.log(`saxon-js ${require("saxon-js/package.json").version}, node ${process.version}\n`);

  const rows = [];
  const positiveXml = readFileSync(POSITIVE, "utf8");

  // (a) does SaxonJS actually execute these XSLT 2.0 stylesheets?
  for (const sef of SEFS) {
    const cold = await run(sef, positiveXml);
    const warm = await run(sef, positiveXml);
    rows.push({
      fixture: POSITIVE_NAME,
      sef,
      kind: "valid",
      expected: "",
      result: cold.findings.length === 0 ? "clean" : "DIRTY",
      ...cold,
    });
    results.push({ sef, cold: cold.ms, warm: warm.ms });
    check(
      `${sef} executes (SVRL root, rules fired)`,
      cold.root === "schematron-output" && cold.rootNs === SVRL && cold.fired > 0,
      `root {${cold.rootNs}}${cold.root}, ${cold.fired} fired-rule`,
    );
    if (CLEAN_SEFS.has(sef)) {
      check(
        `${sef} clean on positive fixture`,
        cold.findings.length === 0,
        cold.findings.map((f) => f.id).join(", ") || "0 failed-assert",
      );
    }
  }

  // (b) does a BR-xx fixture yield exactly its rule id (scoped to that id)?
  const detail = [];
  for (const file of UNIT_FIXTURES) {
    for (const kind of ["error", "success"]) {
      const cases = await unitCases(join(UNIT, file), kind);
      if (cases.length === 0) {
        check(`${file} has a <${kind}> case`, false, `no <test> with <assert><${kind}>`);
        continue;
      }
      const c = cases[0];
      for (const sef of ["cen-ubl.sef.json"]) {
        const r = await run(sef, c.xml);
        const fired = r.findings.some((f) => f.id === c.expected);
        const ok = kind === "error" ? fired : !fired;
        rows.push({
          fixture: file.replace(".xml", ""),
          sef,
          kind,
          expected: c.expected,
          result: fired ? "fired" : "absent",
          ...r,
        });
        check(
          `${file} <${kind}> ${c.expected} ${kind === "error" ? "fires" : "stays silent"} ` +
            `(${sef.replace(".sef.json", "")})`,
          ok,
          `${r.findings.length} failed-assert, ${c.expected} ${fired ? "fired" : "absent"}`,
        );
        if (sef === "cen-ubl.sef.json" && kind === "error") {
          detail.push({ file, expected: c.expected, description: c.description, ...r });
        }
      }
    }
  }

  console.log("Smoke table\n");
  table(rows);

  console.log("\nFindings detail (cen-ubl, <error> cases: @id / @flag / @location)\n");
  for (const d of detail) {
    console.log(`  ${d.file} - expects ${d.expected} - "${d.description}"`);
    for (const f of d.findings) {
      console.log(`    ${f.id.padEnd(10)} ${(f.flag || "-").padEnd(8)} ${f.location}`);
    }
    console.log("");
  }

  const sample = detail
    .flatMap((d) => d.findings)
    .find((f) => f.location && f.location.includes("/", 2));
  console.log("\nRaw SVRL @location (what xml-locate.ts must normalise)\n");
  console.log(`  ${sample ? sample.location : "(no failed-assert produced a @location)"}`);
  if (sample)
    console.log(`  id=${sample.id} flag=${sample.flag || "(none)"}\n  test=${sample.test}`);

  console.log(
    "\nSizes and timings (what the browser pays: JSON.parse of the SEF, then transforms)\n",
  );
  for (const s of SEFS) {
    const buf = readFileSync(join(SEF_DIR, s));
    const t = results.find((r) => r.sef === s);
    let mark = performance.now();
    const internal = JSON.parse(buf.toString("utf8"));
    const parseMs = performance.now() - mark;
    mark = performance.now();
    await SaxonJS.transform(
      { stylesheetInternal: internal, sourceText: positiveXml, destination: "serialized" },
      "async",
    );
    const firstMs = performance.now() - mark;
    mark = performance.now();
    await SaxonJS.transform(
      { stylesheetInternal: internal, sourceText: positiveXml, destination: "serialized" },
      "async",
    );
    const warmMs = performance.now() - mark;
    console.log(
      `  ${s.padEnd(22)} ${(buf.length / 1e6).toFixed(2)} MB raw  ` +
        `${(gzipSync(buf, { level: 9 }).length / 1024).toFixed(0).padStart(3)} kB gzip  ` +
        `JSON.parse ${parseMs.toFixed(0).padStart(3)} ms  ` +
        `1st ${firstMs.toFixed(0).padStart(3)} ms  warm ${warmMs.toFixed(0).padStart(3)} ms  ` +
        `(from file: ${t.cold.toFixed(0)}/${t.warm.toFixed(0)} ms)`,
    );
  }
  const node = readFileSync(require.resolve("saxon-js"));
  console.log(
    `  ${"SaxonJS2N.js (node)".padEnd(22)} ${(node.length / 1e6).toFixed(2)} MB raw  ` +
      `${(gzipSync(node, { level: 9 }).length / 1024).toFixed(0).padStart(3)} kB gzip  ` +
      `<- npm saxon-js ships the Node build only; the browser needs SaxonJS2.rt.js from Saxonica`,
  );

  console.log("\nVerdict\n");
  let failed = 0;
  for (const c of checks) {
    if (!c.ok) failed += 1;
    console.log(`  ${c.ok ? "PASS" : "FAIL"}  ${c.name}  [${c.detail}]`);
  }
  console.log(
    `\n  ${failed === 0 ? "PASS" : "FAIL"}  ${checks.length - failed}/${checks.length} checks`,
  );
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(`ERROR: schematron smoke failed: ${err.stack || err.message}`);
  process.exit(1);
});
