#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
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
const RULESETS = join(ROOT, "tools", "rulesets.json");
const MANIFEST = join(OUT, "manifest.json");

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

// The Schematron worker importScripts() the SaxonJS browser runtime from /saxon/. The npm
// package ships the Node build only, so the runtime is vendored by `make schemas` and copied
// here verbatim, together with the Saxonica licence its redistribution terms require.
const SAXON_FILES = ["SaxonJS2.rt.js", "LICENSE.txt"];

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

// --- tools/rulesets.json (the pinned rule-set manifest, shared with fetch_assets.py) -------

function tpl(template, vars) {
  return template.replace(/\{(\w+)\}/g, (_, key) => {
    if (!(key in vars)) throw new Error(`template ${template}: no value for {${key}}`);
    return vars[key];
  });
}

function loadRulesets() {
  if (!existsSync(RULESETS)) throw new Error(`${RULESETS} missing`);
  const data = JSON.parse(readFileSync(RULESETS, "utf8"));
  const sources = new Map(data.sources.map((s) => [s.id, s]));
  for (const rs of data.ruleSets) {
    if (!sources.has(rs.source)) {
      throw new Error(`${RULESETS}: rule set ${rs.id} references unknown source ${rs.source}`);
    }
  }
  return { data, sources };
}

function sourceVars(src) {
  return { version: src.version ?? "", ...(src.vars ?? {}) };
}

// The upstream URL a rule set's vendored file was pinned from, rendered like fetch_assets.py
// renders it (raw files download directly; zip members point at their release zip).
function sourceUrl(src, file) {
  const vars = sourceVars(src);
  const entry = Object.entries(src.files).find(([name]) => tpl(name, vars) === file)?.[1];
  if (entry === undefined) throw new Error(`${RULESETS}: source ${src.id} has no file ${file}`);
  const target = typeof entry === "string" ? file : tpl(entry.zip, vars);
  return tpl(src.urlTemplate, { ...vars, file: target });
}

// --- rule-set metadata: a real XML read, never a regex over raw markup ---------------------

function assertClean(text, file, what) {
  if (/[<>"]/.test(text)) {
    throw new Error(`${file}: extracted ${what} contains markup: ${JSON.stringify(text)}`);
  }
  return text;
}

async function extractMeta(SaxonJS, path, file) {
  const doc = await SaxonJS.getResource({ file: path, type: "xml" });
  const q = (xpath) =>
    assertClean(
      SaxonJS.XPath.evaluate(xpath, doc, {
        namespaceContext: {
          svrl: "http://purl.oclc.org/dsdl/svrl",
          skos: "http://www.w3.org/2004/02/skos/core#",
        },
      }),
      file,
      "metadata",
    );
  const prefLabel = q("string((//skos:prefLabel)[1])");
  if (prefLabel) {
    // KoSIT ships SchXslt-compiled XSLT: version in svrl:schematron-output/@title, compiler
    // in the rdf:Description prefLabel (this is where the old regexes leaked markup).
    const title = q("string((//svrl:schematron-output/@title)[1])");
    const m = /Schematron Version ([\w.]+) - XRechnung ([\w.]+) compatible - (\w+)/.exec(title);
    if (!m) throw new Error(`${file}: no "Schematron Version N - XRechnung V compatible" title`);
    const built = /SchXslt\/([\w.]+) SAXON\/(\w+)\s+([\d.]+)/.exec(prefLabel);
    const by = built ? `, compiled by SchXslt ${built[1]} / Saxon ${built[2]} ${built[3]}` : "";
    return {
      version: m[1],
      label: `KoSIT XRechnung ${m[2]} ${m[3]} Schematron ${m[1]}${by}`,
    };
  }
  const cen = q("string((//comment()[contains(., 'Schematron version')])[1])");
  if (cen) {
    const m = /Schematron version (\S+) - Last update: (\d{4}-\d{2}-\d{2})/.exec(cen);
    if (!m) throw new Error(`${file}: no "Schematron version N - Last update: D" comment`);
    const syntax = /\b(UBL|CII)\b/.exec(file)?.[1] ?? "?";
    return {
      version: m[1],
      label: `CEN/TC 434 EN 16931 ${syntax} ${m[1]} (last update ${m[2]})`,
    };
  }
  const peppol = q("string((//comment()[contains(., 'Last update')])[1])");
  const m = /Last update:\s*(.+?)\s*\.(\s|$)/.exec(peppol);
  if (!m) throw new Error(`${file}: no recognisable rule-set version metadata`);
  const version = /([\d][\d.]*)\s*$/.exec(m[1])?.[1] ?? m[1];
  return { version, label: `Peppol BIS Billing 3.0 - ${m[1]}` };
}

// --- compile -------------------------------------------------------------------------------

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
        `${installed}: SEF is tied to the runtime version - align the "saxon" source in ` +
        `tools/rulesets.json with the saxon-js devDependency`,
    );
  }
  const rt = copied[0];
  console.log(
    `  public/saxon/: ${copied.map((c) => c.name).join(", ")} ` +
      `[${(rt.raw / 1e3).toFixed(0)} kB raw, ${(rt.gzip / 1024).toFixed(0)} kB gzip] <- SaxonJS ${stamped ?? "?"}`,
  );
  return { version: stamped ?? installed, ...rt };
}

