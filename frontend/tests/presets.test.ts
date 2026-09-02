import { describe, expect, it } from "vitest";
import type { References } from "../src/model";
import { checkModel } from "../src/model-rules";
import {
  listPresets,
  preset,
  PRESET_IDS,
  PRESET_LABELS,
  PRESET_META,
  presetGroups,
  type PresetId,
} from "../src/presets";

const GROUPS = ["Reference", "Munich hotel (DE)", "Rome restaurants (IT)"];

// ISO 13616: move the first four characters to the end, map A-Z to 10-35, take the whole number
// mod 97; a valid IBAN gives 1. BigInt because the number runs to ~30 digits - the same overflow
// that makes SaxonJS report these IBANs as invalid (see tests/schematron-goldens.test.ts).
function ibanRemainder(iban: string): bigint {
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  const digits = [...rearranged]
    .map((character) =>
      /[A-Z]/.test(character) ? String(character.charCodeAt(0) - 55) : character,
    )
    .join("");
  return BigInt(digits) % 97n;
}

// Belgian enterprise number (KBO/BCE), the check PEPPOL-COMMON-R043 runs via u:mod97-0208:
// ten digits whose last two are 97 - (the first eight mod 97).
function isBelgianEnterpriseNumber(value: string): boolean {
  if (!/^[01][0-9]{9}$/.test(value)) return false;
  return Number(value.slice(8)) === 97 - (Number(value.slice(0, 8)) % 97);
}

// The presets that exist to fail. Every guarantee below that describes a well-formed invoice is
// stated for the others; what each broken preset carries instead is pinned in its own test.
const BROKEN: PresetId[] = ["broken", "be-peppol-broken", "de-hotel-b2g-broken"];

function intact(): PresetId[] {
  return PRESET_IDS.filter((id) => !BROKEN.includes(id));
}

describe("listPresets", () => {
  it("returns full metadata for every PresetId", () => {
    const metas = listPresets();
    expect(metas.map((meta) => meta.id)).toEqual(PRESET_IDS);
    expect(new Set(PRESET_IDS).size).toBe(PRESET_IDS.length);
    for (const meta of metas) {
      expect(meta.id).toBeTruthy();
      expect(meta.label.length).toBeGreaterThan(0);
      expect(meta.group.length).toBeGreaterThan(0);
      expect(meta.summary.length).toBeGreaterThan(20);
      expect(meta.legalBasis.length).toBeGreaterThan(10);
      expect(meta.formatLabel.length).toBeGreaterThan(0);
      expect(["B2C", "B2B", "B2G"]).toContain(meta.audience);
      expect(["PEPPOL", "SDI", "EMAIL"]).toContain(meta.channel);
      expect(["DE", "IT", "BE"]).toContain(meta.country);
      expect(PRESET_LABELS[meta.id]).toBe(meta.label);
      expect(PRESET_META[meta.id]).toBe(meta);
    }
  });

  it("names a legal text or a specification version in every legal basis", () => {
    for (const meta of listPresets()) {
      if (meta.id === "broken") continue;
      expect(
        /\d{4}|\d+\.\d+/.test(meta.legalBasis),
        `${meta.id} legal basis names no version`,
      ).toBe(true);
    }
  });

  it("groups the presets into the picker sections", () => {
    expect(presetGroups().map((section) => section.group)).toEqual(GROUPS);
    const counts = Object.fromEntries(
      presetGroups().map((section) => [section.group, section.presets.length]),
    );
    expect(counts).toEqual({
      Reference: 4,
      "Munich hotel (DE)": 3,
      "Rome restaurants (IT)": 4,
    });
  });
});

