import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FORMAT_IDS, getFormat } from "../src/formats";
import { preset } from "../src/presets";
import { runSchematron } from "../src/schematron.worker";
import { toInvoiceTransaction } from "../src/uapi-map";
import { specCountry, UAPI_SCHEMA_ENDPOINT } from "../src/uapi-schema-client";
import {
  checkWellFormed,
  countBySeverity,
  emptyRun,
  PREDICTED_DOCUMENT_NOTE,
  pointerForError,
  runValidation,
  stagesFor,
  transmissionFrom,
  uapiSchemaFinding,
  type Finding,
  type StageResult,
} from "../src/validation";

vi.mock("../src/schematron.worker", () => ({ runSchematron: vi.fn() }));

const schematron = vi.mocked(runSchematron);

const INVOICE_NS = "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2";
const CAC_NS = "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2";
const CBC_NS = "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2";

function svrl(body: string): string {
  return `<svrl:schematron-output xmlns:svrl="http://purl.oclc.org/dsdl/svrl">${body}</svrl:schematron-output>`;
}

const TOTALS_ASSERT = svrl(`
  <svrl:failed-assert id="BR-CO-15" flag="fatal" test="a = b" location="/*:Invoice[namespace-uri()='${INVOICE_NS}'][1]/*:LegalMonetaryTotal[namespace-uri()='${CAC_NS}'][1]/*:TaxInclusiveAmount[namespace-uri()='${CBC_NS}'][1]">
    <svrl:text>[BR-CO-15]-Invoice total with VAT.</svrl:text>
  </svrl:failed-assert>`);

function ublInput() {
  const invoice = preset("be-peppol");
  return { invoice, formatId: "ubl" as const, xml: getFormat("ubl").write(invoice) };
}

