/// <reference types="node" />
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { FormatId } from "../src/model";
import { preset, PRESET_IDS, type PresetId } from "../src/presets";
import { parseSvrl, type SvrlFinding } from "../src/svrl";
import { SCHEMATRON_RULE_SETS } from "../src/validation";

const HERE = dirname(fileURLToPath(import.meta.url));
const FRONTEND = join(HERE, "..");
const SEF_DIR = join(FRONTEND, "public", "sef");
const GOLDEN = join(HERE, "golden");

type SaxonModule = {
  transform(
    options: { stylesheetInternal: unknown; sourceText: string; destination: "serialized" },
    mode: "sync",
  ): { principalResult: string };
};

const SaxonJS = createRequire(join(FRONTEND, "package.json"))("saxon-js") as SaxonModule;

const SYNTAXES: { syntax: FormatId; suffix: string }[] = [
  { syntax: "ubl", suffix: ".ubl.xml" },
  { syntax: "xrechnung", suffix: ".xrechnung.xml" },
  { syntax: "cii", suffix: ".cii.xml" },
];

const RULE_SETS = [...new Set(Object.values(SCHEMATRON_RULE_SETS).flat())];

const MANIFEST = join(SEF_DIR, "manifest.json");

// The rule-set versions every EXPECTED entry below was reviewed against. A bump must fail
// here first — with instructions — instead of surfacing as a dozen confusing rule-id diffs.
const REVIEWED_RULE_SET_VERSIONS: Record<string, string> = {
  "cen-ubl": "1.3.15",
  "peppol-ubl": "3.0.20",
  "xrechnung-ubl": "2.5.0",
  "en16931-cii": "1.3.15",
};

const VERSIONS_CHANGED =
  "rule set versions changed — run npm run schematron:expected, review the diff, then update " +
  "EXPECTED and REVIEWED_RULE_SET_VERSIONS together";

type ManifestLike = { ruleSets: { id: string; version: string }[] };

function assertReviewedVersions(manifest: ManifestLike): void {
  const current = Object.fromEntries(
    manifest.ruleSets
      .filter((entry) => RULE_SETS.includes(entry.id))
      .map((entry) => [entry.id, entry.version]),
  );
  expect(current, VERSIONS_CHANGED).toEqual(REVIEWED_RULE_SET_VERSIONS);
}

// public/sef/ is git-ignored and built by `make sef`. Without it there is nothing to run, so the
// suite skips rather than failing a clean checkout.
const sefReady = RULE_SETS.every((name) => existsSync(join(SEF_DIR, `${name}.sef.json`)));

// SaxonJS 2.7 (the newest release) holds an xs:integer exactly but evaluates `mod` on it in
// IEEE-754 doubles, so any expression over more than ~15 significant digits is wrong. Both of
// these rules rebuild BT-84 into the 24-digit ISO 13616 number and take it mod 97; the goldens'
// IBANs are valid - `xs:decimal(...) mod 97` returns 1 for every one of them, and
// tests/presets.test.ts checks them with BigInt - but `xs:integer(...) mod 97` returns 65.
// This is an engine defect, not invalid data: do not "fix" it by picking an IBAN whose rounded
// value happens to land on 1.
const SAXON_INTEGER_MOD_DEFECT = new Set(["BR-DE-19:warning", "DE-R-019:warning"]);