describe("preset", () => {
  it("builds an invoice for every id and rejects an unknown one", () => {
    for (const id of PRESET_IDS) expect(preset(id).number.length).toBeGreaterThan(0);
    expect(() => preset("nope" as PresetId)).toThrow(/unknown preset/);
  });

  it("satisfies the EN 16931 model rules for every preset that is not broken on purpose", () => {
    for (const id of intact()) {
      expect(checkModel(preset(id)), `${id} has model findings`).toEqual([]);
    }
  });

  it("declares the format that matches the walkthrough it belongs to", () => {
    expect(preset("de-hotel-b2b-zugferd").format).toBe("cii");
    expect(preset("de-hotel-b2g-xrechnung").format).toBe("xrechnung");
    expect(preset("it-restaurant-b2b-fattura").format).toBe("fatturapa");
    expect(preset("it-restaurant-b2g-fpa12").format).toBe("fatturapa");
    expect(preset("it-restaurant-td04-credit").format).toBe("fatturapa");
  });

  it("gives every preset at least one document reference", () => {
    for (const id of PRESET_IDS) {
      const references = preset(id).references;
      expect(references, `${id} carries no document reference`).toBeDefined();
      expect(
        Object.values(references!).filter((value) => value !== undefined).length,
        `${id} carries no document reference`,
      ).toBeGreaterThan(0);
      // A private guest places no purchase order, so B2C carries BT-18 (the table bill) instead.
      if (PRESET_META[id].audience === "B2C") continue;
      expect(preset(id).references?.purchaseOrder, `${id} has no BT-13`).toBeTruthy();
    }
  });

  it("gives each scenario the references its story needs", () => {
    const references = (id: PresetId): References => preset(id).references!;

    expect(references("de-hotel-b2b-zugferd")).toMatchObject({
      buyerReference: "KST-4711-MUSTERMANN",
      purchaseOrder: "BT-2026-00918",
      invoicedObject: "FOLIO-2026-004182",
    });
    expect(references("de-hotel-b2g-xrechnung")).toMatchObject({
      buyerReference: "991-01234-56",
      purchaseOrder: "BST-2026-004417",
      invoicedObject: "DRG-2026-10442",
    });
    expect(references("it-restaurant-b2b-fattura").invoicedObject).toBe("TAV12-CONTO-00451");
    expect(references("it-restaurant-b2g-fpa12")).toMatchObject({
      purchaseOrder: "ODA-2026-000517",
      tenderOrLot: "CONV-MIC-2026-0042",
    });
    expect(preset("it-restaurant-b2g-fpa12").it).toEqual({
      cup: "J51B26000120001",
      cig: "B12C3D4E5F",
    });
    expect(references("it-restaurant-td04-credit").precedingInvoice).toEqual({
      number: "IT-RM-2026-0117",
      issueDate: "2026-08-24",
    });
  });

  it("keeps every reference short enough for the syntaxes that carry it", () => {
    for (const id of PRESET_IDS) {
      const references = preset(id).references ?? {};
      const alphanumeric32 = [
        references.buyerReference,
        references.project,
        references.contract,
        references.purchaseOrder,
        references.despatchAdvice?.number,
        references.tenderOrLot,
      ];
      for (const value of alphanumeric32.filter(Boolean)) {
        expect(value, `${id}: ${value} is not UAPI AlphaNumerical32`).toMatch(
          /^[0-9A-Za-z.\-_/ ]{1,32}$/,
        );
      }
      const string20 = [
        references.purchaseOrder,
        references.contract,
        references.tenderOrLot,
        references.invoicedObject,
        references.despatchAdvice?.number,
        references.precedingInvoice?.number,
      ];
      for (const value of string20.filter(Boolean)) {
        expect(value!.length, `${id}: ${value} exceeds FatturaPA String20Type`).toBeLessThanOrEqual(
          20,
        );
      }
    }
  });

  it("keeps every identifier obviously fictitious but syntactically valid", () => {
    const ibans = new Set<string>();
    for (const id of PRESET_IDS) {
      const invoice = preset(id);
      if (invoice.payment.iban) {
        expect(invoice.payment.iban).toMatch(/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/);
        ibans.add(invoice.payment.iban);
      }
      if (invoice.payment.bic) expect(invoice.payment.bic).toMatch(/^[A-Z]{6}[A-Z0-9]{2,5}$/);
      for (const party of [invoice.seller, invoice.buyer]) {
        if (party.vatId) expect(party.vatId).toMatch(/^[A-Z]{2}[A-Z0-9]{2,12}$/);
      }
      for (const host of [invoice.seller.contact?.email, invoice.buyer.contact?.email]) {
        if (host) expect(host).toMatch(/@[a-z0-9.-]+\.example$|@example\.[a-z]{2,3}$/);
      }
    }
    expect(ibans.size).toBeGreaterThan(2);
  });

  it("gives every IBAN a valid ISO 13616 check digit", () => {
    const checked: string[] = [];
    for (const id of PRESET_IDS) {
      const { iban } = preset(id).payment;
      if (!iban) continue;
      checked.push(iban);
      expect(ibanRemainder(iban), `${id}: ${iban} fails the IBAN mod-97 check`).toBe(1n);
    }
    expect(new Set(checked).size).toBeGreaterThan(2);
  });

  it("gives every Belgian enterprise number a valid mod-97 check digit", () => {
    const invoice = preset("be-peppol");
    const numbers = [
      invoice.seller.legalRegId,
      invoice.buyer.legalRegId,
      invoice.seller.electronicAddress?.id,
      invoice.buyer.electronicAddress?.id,
      invoice.seller.vatId?.replace(/^BE/, ""),
      invoice.buyer.vatId?.replace(/^BE/, ""),
      invoice.buyer.channel.kind === "PEPPOL"
        ? invoice.buyer.channel.participantId.replace(/^0208:/, "")
        : undefined,
    ];
    expect(numbers.filter(Boolean)).toHaveLength(7);
    for (const number of numbers) {
      expect(isBelgianEnterpriseNumber(number!), `${number} fails PEPPOL-COMMON-R043`).toBe(true);
    }
    expect(invoice.seller.legalRegId).not.toBe(invoice.buyer.legalRegId);
  });

  it("carries the BT-72 delivery date XRechnung BR-DE-TMP-32 asks for", () => {
    expect(preset("de-hotel-b2g-xrechnung").delivery).toEqual({ date: "2026-08-26" });
  });

  it("fills a country x audience matrix with at least one preset per country", () => {
    const cell = (country: string, audience: string) =>
      listPresets()
        .filter((meta) => meta.country === country && meta.audience === audience)
        .map((meta) => meta.id);
    expect(cell("IT", "B2C")).toEqual(["it-restaurant-b2c-pec"]);
    expect(cell("IT", "B2B")).toEqual([
      "it-b2b-sdi",
      "broken",
      "it-restaurant-b2b-fattura",
      "it-restaurant-td04-credit",
    ]);
    expect(cell("IT", "B2G")).toEqual(["it-restaurant-b2g-fpa12"]);
    expect(cell("DE", "B2G")).toEqual(["de-hotel-b2g-xrechnung", "de-hotel-b2g-broken"]);
    expect(cell("BE", "B2B")).toEqual(["be-peppol", "be-peppol-broken"]);
    for (const country of ["DE", "IT", "BE"]) {
      expect(
        listPresets().some((meta) => meta.country === country),
        `${country} has no preset`,
      ).toBe(true);
    }
  });

  it("gives every country a preset that is broken on purpose", () => {
    const byCountry = new Map(BROKEN.map((id) => [PRESET_META[id].country, id]));
    expect([...byCountry.keys()].sort()).toEqual(["BE", "DE", "IT"]);
    for (const id of BROKEN) {
      expect(
        /broken|deliberate|intentional/i.test(`${id} ${PRESET_META[id].summary}`),
        `${id} does not say it is broken`,
      ).toBe(true);
    }
    for (const id of intact()) {
      expect(
        /\bbroken\b|\bdeliberate(ly)?\b|\bintentional(ly)?\b/i.test(
          `${id} ${PRESET_META[id].label} ${PRESET_META[id].group} ${PRESET_META[id].summary}`,
        ),
        `${id} reads as broken but is not`,
      ).toBe(false);
    }
  });

  it("invoices an Italian private individual by name and codice fiscale alone", () => {
    const buyer = preset("it-restaurant-b2c-pec").buyer;
    expect(buyer.person).toEqual({ forename: "Giulia", surname: "Bianchi", gender: "FEMALE" });
    expect(buyer.name).toBe("Giulia Bianchi");
    expect(buyer.vatId).toBeUndefined();
    expect(buyer.taxId).toBe("BNCGLI85E41H501P");
    expect(buyer.channel).toEqual({
      kind: "SDI",
      codiceDestinatario: "0000000",
      pec: "giulia.bianchi@pec.example.it",
    });
    const invoice = preset("it-restaurant-b2c-pec");
    expect(invoice.seller.name).toBe(preset("it-restaurant-b2b-fattura").seller.name);
    expect(invoice.lines.every((line) => line.vat.rate === "10.00")).toBe(true);
    expect(invoice.totals).toEqual({
      lineExtension: "108.00",
      taxExclusive: "108.00",
      taxAmount: "10.80",
      taxInclusive: "118.80",
      payable: "118.80",
    });
  });

  it("gives the Italian codice fiscale a valid check character", () => {
    // Agenzia delle Entrate check character: odd and even positions of the first 15 characters
    // are weighted differently, the sum mod 26 gives the 16th letter.
    const odd = [
      1, 0, 5, 7, 9, 13, 15, 17, 19, 21, 1, 0, 5, 7, 9, 13, 15, 17, 19, 21, 2, 4, 18, 20, 11, 3, 6,
      8, 12, 14, 16, 10, 22, 25, 24, 23,
    ];
    const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const cf = preset("it-restaurant-b2c-pec").buyer.taxId!;
    expect(cf).toMatch(/^[A-Z0-9]{16}$/);
    let total = 0;
    for (const [index, character] of [...cf.slice(0, 15)].entries()) {
      const position = alphabet.indexOf(character);
      // Even positions weigh a digit as itself and a letter as its 0-based alphabet index.
      total += index % 2 === 0 ? odd[position] : position < 10 ? position : position - 10;
    }
    expect("ABCDEFGHIJKLMNOPQRSTUVWXYZ"[total % 26]).toBe(cf[15]);
  });

  it("breaks the Belgian preset on the KBO mod-97 check digit and nothing else", () => {
    const invoice = preset("be-peppol-broken");
    const buyer = invoice.buyer;
    expect(buyer.legalRegId).toBe("0888888896");
    expect(isBelgianEnterpriseNumber(buyer.legalRegId!)).toBe(false);
    expect(isBelgianEnterpriseNumber("0888888895")).toBe(true);
    expect(buyer.vatId).toBe("BE0888888896");
    expect(buyer.electronicAddress).toEqual({ scheme: "0208", id: "0888888896" });
    expect(buyer.channel).toEqual({ kind: "PEPPOL", participantId: "0208:0888888896" });
    expect(isBelgianEnterpriseNumber(invoice.seller.legalRegId!)).toBe(true);
    expect(invoice.format).toBe("ubl");
  });

  it("breaks the German preset on the two XRechnung additions to EN 16931", () => {
    const invoice = preset("de-hotel-b2g-broken");
    // BR-DE-15: BT-10 must carry the Leitweg-ID.
    expect(invoice.references?.buyerReference).toBeUndefined();
    expect(preset("de-hotel-b2g-xrechnung").references?.buyerReference).toBe("991-01234-56");
    // BR-DE-6: BT-42 is mandatory in the CIUS and optional in EN 16931.
    expect(invoice.seller.contact?.phone).toBeUndefined();
    expect(invoice.seller.contact?.email).toBeTruthy();
    expect(invoice.format).toBe("xrechnung");
    // Everything the CIUS still needs is untouched, so nothing else can fire.
    expect(invoice.buyer.electronicAddress).toEqual({ scheme: "0204", id: "991-01234-56" });
    expect(invoice.delivery).toEqual({ date: "2026-08-26" });
  });
});