function fatturapaInput() {
  const invoice = preset("it-restaurant-b2b-fattura");
  return { invoice, formatId: "fatturapa" as const, xml: getFormat("fatturapa").write(invoice) };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function stage(results: StageResult[], id: string): StageResult {
  const found = results.find((result) => result.id === id);
  if (!found) throw new Error(`no ${id} stage in ${results.map((r) => r.id).join(", ")}`);
  return found;
}

let fetchMock: ReturnType<typeof vi.fn>;

function callsTo(endpoint: string): unknown[][] {
  return fetchMock.mock.calls.filter((call) => call[0] === endpoint);
}

function bodyOf(endpoint: string): Record<string, unknown> {
  const call = callsTo(endpoint)[0];
  if (!call) throw new Error(`test: nothing posted to ${endpoint}`);
  return JSON.parse(String((call[1] as { body: string }).body));
}

beforeEach(() => {
  schematron.mockReset();
  schematron.mockResolvedValue([{ ruleSet: "cen-ubl", svrl: svrl(""), loadMs: 1, runMs: 2 }]);
  fetchMock = vi
    .fn()
    .mockImplementation((url: string) =>
      Promise.resolve(
        url === UAPI_SCHEMA_ENDPOINT
          ? jsonResponse({ valid: true, country: "IT", findings: [] })
          : jsonResponse({ valid: true, findings: [] }),
      ),
    );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("stagesFor", () => {
  it("runs the fiskaly contract check first, then the order the format plugin declares", () => {
    expect(stagesFor("ubl").map((s) => s.id)).toEqual([
      "uapi-schema",
      "model",
      "well-formed",
      "xsd",
      "schematron",
    ]);
    expect(stagesFor("fatturapa").map((s) => s.id)).toEqual([
      "uapi-schema",
      "model",
      "well-formed",
      "xsd",
      "sdi-rules",
    ]);
  });

  it("puts the contract check in front of every format, XML or not", () => {
    for (const id of FORMAT_IDS) expect(stagesFor(id)[0].id).toBe("uapi-schema");
  });

  it("adds the CII Schematron stage the format plugin does not list yet", () => {
    expect(stagesFor("cii").map((s) => s.id)).toEqual([
      "uapi-schema",
      "model",
      "well-formed",
      "schematron",
    ]);
  });

  it("labels every stage and starts an empty run pending", () => {
    expect(stagesFor("ubl").map((s) => s.label)).toEqual([
      "fiskaly API contract",
      "Model rules",
      "Well-formedness",
      "XSD schema",
      "Schematron (EN 16931 / Peppol)",
    ]);
    expect(emptyRun("ubl").map((s) => s.status)).toEqual([
      "pending",
      "pending",
      "pending",
      "pending",
      "pending",
    ]);
  });
});

describe("checkWellFormed", () => {
  it("passes a well-formed document and reports a fatal on a broken one", () => {
    expect(checkWellFormed("<a><b/></a>")).toEqual([]);
    const findings = checkWellFormed("<a><b></a>");
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ source: "well-formed", severity: "fatal" });
  });
});

describe("runValidation", () => {
  it("runs the stages in order and reports each one twice", async () => {
    const seen: string[] = [];
    const results = await runValidation(ublInput(), (s) => seen.push(`${s.id}:${s.status}`));
    expect(results.map((r) => r.id)).toEqual([
      "uapi-schema",
      "model",
      "well-formed",
      "xsd",
      "schematron",
    ]);
    expect(seen).toEqual([
      "uapi-schema:running",
      "uapi-schema:passed",
      "model:running",
      "model:passed",
      "well-formed:running",
      "well-formed:passed",
      "xsd:running",
      "xsd:passed",
      "schematron:running",
      "schematron:passed",
    ]);
    expect(results.every((r) => typeof r.durationMs === "number")).toBe(true);
  });

  it("short-circuits every later stage when the XML is not well-formed", async () => {
    const input = { ...ublInput(), xml: "<Invoice><cbc:ID>1</Invoice>" };
    const results = await runValidation(input);
    expect(results.map((r) => `${r.id}:${r.status}`)).toEqual([
      "uapi-schema:passed",
      "model:passed",
      "well-formed:failed",
      "xsd:unavailable",
      "schematron:unavailable",
    ]);
    expect(stage(results, "xsd").note).toMatch(/not well-formed/);
    expect(callsTo("/api/validate/xsd")).toHaveLength(0);
    expect(schematron).not.toHaveBeenCalled();
  });

  it("keeps going when a stage is unavailable", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    const results = await runValidation(ublInput());
    expect(stage(results, "uapi-schema").status).toBe("unavailable");
    expect(stage(results, "xsd").status).toBe("unavailable");
    expect(stage(results, "xsd").note).toMatch(/not reachable.*fetch failed/);
    expect(stage(results, "xsd").findings).toEqual([]);
    expect(stage(results, "schematron").status).toBe("passed");
    expect(results.some((r) => r.status === "failed")).toBe(false);
  });

  it("turns a throwing stage runner into an unavailable stage, not a crash", async () => {
    schematron.mockRejectedValue(new Error("/sef/cen-ubl.sef.json is not available (404)"));
    const results = await runValidation(ublInput());
    expect(stage(results, "schematron")).toMatchObject({
      status: "unavailable",
      note: "/sef/cen-ubl.sef.json is not available (404)",
    });
  });
});