async function build() {
  if (!existsSync(VENDOR)) {
    throw new Error(`${VENDOR} missing - run: make schemas`);
  }
  if (!existsSync(join(FRONTEND, "node_modules", ".bin", "xslt3"))) {
    throw new Error("xslt3 not installed - run: npm install (in frontend/)");
  }
  const SaxonJS = (await import("saxon-js")).default;
  const { data, sources } = loadRulesets();
  const versions = packageVersions();
  const saxon = copySaxon(versions.installed["saxon-js"]);
  mkdirSync(OUT, { recursive: true });
  const work = mkdtempSync(join(tmpdir(), "build-sef-"));
  const rows = [];
  try {
    for (const set of data.ruleSets) {
      const source = sources.get(set.source);
      const src = join(VENDOR, set.file);
      if (!existsSync(src)) throw new Error(`${src} missing - run: make schemas`);
      const text = readFileSync(src, "utf8");
      const meta = await extractMeta(SaxonJS, src, set.file);
      const started = Date.now();
      const { xslt, applied } =
        set.compile === "sch" ? compileSchematron(src, text, work) : { xslt: src, applied: [] };
      const dest = join(OUT, `${set.id}.sef.json`);
      xslt3([`-xsl:${xslt}`, `-export:${dest}`, "-nogo", "-relocate:on"]);
      const sef = readFileSync(dest);
      const sefMeta = JSON.parse(sef);
      const row = {
        ...set,
        sef: `${set.id}.sef.json`,
        title: assertClean(
          `${tpl(set.title, sourceVars(source))} ${meta.version}`,
          set.file,
          "title",
        ),
        version: meta.version,
        ruleSet: meta.label,
        sourceUrl: sourceUrl(source, set.file),
        sourceSha: sha256(readFileSync(src)),
        pipeline: [set.file, ...applied].join(" -> "),
        sha: sha256(sef),
        raw: sef.length,
        gzip: gzipSync(sef, { level: 9 }).length,
        saxonVersion: sefMeta.saxonVersion,
        buildDateTime: sefMeta.buildDateTime,
        ms: Date.now() - started,
      };
      rows.push(row);
      console.log(
        `  ${row.sef} [${(row.raw / 1e6).toFixed(2)} MB raw, ` +
          `${(row.gzip / 1024).toFixed(0)} kB gzip, ${row.ms} ms] <- ${row.pipeline}`,
      );
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  writeManifest(rows, versions.installed["saxon-js"]);
  writeSources(rows, versions, saxon);
  const raw = rows.reduce((n, r) => n + r.raw, 0);
  const gzip = rows.reduce((n, r) => n + r.gzip, 0);
  console.log(
    `public/sef/: ${rows.length} SEF, ${(raw / 1e6).toFixed(2)} MB raw / ` +
      `${(gzip / 1024).toFixed(0)} kB gzip, manifest.json + SOURCES.md written`,
  );
}

// The catalogue the app reads: which rule sets exist, their versions and the SEF each one
// maps to. schematron.worker.ts keys its cache on sef.sha256, so this file is the single
// place a rule-set bump becomes visible to the frontend.
function writeManifest(rows, saxonJs) {
  const manifest = {
    generatedAt: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
    saxonJs,
    ruleSets: rows.map((r) => ({
      id: r.id,
      title: r.title,
      version: r.version,
      licence: r.licence,
      formats: r.formats,
      order: r.order,
      sourceSha: r.sourceSha,
      sef: {
        sha256: r.sha,
        bytes: r.raw,
        saxonVersion: r.saxonVersion,
        buildDateTime: r.buildDateTime,
      },
    })),
  };
  writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + "\n");
}

function writeSources(rows, versions, saxon) {
  const ts = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const lines = [
    "# frontend/public/sef provenance",
    "",
    `Generated ${ts} by \`frontend/scripts/build-sef.mjs\` (\`make sef\`). Do not hand-edit.`,
    "Inputs come from `vendor/schematron/` (`make schemas`); versions and sha256 pins live in",
    "`tools/rulesets.json`. `manifest.json` next to this file is the machine-readable catalogue.",
    "",
    `SEF is tied to the SaxonJS major version - rebuild after upgrading \`saxon-js\`.`,
    `Built with saxon-js ${versions["saxon-js"]}, xslt3 ${versions.xslt3}.`,
    "",
    "| sef | build pipeline | rule set | licence | raw | gzip | sha256 | built |",
    "|---|---|---|---|---|---|---|---|",
    ...rows.map(
      (r) =>
        `| ${r.sef} | ${r.pipeline} | ${r.ruleSet} | ${r.licence} | ` +
        `${(r.raw / 1e6).toFixed(2)} MB | ${(r.gzip / 1024).toFixed(0)} kB | ${r.sha} | ${ts.slice(0, 10)} |`,
    ),
    "",
    "## Sources",
    "",
    ...rows.map((r) => `- \`${r.file}\` (sha256 ${r.sourceSha})\n  from ${r.sourceUrl}`),
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

// --- staleness guard (`make sef-check`, wired into `make doctor` and CI) --------------------

function check() {
  const { data } = loadRulesets();
  const errors = [];
  const rulesetsMtime = statSync(RULESETS).mtimeMs;
  const installed = JSON.parse(
    readFileSync(join(FRONTEND, "node_modules", "saxon-js", "package.json"), "utf8"),
  ).version;
  const catalogue = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, "utf8")) : null;
  if (!catalogue) errors.push("public/sef/manifest.json missing - run: make sef");
  for (const set of data.ruleSets) {
    const sefPath = join(OUT, `${set.id}.sef.json`);
    if (!existsSync(sefPath)) {
      errors.push(`${set.id}.sef.json missing - run: make sef`);
      continue;
    }
    const sefBytes = readFileSync(sefPath);
    const sef = JSON.parse(sefBytes);
    const built = Date.parse(sef.buildDateTime);
    const srcPath = join(VENDOR, set.file);
    if (!existsSync(srcPath)) {
      errors.push(`vendor/schematron/${set.file} missing - run: make schemas`);
    } else if (built < statSync(srcPath).mtimeMs) {
      errors.push(`${set.id}.sef.json predates vendor/schematron/${set.file} - run: make sef`);
    }
    if (built < rulesetsMtime) {
      errors.push(`${set.id}.sef.json predates tools/rulesets.json - run: make sef`);
    }
    const major = (v) =>
      String(v)
        .replace(/^SaxonJS\s*/i, "")
        .split(".")[0];
    if (major(sef.saxonVersion) !== major(installed)) {
      errors.push(
        `${set.id}.sef.json was compiled for ${sef.saxonVersion} but saxon-js ${installed} is ` +
          "installed - SEF is tied to the SaxonJS major version, run: make sef",
      );
    }
    const entry = catalogue?.ruleSets.find((r) => r.id === set.id);
    if (catalogue && !entry) {
      errors.push(`${set.id} missing from public/sef/manifest.json - run: make sef`);
    } else if (entry && entry.sef.sha256 !== sha256(sefBytes)) {
      errors.push(`manifest.json is stale for ${set.id}.sef.json - run: make sef`);
    }
  }
  if (errors.length) {
    for (const error of errors) console.error(`  ${error}`);
    throw new Error(`${errors.length} stale or missing SEF artefact(s)`);
  }
  console.log(
    `sef-check: ${data.ruleSets.length} SEF fresh (rule-set pins ${basename(RULESETS)}, ` +
      `saxon-js ${installed})`,
  );
}

try {
  if (process.argv.includes("--check")) {
    check();
  } else {
    await build();
  }
} catch (err) {
  console.error(
    process.argv.includes("--check")
      ? `ERROR: SEF check failed: ${err.message}`
      : `ERROR: SEF build failed: ${err.message}`,
  );
  process.exit(1);
}
