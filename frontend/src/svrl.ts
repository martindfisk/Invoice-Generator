export const SVRL_NAMESPACE = "http://purl.oclc.org/dsdl/svrl";

export type SvrlSeverity = "fatal" | "error" | "warning" | "info";

export type SvrlKind = "failed-assert" | "successful-report";

export type SvrlFinding = {
  kind: SvrlKind;
  ruleId: string;
  severity: SvrlSeverity;
  message: string;
  location?: string;
  xpath?: string;
  test?: string;
};

// Namespace URI -> the prefix the writers use, so a Saxon @location can be looked up in the
// path index built by xml-locate.ts. "" means the element is written unprefixed (UBL puts the
// document namespace on the default xmlns, FatturaPA leaves its children unqualified).
export const SVRL_PREFIXES: Record<string, string> = {
  "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2": "",
  "urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2": "",
  "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2": "cac",
  "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2": "cbc",
  "urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2": "ext",
  "urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100": "rsm",
  "urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100": "ram",
  "urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100": "udt",
  "urn:un:unece:uncefact:data:standard:QualifiedDataType:100": "qdt",
  "http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2": "p",
};

const SEVERITIES: Record<string, SvrlSeverity> = {
  fatal: "fatal",
  error: "error",
  warning: "warning",
  warn: "warning",
  info: "info",
  information: "info",
};

// SchXslt (KoSIT XRechnung >= 2.5.0): /Q{uri}Local[n]
const QNAME_STEP = /^Q\{([^}]*)\}([^[\]]+)((?:\[\d+\])*)$/;
// ISO Schematron skeleton (CEN, Peppol): /*:Local[namespace-uri()='uri'][n]
const WILDCARD_STEP = /^\*:([^[\]]+)\[namespace-uri\(\)=(['"])(.*?)\2\]((?:\[\d+\])*)$/;
const PLAIN_STEP = /^(?:\*:)?([^[\]]+)((?:\[\d+\])*)$/;
const POSITION = /\[(\d+)\]\s*$/;

// A step's namespace predicate holds a URI full of slashes, so the path cannot be split on "/"
// naively: track quoting and Q{} braces and only break at depth zero.
function splitSteps(location: string): string[] {
  const steps: string[] = [];
  let current = "";
  let quote = "";
  let braces = 0;
  for (const character of location) {
    if (quote) {
      current += character;
      if (character === quote) quote = "";
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      current += character;
      continue;
    }
    if (character === "{") braces += 1;
    else if (character === "}") braces -= 1;
    if (character === "/" && braces === 0) {
      if (current) steps.push(current);
      current = "";
      continue;
    }
    current += character;
  }
  if (current) steps.push(current);
  return steps;
}

// Saxon positions are 1-based and always present; the project's paths use a 0-based occurrence
// suffix and omit it for the first occurrence (see xml-locate.ts collect()).
function occurrence(predicates: string): string {
  const match = POSITION.exec(predicates);
  if (!match) return "";
  const index = Number(match[1]) - 1;
  return index > 0 ? `[${index}]` : "";
}

function qualify(uri: string, local: string): string {
  const prefix = SVRL_PREFIXES[uri];
  if (prefix === undefined) return local;
  return prefix ? `${prefix}:${local}` : local;
}

function normaliseStep(step: string): string | undefined {
  if (step.startsWith("@")) return step;
  const qname = QNAME_STEP.exec(step);
  if (qname) return `${qualify(qname[1], qname[2])}${occurrence(qname[3])}`;
  const wildcard = WILDCARD_STEP.exec(step);
  if (wildcard) return `${qualify(wildcard[3], wildcard[1])}${occurrence(wildcard[4])}`;
  const plain = PLAIN_STEP.exec(step);
  if (plain) return `${plain[1]}${occurrence(plain[2])}`;
  return undefined;
}

export function normaliseLocation(location: string | undefined | null): string | undefined {
  if (!location) return undefined;
  const steps = splitSteps(location.trim());
  if (steps.length === 0) return undefined;
  const normalised: string[] = [];
  for (const step of steps) {
    const value = normaliseStep(step);
    if (value === undefined) return undefined;
    normalised.push(value);
  }
  return normalised.join("/");
}

export function severityOf(flag: string | undefined | null): SvrlSeverity {
  return (flag && SEVERITIES[flag.trim().toLowerCase()]) || "error";
}

function text(element: Element): string {
  const child = element.getElementsByTagNameNS(SVRL_NAMESPACE, "text")[0];
  return (child?.textContent ?? element.textContent ?? "").replace(/\s+/g, " ").trim();
}

export function parseSvrl(svrl: string): SvrlFinding[] {
  const document = new DOMParser().parseFromString(svrl, "application/xml");
  const failure = document.getElementsByTagName("parsererror")[0];
  if (failure) {
    throw new Error(
      `SVRL is not well-formed: ${(failure.textContent ?? "").trim().split("\n")[0]}`,
    );
  }
  const findings: SvrlFinding[] = [];
  for (const element of document.getElementsByTagNameNS(SVRL_NAMESPACE, "*")) {
    const kind = element.localName;
    if (kind !== "failed-assert" && kind !== "successful-report") continue;
    const location = element.getAttribute("location") ?? undefined;
    findings.push({
      kind,
      ruleId: element.getAttribute("id") || element.getAttribute("role") || "(unnamed rule)",
      severity: severityOf(element.getAttribute("flag")),
      message: text(element),
      location,
      xpath: normaliseLocation(location),
      test: element.getAttribute("test") ?? undefined,
    });
  }
  return findings;
}