describe("the uapi-schema stage", () => {
  function schemaResponse(findings: unknown[], country = "IT") {
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(
        url === UAPI_SCHEMA_ENDPOINT
          ? jsonResponse({ valid: findings.length === 0, country, findings })
          : jsonResponse({ valid: true, findings: [] }),
      ),
    );
  }

  it("posts the operation mapped from the invoice and the seller's country", async () => {
    const input = ublInput();
    await runValidation(input);
    const body = bodyOf(UAPI_SCHEMA_ENDPOINT);
    expect(body.country).toBe("BE");
    expect(body.operation).toEqual(JSON.parse(JSON.stringify(toInvoiceTransaction(input.invoice))));
  });

  it("posts the JSON the editor is holding when one is given", async () => {
    const operation = { type: "INVOICE", document: { number: "EDITED-1" } };
    await runValidation({ ...ublInput(), operation, country: "IT" });
    expect(bodyOf(UAPI_SCHEMA_ENDPOINT)).toEqual({ operation, country: "IT" });
  });

  it("maps every schema error to a located finding", async () => {
    schemaResponse([
      {
        pointer: "/entries/0/data/unit/price/exclusive",
        keyword: "pattern",
        message: "'12,00' does not match '^(-)?\\d{1,12}(\\.\\d{1,8})?$'",
      },
      {
        pointer: "/recipients/0/address/country",
        keyword: "enum",
        message: "'XX' is not one of ['AD', 'AE']",
      },
    ]);
    const found = stage(await runValidation(ublInput()), "uapi-schema");
    expect(found.status).toBe("failed");
    expect(found.findings).toHaveLength(2);
    expect(found.findings[0]).toMatchObject({
      source: "uapi-schema",
      ruleId: "uapi/pattern",
      severity: "error",
      pointer: "/entries/0/data/unit/price/exclusive",
      field: "lines.0.unitPriceNet",
    });
    expect(found.findings[1]).toMatchObject({
      pointer: "/recipients/0/address/country",
      field: "buyer.address.country",
    });
  });

  it("points a missing required property at the property, not at its parent", () => {
    expect(
      pointerForError({
        pointer: "/entries/0/data",
        keyword: "required",
        message: "'text' is a required property",
      }),
    ).toBe("/entries/0/data/text");
    expect(
      uapiSchemaFinding({
        pointer: "/entries/0/data",
        keyword: "required",
        message: "'text' is a required property",
      }),
    ).toMatchObject({ pointer: "/entries/0/data/text", field: "lines.0.name" });
  });

  it("leaves a finding unfielded when the pointer has no model home", async () => {
    schemaResponse([
      { pointer: "/entries/0/data/unit/factor", keyword: "pattern", message: "bad factor" },
    ]);
    const found = stage(await runValidation(ublInput()), "uapi-schema");
    expect(found.findings[0].field).toBeUndefined();
    expect(found.findings[0].pointer).toBe("/entries/0/data/unit/factor");
  });

  it("falls back to a fetched spec for a country fiskaly does not publish", async () => {
    expect(specCountry("IT")).toBe("IT");
    expect(specCountry("be")).toBe("BE");
    expect(specCountry("DE")).toBeUndefined();
    expect(specCountry(undefined)).toBeUndefined();

    schemaResponse([], "IT");
    const invoice = preset("de-hotel-b2b-zugferd");
    const found = stage(
      await runValidation({ invoice, formatId: "cii", xml: getFormat("cii").write(invoice) }),
      "uapi-schema",
    );
    expect(found.status).toBe("passed");
    expect(bodyOf(UAPI_SCHEMA_ENDPOINT).country).toBeUndefined();
    expect(found.note).toContain("fiskaly publishes no DE spec");
  });

  it("names the spec it checked against and never claims fiskaly answered", async () => {
    schemaResponse([], "BE");
    const found = stage(await runValidation(ublInput()), "uapi-schema");
    expect(found.status).toBe("passed");
    expect(found.note).toContain("components.schemas.InvoiceTransaction");
    expect(found.note).toContain("BE");
  });

  it("is unavailable, not failed, when the backend cannot be reached", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    const found = stage(await runValidation(ublInput()), "uapi-schema");
    expect(found.status).toBe("unavailable");
    expect(found.note).toMatch(/not reachable.*fetch failed/);
    expect(found.findings).toEqual([]);
  });

  it("is unavailable when the backend answers with an error status", async () => {
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(
        url === UAPI_SCHEMA_ENDPOINT
          ? new Response("spec/ missing; run: make spec", { status: 503 })
          : jsonResponse({ valid: true, findings: [] }),
      ),
    );
    const found = stage(await runValidation(ublInput()), "uapi-schema");
    expect(found.status).toBe("unavailable");
    expect(found.note).toMatch(/answered 503.*make spec/);
  });

  it("does not stop the XML stages from running", async () => {
    schemaResponse([{ pointer: "/type", keyword: "enum", message: "'RECEIPT' is not one of" }]);
    const results = await runValidation(ublInput());
    expect(stage(results, "uapi-schema").status).toBe("failed");
    expect(stage(results, "xsd").status).toBe("passed");
    expect(stage(results, "schematron").status).toBe("passed");
  });
});