// Every golden in a syntax a Schematron rule set covers, and exactly what it may raise, as
// `<rule-id>:<severity>` in document order. A native rendering - a preset serialised in the
// syntax it declares - must be empty apart from the engine defect above. Anything else is a
// cross-format rendering, and the reason it is kept has to be written down here.
const EXPECTED: Record<string, string[]> = {
  // Deliberately broken fixture: missing buyer country, wrong VAT total, exemption without a
  // reason, missing buyer endpoint. These four defects are the whole point of the preset.
  "broken.ubl.xml": ["BR-11:fatal", "BR-CO-14:fatal", "BR-E-10:fatal", "PEPPOL-EN16931-R010:fatal"],

  // Cross-format: a German invoice serialised as plain Peppol UBL. schemeID="EM" is a CEF EAS
  // code and correct for an EN 16931 invoice delivered by e-mail, but it is not in the Peppol
  // EAS subset - an e-mail address is not a Peppol participant identifier. The ZUGFeRD preset is
  // an e-mail scenario (buyer.channel EMAIL) for both parties, so CL008 fires twice; the
  // XRechnung preset is Peppol-delivered and only its seller still carries the hotel's e-mail
  // address. Giving these parties Peppol ids would make the fixture claim a routability the
  // scenario does not have.
  "de-hotel-b2b-zugferd.ubl.xml": [
    "DE-R-019:warning",
    "PEPPOL-EN16931-CL008:fatal",
    "PEPPOL-EN16931-CL008:fatal",
  ],
  "de-hotel-b2g-xrechnung.ubl.xml": ["DE-R-019:warning", "PEPPOL-EN16931-CL008:fatal"],

  // Native XRechnung. Clean except for the SaxonJS mod defect above.
  "de-hotel-b2g-xrechnung.xrechnung.xml": ["BR-DE-19:warning"],

  // Cross-format: an Italian B2G invoice serialised as Peppol UBL. The ministry is addressed by
  // its 6-character codice univoco ufficio over SDI, which is not a Peppol participant id, so
  // the Peppol rendering genuinely has no BT-49. Inventing one would misrepresent the scenario.
  "it-restaurant-b2g-fpa12.ubl.xml": ["PEPPOL-EN16931-R010:fatal"],

  // A TD04 credit note carried in an Invoice document - exactly what formats.ts refuses to offer
  // in the app (unsupportedReason), kept as a golden because goldens cover every preset.
  "it-restaurant-td04-credit.ubl.xml": ["BR-CL-01:fatal", "PEPPOL-EN16931-P0100:fatal"],

  // Cross-format: an Italian B2C invoice serialised as Peppol UBL. A private guest places no
  // purchase order and has no buyer reference, and she is reached over SDI by PEC rather than by a
  // Peppol participant id. Inventing a BT-10 or a BT-49 would misrepresent the scenario.
  "it-restaurant-b2c-pec.ubl.xml": ["PEPPOL-EN16931-R003:fatal", "PEPPOL-EN16931-R010:fatal"],

  // Deliberately broken fixture, native rendering: the buyer's Belgian enterprise number fails the
  // mod-97 rule PEPPOL-COMMON-R043 runs over every ICD 0208 identifier, once on the BT-49 endpoint
  // and once on the BT-47 legal registration identifier.
  "be-peppol-broken.ubl.xml": ["PEPPOL-COMMON-R043:fatal", "PEPPOL-COMMON-R043:fatal"],

  // Deliberately broken fixture, cross-format: a German B2G invoice with no Leitweg-ID in BT-10 and
  // no seller telephone in BT-42. Peppol carries the German national rules, so DE-R-015 and
  // DE-R-006 mirror the BR-DE-15 and BR-DE-6 the native XRechnung rendering raises, DE-R-027 is the
  // follow-on asking BT-42 for three digits, and DE-R-019 + CL008 are the sibling preset's.
  "de-hotel-b2g-broken.ubl.xml": [
    "DE-R-015:fatal",
    "DE-R-006:fatal",
    "DE-R-027:warning",
    "DE-R-019:warning",
    "PEPPOL-EN16931-CL008:fatal",
  ],
};

// A preset that exists to fail has no clean native rendering. Its findings are pinned in EXPECTED
// like every other golden's; only the blanket "a native rendering must be clean" assertion is
// lifted, and only for these four.
const DELIBERATELY_BROKEN = new Set(["broken", "be-peppol-broken", "de-hotel-b2g-broken"]);

// The syntax each preset declares as its own. A golden whose suffix matches it is a native
// rendering and has to come back clean; nothing here is hand-maintained, so a preset that
// changes format cannot leave a stale exemption behind.
const NATIVE_SYNTAX = new Map(PRESET_IDS.map((id) => [id, preset(id).format]));

function presetOf(file: string): PresetId | undefined {
  return PRESET_IDS.find((candidate) => file.startsWith(`${candidate}.`));
}

function isNative(file: string, syntax: FormatId): boolean {
  const id = presetOf(file);
  return id !== undefined && NATIVE_SYNTAX.get(id) === syntax;
}

// Each SEF is 2-8 MB of JSON. Parse it once and hand SaxonJS the same object for every golden.
const sheets = new Map<string, unknown>();

