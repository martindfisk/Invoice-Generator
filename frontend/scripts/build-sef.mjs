#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const FRONTEND = resolve(fileURLToPath(import.meta.url), "../..");
const ROOT = resolve(FRONTEND, "..");
const VENDOR = join(ROOT, "vendor", "schematron");
const SAXON_VENDOR = join(ROOT, "vendor", "saxon-js");
const OUT = join(FRONTEND, "public", "sef");
const SAXON_OUT = join(FRONTEND, "public", "saxon");

// iso_dsdl_include.xsl is a deeply recursive identity transform that overflows the SaxonJS
// stack on schemas of a few hundred kB, so each preprocessing step runs only when the schema
// actually uses the construct it resolves. iso_svrl_for_xslt2.xsl always runs.
const PREPROCESS = [
  {
    xsl: "iso_dsdl_include.xsl",
    needed: (t) => /<(?:[\w.-]+:)?(?:include|extends)[\s/>]/.test(t),
  },
  {
    xsl: "iso_abstract_expand.xsl",
    needed: (t) => /\babstract\s*=\s*(["'])true\1/.test(t),
  },
];
const COMPILE = "iso_svrl_for_xslt2.xsl";

const CEN_VERSION_RE = /Schematron version (\S+) - Last update: (\d{4}-\d{2}-\d{2})/;
const PEPPOL_VERSION_RE = /Last update:\s*(.+?)\s*\.\s*$/m;
const XRECHNUNG_VERSION_RE = /Schematron Version ([\w.]+) - XRechnung ([\w.]+) compatible - (\w+)/;
const SCHXSLT_RE = /SchXslt\/([\w.]+) SAXON\/(\w+ [\d.]+)/;

function cenVersion(syntax) {
  return (text, file) => {
    const m = CEN_VERSION_RE.exec(text);
    if (!m) throw new Error(`${file}: no "Schematron version N - Last update: D" header`);
    return `CEN/TC 434 EN 16931 ${syntax} ${m[1]} (last update ${m[2]})`;
  };
}

function peppolVersion(text, file) {
  const m = PEPPOL_VERSION_RE.exec(text);
  if (!m) throw new Error(`${file}: no "Last update: <release>." header`);
  return `Peppol BIS Billing 3.0 - ${m[1]}`;
}

function xrechnungVersion(text, file) {
  const m = XRECHNUNG_VERSION_RE.exec(text);
  if (!m) throw new Error(`${file}: no "Schematron Version N - XRechnung V compatible" title`);
  const built = SCHXSLT_RE.exec(text);
  const by = built ? `, compiled by SchXslt ${built[1]} / Saxon ${built[2]}` : "";
  return `KoSIT XRechnung ${m[2]} ${m[3]} Schematron ${m[1]}${by}`;
}

const RULE_SETS = [
  {
    sef: "en16931-ubl.sef.json",
    source: "EN16931-UBL-validation.xslt",
    version: cenVersion("UBL"),
    licence: "EUPL-1.2 (CEN/TC 434 validation artefacts)",
  },
  {
    sef: "en16931-cii.sef.json",
    source: "EN16931-CII-validation.xslt",
    version: cenVersion("CII"),
    licence: "EUPL-1.2 (CEN/TC 434 validation artefacts)",
  },
  {
    sef: "peppol-ubl.sef.json",
    source: "PEPPOL-EN16931-UBL.sch",
    version: peppolVersion,
    licence: "OpenPeppol AISBL (redistribution with attribution)",
  },
  {
    sef: "cen-ubl.sef.json",
    source: "CEN-EN16931-UBL.sch",
    version: cenVersion("UBL"),
    licence: "EUPL-1.2 (CEN/TC 434), redistributed by OpenPeppol",
  },
  {
    sef: "xrechnung-ubl.sef.json",
    source: "XRechnung-UBL-validation.xsl",
    version: xrechnungVersion,
    licence: "Apache-2.0 (KoSIT xrechnung-schematron)",
  },
  {
    sef: "xrechnung-cii.sef.json",
    source: "XRechnung-CII-validation.xsl",
    version: xrechnungVersion,
    licence: "Apache-2.0 (KoSIT xrechnung-schematron)",
  },
];

// The Schematron worker importScripts() the SaxonJS browser runtime from /saxon/. The npm
// package ships the Node build only, so the runtime is vendored by `make schemas` and copied
// here verbatim, together with the Saxonica licence its redistribution terms require.
const SAXON_FILES = ["SaxonJS2.rt.js", "LICENSE.txt"];

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

function xslt3(args) {
  try {
    return execFileSync("npx", ["xslt3", ...args], {
      cwd: FRONTEND,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (err) {
    const detail = [err.stdout, err.stderr].filter(Boolean).join("\n").trim();
    throw new Error(`xslt3 ${args.join(" ")} failed:\n${detail || err.message}`, { cause: err });
  }
}

function compileSchematron(sch, text, work) {
  let current = sch;
  const applied = [];
  for (const step of [...PREPROCESS.filter((s) => s.needed(text)), { xsl: COMPILE }]) {
    const next = join(work, `${basename(step.xsl, ".xsl")}.out.xml`);
    xslt3([`-s:${current}`, `-xsl:${join(VENDOR, step.xsl)}`, `-o:${next}`]);
    current = next;
    applied.push(step.xsl);
  }
  return { xslt: current, applied };
}

function vendorSources() {
  const file = join(ROOT, "vendor", "SOURCES.md");
  const map = new Map();
  if (!existsSync(file)) return map;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const cells = line.split("|").map((c) => c.trim());
    if (cells.length > 3 && cells[1].startsWith("schematron/")) {
      map.set(cells[1].slice("schematron/".length), cells[2]);
    }
  }
  return map;
}

function packageVersions() {
  const declared = JSON.parse(readFileSync(join(FRONTEND, "package.json"), "utf8")).devDependencies;
  const installed = (name) =>
    JSON.parse(readFileSync(join(FRONTEND, "node_modules", name, "package.json"), "utf8")).version;
  return {
    "saxon-js": `${installed("saxon-js")} (declared ${declared["saxon-js"]})`,
    xslt3: `${installed("xslt3")} (declared ${declared["xslt3"]})`,
    installed: { "saxon-js": installed("saxon-js") },
  };
}

function copySaxon(installed) {
  const runtime = join(SAXON_VENDOR, SAXON_FILES[0]);
  if (!existsSync(runtime)) {
    throw new Error(`${runtime} missing - run: make schemas`);
  }
  mkdirSync(SAXON_OUT, { recursive: true });
  const copied = [];
  for (const name of SAXON_FILES) {
    const data = readFileSync(join(SAXON_VENDOR, name));
    writeFileSync(join(SAXON_OUT, name), data);
    copied.push({ name, raw: data.length, gzip: gzipSync(data, { level: 9 }).length });
  }
  const text = readFileSync(runtime, "utf8");
  const stamped = /"product-name":"SaxonJS","product-version":"(\d+\.\d+)"/.exec(text)?.[1];
  const major = installed.split(".").slice(0, 2).join(".");
  if (stamped && stamped !== major) {
    throw new Error(
      `vendor/saxon-js/${SAXON_FILES[0]} is SaxonJS ${stamped} but node_modules/saxon-js is ` +
        `${installed}: SEF is tied to the runtime version - align SAXON_VERSION in ` +
        `tools/fetch_assets.py with the saxon-js devDependency`,
    );
  }
  const rt = copied[0];
  console.log(
    `  public/saxon/: ${copied.map((c) => c.name).join(", ")} ` +
      `[${(rt.raw / 1e3).toFixed(0)} kB raw, ${(rt.gzip / 1024).toFixed(0)} kB gzip] <- SaxonJS ${stamped ?? "?"}`,
  );
  return { version: stamped ?? installed, ...rt };
}

function main() {
  if (!existsSync(VENDOR)) {
    throw new Error(`${VENDOR} missing - run: make schemas`);
  }
  if (!existsSync(join(FRONTEND, "node_modules", ".bin", "xslt3"))) {
    throw new Error("xslt3 not installed - run: npm install (in frontend/)");
  }
  const versions = packageVersions();
  const saxon = copySaxon(versions.installed["saxon-js"]);
  const sources = vendorSources();
  mkdirSync(OUT, { recursive: true });
  const work = mkdtempSync(join(tmpdir(), "build-sef-"));
  const rows = [];
  try {
    for (const set of RULE_SETS) {
      const src = join(VENDOR, set.source);
      if (!existsSync(src)) throw new Error(`${src} missing - run: make schemas`);
      const text = readFileSync(src, "utf8");
      const started = Date.now();
      const { xslt, applied } = set.source.endsWith(".sch")
        ? compileSchematron(src, text, work)
        : { xslt: src, applied: [] };
      const dest = join(OUT, set.sef);
      xslt3([`-xsl:${xslt}`, `-export:${dest}`, "-nogo", "-relocate:on"]);
      const sef = readFileSync(dest);
      const row = {
        ...set,
        version: set.version(text, set.source),
        sourceUrl: sources.get(set.source) ?? "(not in vendor/SOURCES.md)",
        sourceSha: sha256(readFileSync(src)),
        pipeline: [set.source, ...applied].join(" -> "),
        sha: sha256(sef),
        raw: sef.length,
        gzip: gzipSync(sef, { level: 9 }).length,
        ms: Date.now() - started,
      };
      rows.push(row);
      console.log(
        `  ${set.sef} [${(row.raw / 1e6).toFixed(2)} MB raw, ` +
          `${(row.gzip / 1024).toFixed(0)} kB gzip, ${row.ms} ms] <- ${row.pipeline}`,
      );
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  writeSources(rows, versions, saxon);
  const raw = rows.reduce((n, r) => n + r.raw, 0);
  const gzip = rows.reduce((n, r) => n + r.gzip, 0);
  console.log(
    `public/sef/: ${rows.length} SEF, ${(raw / 1e6).toFixed(2)} MB raw / ` +
      `${(gzip / 1024).toFixed(0)} kB gzip, SOURCES.md written`,
  );
}

function writeSources(rows, versions, saxon) {
  const ts = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const lines = [
    "# frontend/public/sef provenance",
    "",
    `Generated ${ts} by \`frontend/scripts/build-sef.mjs\` (\`make sef\`). Do not hand-edit.`,
    "Inputs come from `vendor/schematron/` (`make schemas`); see `vendor/SOURCES.md` for their pins.",
    "",
    `SEF is tied to the SaxonJS major version - rebuild after upgrading \`saxon-js\`.`,
    `Built with saxon-js ${versions["saxon-js"]}, xslt3 ${versions.xslt3}.`,
    "",
    "| sef | build pipeline | rule set | licence | raw | gzip | sha256 | built |",
    "|---|---|---|---|---|---|---|---|",
    ...rows.map(
      (r) =>
        `| ${r.sef} | ${r.pipeline} | ${r.version} | ${r.licence} | ` +
        `${(r.raw / 1e6).toFixed(2)} MB | ${(r.gzip / 1024).toFixed(0)} kB | ${r.sha} | ${ts.slice(0, 10)} |`,
    ),
    "",
    "## Sources",
    "",
    ...rows.map((r) => `- \`${r.source}\` (sha256 ${r.sourceSha})\n  from ${r.sourceUrl}`),
    "",
    "## Notes",
    "",
    "- `.sch` inputs are compiled to XSLT 2.0 at build time with the vendored ISO Schematron",
    "  skeleton. OpenPEPPOL publishes Schematron sources only - there is no `rules/xslt/` path in",
    "  any `peppol-bis-invoice-3` tag - so this step replaces a download.",
    "- `iso_dsdl_include.xsl` / `iso_abstract_expand.xsl` run only when the schema uses",
    "  `<include>`/`<extends>` or abstract patterns: `iso_dsdl_include.xsl` recurses deeply enough",
    "  to raise `RangeError: Maximum call stack size exceeded` in SaxonJS on a ~300 kB schema",
    "  (it needs `ulimit -s 65520` + `node --stack-size=60000`). Both vendored rule sets are",
    "  already flat, so only `iso_svrl_for_xslt2.xsl` runs today.",
    "- `en16931-ubl.sef.json` and `cen-ubl.sef.json` are the same CEN rule set version from two",
    "  distributions; they are not byte-identical (the Peppol copy carries a newer ISO 6523 ICD /",
    "  EAS code list). Run `en16931-ubl` for plain EN 16931 and `cen-ubl` + `peppol-ubl` for the",
    "  pair a Peppol access point applies.",
    "- `xrechnung-ubl` / `xrechnung-cii` are KoSIT's own ready-compiled XSLT, produced with",
    "  **SchXslt**, not the ISO skeleton. Their SVRL `svrl:failed-assert/@location` therefore uses",
    "  the `/Q{uri}Name[n]` form instead of `/*:Name[namespace-uri()='uri'][n]`;",
    "  `frontend/src/svrl.ts` normalises both into the project's prefixed path form.",
    "- Never compile `.sch` at runtime; the browser only ever loads these SEF files.",
    "- Each SEF embeds a `buildDateTime`, so a rebuild from identical inputs is not byte-identical.",
    "  The SEF sha256 identifies the committed file; the source sha256 above is the pin that",
    "  matters (and is re-verified by `make schemas`).",
    "",
    "## SaxonJS browser runtime",
    "",
    `\`public/saxon/SaxonJS2.rt.js\` is SaxonJS **${saxon.version}** ` +
      `(${(saxon.raw / 1e3).toFixed(0)} kB raw, ${(saxon.gzip / 1024).toFixed(0)} kB gzip),`,
    "copied verbatim from `vendor/saxon-js/` by this script together with `LICENSE.txt`.",
    "The npm `saxon-js` package ships the Node build only, so the runtime comes from Saxonica;",
    "its licence permits binary redistribution as part of an application when the copyright",
    "notice travels with it - which is why `LICENSE.txt` is served next to it.",
    '`schematron.worker.ts` `importScripts("/saxon/SaxonJS2.rt.js")` on first use.',
  ];
  writeFileSync(join(OUT, "SOURCES.md"), lines.join("\n") + "\n");
}

try {
  main();
} catch (err) {
  console.error(`ERROR: SEF build failed: ${err.message}`);
  process.exit(1);
}