describe("the predicted-document note", () => {
  it("says the XML stages check a prediction, not fiskaly's own document", async () => {
    const results = await runValidation(fatturapaInput());
    for (const id of ["xsd", "sdi-rules"]) {
      expect(stage(results, id).note).toContain(PREDICTED_DOCUMENT_NOTE);
    }
    expect(stage(await runValidation(ublInput()), "schematron").note).toContain(
      PREDICTED_DOCUMENT_NOTE,
    );
    expect(PREDICTED_DOCUMENT_NOTE).toContain("fetched in Send");
    expect(stage(results, "uapi-schema").note).not.toContain(PREDICTED_DOCUMENT_NOTE);
  });
});

describe("the xsd stage", () => {
  it("posts the format's schema key and maps line, column and path", async () => {
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(
        url === UAPI_SCHEMA_ENDPOINT
          ? jsonResponse({ valid: true, country: "BE", findings: [] })
          : jsonResponse({
              valid: false,
              findings: [
                {
                  line: 5,
                  column: 0,
                  message: "Element 'cbc:Nope': This element is not expected.",
                  path: "/*/cac:InvoiceLine[2]/cbc:ID",
                },
              ],
            }),
      ),
    );
    const results = await runValidation(ublInput());
    const xsd = stage(results, "xsd");
    expect(callsTo("/api/validate/xsd")).toHaveLength(1);
    expect(bodyOf("/api/validate/xsd").schema).toBe("ubl-invoice-2.1");
    expect(xsd.status).toBe("failed");
    expect(xsd.findings[0]).toMatchObject({
      source: "xsd",
      ruleId: "ubl-invoice-2.1",
      severity: "fatal",
      line: 5,
      xpath: "Invoice/cac:InvoiceLine[1]/cbc:ID",
    });
    expect(xsd.findings[0].column).toBeUndefined();
  });

  it("fails the stage even when the backend reports no detail", async () => {
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(
        url === UAPI_SCHEMA_ENDPOINT
          ? jsonResponse({ valid: true, country: "BE", findings: [] })
          : jsonResponse({ valid: false, findings: [] }),
      ),
    );
    const xsd = stage(await runValidation(ublInput()), "xsd");
    expect(xsd.status).toBe("failed");
    expect(xsd.findings).toHaveLength(1);
  });

  it("reports the backend's own error instead of throwing", async () => {
    fetchMock.mockResolvedValue(new Response("no such schema", { status: 400 }));
    const xsd = stage(await runValidation(ublInput()), "xsd");
    expect(xsd.status).toBe("unavailable");
    expect(xsd.note).toMatch(/answered 400/);
  });

  it("is unavailable for a format with no vendored XSD", async () => {
    const invoice = preset("de-hotel-b2b-zugferd");
    expect(getFormat("cii").xsdSchemaKey).toBeNull();
    const results = await runValidation({
      invoice,
      formatId: "cii",
      xml: getFormat("cii").write(invoice),
    });
    expect(results.map((r) => r.id)).not.toContain("xsd");
  });
});

