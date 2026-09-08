/// <reference types="node" />
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseSvrl, type SvrlFinding } from "../src/svrl";

const HERE = dirname(fileURLToPath(import.meta.url));
const FRONTEND = join(HERE, "..");
const SEF_DIR = join(FRONTEND, "public", "sef");
// Vendored EUPL-1.2 CEN test documents (see fixtures/cen-br/SOURCES.md) — committed so this tier
// runs everywhere the SEFs exist instead of silently skipping off one machine.
const UNIT_UBL = join(HERE, "fixtures", "cen-br");

type SaxonModule = {
  transform(
    options: { stylesheetFileName: string; sourceText: string; destination: "serialized" },
    mode: "async",
  ): Promise<{ principalResult: string }>;
};

const SaxonJS = createRequire(join(FRONTEND, "package.json"))("saxon-js") as SaxonModule;

const sefReady = existsSync(join(SEF_DIR, "cen-ubl.sef.json"));

async function transform(ruleSet: string, xml: string): Promise<SvrlFinding[]> {
  const result = await SaxonJS.transform(
    {
      stylesheetFileName: join(SEF_DIR, `${ruleSet}.sef.json`),
      sourceText: xml,
      destination: "serialized",
    },
    "async",
  );
  return parseSvrl(result.principalResult);
}

// The CEN unit fixtures are vefa-validator <testSet> documents: each <test> holds an inline
// Invoice plus the rule id it must trigger (<error>) or satisfy (<success>). They are deliberate
// fragments, so every other mandatory-content rule fires too - vefa scopes the assertion to the
// one rule id and so does this test.
type UnitCase = { expected: string; description: string; xml: string };

function unitCases(file: string, kind: "error" | "success"): UnitCase[] {
  const document = new DOMParser().parseFromString(readFileSync(file, "utf8"), "application/xml");
  const serializer = new XMLSerializer();
  const cases: UnitCase[] = [];
  for (const test of document.getElementsByTagName("test")) {
    const assertion = test.getElementsByTagName("assert")[0];
    const expected = assertion?.getElementsByTagName(kind)[0]?.textContent?.trim();
    const invoice = [...test.children].find(
      (child) => child.localName === "Invoice" || child.localName === "CreditNote",
    );
    if (!expected || !invoice) continue;
    cases.push({
      expected,
      description: assertion.getElementsByTagName("description")[0]?.textContent?.trim() ?? "",
      xml: serializer.serializeToString(invoice),
    });
  }
  return cases;
}

const UNIT_FIXTURES = ["BR-11", "BR-16", "BR-CO-10", "BR-CO-15", "BR-S-08-1", "BR-CL-01"];

// Gated only on the SEFs (make sef); the fixtures are committed, so a missing file is a broken
// checkout and must FAIL, never skip.
describe.skipIf(!sefReady)("CEN EN 16931 BR-* unit fixtures", () => {
  for (const name of UNIT_FIXTURES) {
    const file = join(UNIT_UBL, `${name}.xml`);
    it(
      `${name}: fires in the error case and stays silent in the success case`,
      { timeout: 120_000 },
      async () => {
        for (const kind of ["error", "success"] as const) {
          const cases = unitCases(file, kind);
          expect(cases.length, `${name} has no <${kind}> case`).toBeGreaterThan(0);
          for (const unit of cases) {
            const findings = await transform("cen-ubl", unit.xml);
            const fired = findings.some((finding) => finding.ruleId === unit.expected);
            expect(fired, `${name} <${kind}> "${unit.description}"`).toBe(kind === "error");
          }
        }
      },
    );
  }
});