function sheet(ruleSet: string): unknown {
  let parsed = sheets.get(ruleSet);
  if (!parsed) {
    parsed = JSON.parse(readFileSync(join(SEF_DIR, `${ruleSet}.sef.json`), "utf8"));
    sheets.set(ruleSet, parsed);
  }
  return parsed;
}

function runRuleSets(syntax: FormatId, xml: string): SvrlFinding[] {
  const findings: SvrlFinding[] = [];
  for (const ruleSet of SCHEMATRON_RULE_SETS[syntax] ?? []) {
    const result = SaxonJS.transform(
      { stylesheetInternal: sheet(ruleSet), sourceText: xml, destination: "serialized" },
      "sync",
    );
    findings.push(...parseSvrl(result.principalResult));
  }
  return findings;
}

function goldens(suffix: string): string[] {
  return readdirSync(GOLDEN)
    .filter((name) => name.endsWith(suffix))
    .sort();
}

describe.skipIf(!sefReady)("Schematron over every golden", () => {
  for (const { syntax, suffix } of SYNTAXES) {
    for (const file of goldens(suffix)) {
      const expected = EXPECTED[file] ?? [];
      it(
        `${file} fires ${expected.length === 0 ? "nothing" : expected.join(" ")}`,
        { timeout: 120_000 },
        () => {
          const findings = runRuleSets(syntax, readFileSync(join(GOLDEN, file), "utf8"));
          const fired = findings.map((finding) => `${finding.ruleId}:${finding.severity}`);
          expect(
            fired,
            findings.map((finding) => `${finding.ruleId} ${finding.message}`).join("\n"),
          ).toEqual(expected);
          for (const finding of findings) {
            expect(finding.message, `${finding.ruleId} has no text`).not.toBe("");
            expect(finding.xpath, `${finding.ruleId} has no usable path`).toBeTruthy();
          }
          if (isNative(file, syntax) && !DELIBERATELY_BROKEN.has(presetOf(file) ?? "")) {
            expect(
              fired.filter((entry) => !SAXON_INTEGER_MOD_DEFECT.has(entry)),
              `${file} is a native rendering and must be Schematron-clean`,
            ).toEqual([]);
          }
        },
      );
    }
  }

  it("covers a native rendering of every preset that has a Schematron syntax", () => {
    const covered = new Set<string>();
    for (const { syntax, suffix } of SYNTAXES) {
      for (const file of goldens(suffix)) if (isNative(file, syntax)) covered.add(file);
    }
    expect([...covered].sort()).toEqual([
      "be-peppol-broken.ubl.xml",
      "be-peppol.ubl.xml",
      "de-hotel-b2b-zugferd.cii.xml",
      "de-hotel-b2g-xrechnung.xrechnung.xml",
    ]);
  });

  it("checks each syntax against the rule sets an access point would apply", () => {
    expect(SCHEMATRON_RULE_SETS).toEqual({
      ubl: ["cen-ubl", "peppol-ubl"],
      xrechnung: ["cen-ubl", "xrechnung-ubl"],
      cii: ["en16931-cii"],
    });
  });
});

// These two do not need the SEFs, so they run on a clean checkout too.
describe("the EXPECTED table stays honest", () => {
  it("pins only goldens that exist", () => {
    const files = new Set(readdirSync(GOLDEN));
    for (const key of Object.keys(EXPECTED)) {
      expect(
        files.has(key),
        `EXPECTED pins "${key}" but tests/golden/${key} does not exist — remove the stale entry`,
      ).toBe(true);
    }
  });

  it.skipIf(!existsSync(MANIFEST))("was reviewed against the built rule-set versions", () => {
    const manifest = JSON.parse(readFileSync(MANIFEST, "utf8")) as ManifestLike;
    assertReviewedVersions(manifest);
  });

  it("names the expected-diff tool when a version moves", () => {
    const bumped: ManifestLike = {
      ruleSets: Object.entries(REVIEWED_RULE_SET_VERSIONS).map(([id, version]) => ({
        id,
        version: id === "cen-ubl" ? "9.9.99" : version,
      })),
    };
    expect(() => assertReviewedVersions(bumped)).toThrowError(
      /rule set versions changed — run npm run schematron:expected/,
    );
  });
});