describe("the schematron stage", () => {
  it("maps a failed assert to a finding with field, business term and path", async () => {
    schematron.mockResolvedValue([
      { ruleSet: "cen-ubl", svrl: TOTALS_ASSERT, loadMs: 120, runMs: 30 },
    ]);
    const results = await runValidation(ublInput());
    const found = stage(results, "schematron");
    expect(schematron).toHaveBeenCalledWith(expect.any(String), ["cen-ubl", "peppol-ubl"]);
    expect(found.status).toBe("failed");
    expect(found.note).toContain("cen-ubl (150 ms)");
    expect(found.findings[0]).toMatchObject({
      source: "schematron",
      ruleId: "BR-CO-15",
      severity: "fatal",
      xpath: "Invoice/cac:LegalMonetaryTotal/cbc:TaxInclusiveAmount",
      field: "totals.taxInclusive",
      bt: "BT-112",
      test: "a = b",
    });
  });

  it("reports the same rule at the same place once across rule sets", async () => {
    schematron.mockResolvedValue([
      { ruleSet: "cen-ubl", svrl: TOTALS_ASSERT, loadMs: 1, runMs: 1 },
      { ruleSet: "peppol-ubl", svrl: TOTALS_ASSERT, loadMs: 1, runMs: 1 },
    ]);
    const found = stage(await runValidation(ublInput()), "schematron");
    expect(found.findings).toHaveLength(1);
  });

  it("does not attach a field to a rule that fires on the document element", async () => {
    schematron.mockResolvedValue([
      {
        ruleSet: "cen-ubl",
        svrl: svrl(
          `<svrl:failed-assert id="BR-DE-21" flag="warning" location="/Q{${INVOICE_NS}}Invoice[1]"><svrl:text>x</svrl:text></svrl:failed-assert>`,
        ),
        loadMs: 1,
        runMs: 1,
      },
    ]);
    const found = stage(await runValidation(ublInput()), "schematron");
    expect(found.status).toBe("passed");
    expect(found.findings[0]).toMatchObject({ ruleId: "BR-DE-21", xpath: "Invoice" });
    expect(found.findings[0].field).toBeUndefined();
  });
});

describe("the sdi-rules stage", () => {
  it("passes on the clean Italian preset", async () => {
    const results = await runValidation(fatturapaInput());
    expect(results.map((r) => r.id)).toEqual([
      "uapi-schema",
      "model",
      "well-formed",
      "xsd",
      "sdi-rules",
    ]);
    expect(stage(results, "sdi-rules")).toMatchObject({ status: "passed", findings: [] });
  });

  it("reads FormatoTrasmissione and CodiceDestinatario back from the document", async () => {
    const input = fatturapaInput();
    expect(transmissionFrom(input.xml)).toEqual({
      formatoTrasmissione: "FPR12",
      codiceDestinatario: "M5UXCR1",
    });
    expect(transmissionFrom("<p:FatturaElettronica/>")).toBeUndefined();
    const broken = {
      ...input,
      xml: input.xml.replace("<CodiceDestinatario>M5UXCR1<", "<CodiceDestinatario>M5UXC<"),
    };
    const found = stage(await runValidation(broken), "sdi-rules");
    expect(found.status).toBe("failed");
    expect(found.findings[0]).toMatchObject({
      source: "sdi-rules",
      ruleId: "00427",
      severity: "error",
      fpa: "1.1.4",
    });
  });

  it("is unavailable for a format that SDI does not carry", async () => {
    const invoice = preset("be-peppol");
    const results = await runValidation({
      invoice,
      formatId: "ubl",
      xml: getFormat("ubl").write(invoice),
    });
    expect(results.map((r) => r.id)).not.toContain("sdi-rules");
  });
});

describe("countBySeverity", () => {
  it("counts each severity", () => {
    const findings = [
      { source: "model", ruleId: "a", severity: "fatal", message: "" },
      { source: "model", ruleId: "b", severity: "warning", message: "" },
      { source: "model", ruleId: "c", severity: "warning", message: "" },
    ] satisfies Finding[];
    expect(countBySeverity(findings)).toEqual({ fatal: 1, error: 0, warning: 2, info: 0 });
  });
});
