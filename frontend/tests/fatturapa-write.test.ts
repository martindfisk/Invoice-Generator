import { describe, expect, it } from "vitest";
import {
  FATTURAPA_MAP,
  FATTURAPA_NAMESPACE,
  FORMATO_TRASMISSIONE_B2B,
  FORMATO_TRASMISSIONE_B2G,
  fpaRow,
} from "../src/fatturapa-map";
import {
  codiceDestinatario,
  formatoTrasmissione,
  progressivoInvio,
  writeFatturapa,
} from "../src/fatturapa-write";
import { parseFatturapa } from "../src/fatturapa-parse";
import { preset, PRESET_IDS } from "../src/presets";

const HEADER_ORDER = [
  "DatiTrasmissione",
  "CedentePrestatore",
  "RappresentanteFiscale",
  "CessionarioCommittente",
  "TerzoIntermediarioOSoggettoEmittente",
  "SoggettoEmittente",
];

const TRANSMISSION_ORDER = [
  "IdTrasmittente",
  "ProgressivoInvio",
  "FormatoTrasmissione",
  "CodiceDestinatario",
  "ContattiTrasmittente",
  "PECDestinatario",
];

const DATI_GENERALI_ORDER = [
  "DatiGeneraliDocumento",
  "DatiOrdineAcquisto",
  "DatiContratto",
  "DatiConvenzione",
  "DatiRicezione",
  "DatiFattureCollegate",
  "DatiSAL",
  "DatiDDT",
  "DatiTrasporto",
  "FatturaPrincipale",
];

const GENERAL_ORDER = [
  "TipoDocumento",
  "Divisa",
  "Data",
  "Numero",
  "DatiRitenuta",
  "DatiBollo",
  "DatiCassaPrevidenziale",
  "ScontoMaggiorazione",
  "ImportoTotaleDocumento",
  "Arrotondamento",
  "Causale",
  "Art73",
];

const DETAIL_ORDER = [
  "NumeroLinea",
  "TipoCessionePrestazione",
  "CodiceArticolo",
  "Descrizione",
  "Quantita",
  "UnitaMisura",
  "DataInizioPeriodo",
  "DataFinePeriodo",
  "PrezzoUnitario",
  "ScontoMaggiorazione",
  "PrezzoTotale",
  "AliquotaIVA",
  "Ritenuta",
  "Natura",
  "RiferimentoAmministrazione",
  "AltriDatiGestionali",
];

const SUMMARY_ORDER = [
  "AliquotaIVA",
  "Natura",
  "SpeseAccessorie",
  "Arrotondamento",
  "ImponibileImporto",
  "Imposta",
  "EsigibilitaIVA",
  "RiferimentoNormativo",
];

function block(xml: string, name: string): string {
  const match = new RegExp(`<${name}>[\\s\\S]*?</${name}>`).exec(xml);
  if (!match) throw new Error(`no <${name}> in the document`);
  return match[0];
}

function names(fragment: string, depth: number): string[] {
  const pattern = new RegExp(`^ {${depth}}<(\\w+)[ />]`, "gm");
  return [...fragment.matchAll(pattern)].map((match) => match[1]);
}

function expectOrder(actual: string[], order: string[]): void {
  const ranks = actual.map((name) => order.indexOf(name));
  expect(ranks).not.toContain(-1);
  expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
}

describe("writeFatturapa", () => {
  for (const id of PRESET_IDS) {
    it(`matches the golden FatturaPA for "${id}"`, async () => {
      await expect(writeFatturapa(preset(id))).toMatchFileSnapshot(`./golden/${id}.fatturapa.xml`);
    });
  }

  it("declares the 1.2 namespace on a prefixed root with unqualified children", () => {
    const xml = writeFatturapa(preset("it-b2b-sdi"));
    expect(xml).toContain(
      `<p:FatturaElettronica xmlns:p="${FATTURAPA_NAMESPACE}" versione="${FORMATO_TRASMISSIONE_B2B}">`,
    );
    expect(xml).toContain("  <FatturaElettronicaHeader>");
    expect(xml).not.toMatch(/<p:(?!FatturaElettronica)/);
  });

  it("keeps header, transmission, document, line and summary blocks in spec order", () => {
    for (const id of PRESET_IDS) {
      const xml = writeFatturapa(preset(id));
      expectOrder(names(block(xml, "FatturaElettronicaHeader"), 4), HEADER_ORDER);
      expectOrder(names(block(xml, "DatiTrasmissione"), 6), TRANSMISSION_ORDER);
      expectOrder(names(block(xml, "DatiGenerali"), 6), DATI_GENERALI_ORDER);
      expectOrder(names(block(xml, "DatiGeneraliDocumento"), 8), GENERAL_ORDER);
      expectOrder(names(block(xml, "DettaglioLinee"), 8), DETAIL_ORDER);
      expectOrder(names(block(xml, "DatiRiepilogo"), 8), SUMMARY_ORDER);
    }
  });

  it("writes TD01 for a commercial invoice and RF01 for the ordinary regime", () => {
    const xml = writeFatturapa(preset("it-b2b-sdi"));
    expect(xml).toContain("<TipoDocumento>TD01</TipoDocumento>");
    expect(xml).toContain("<RegimeFiscale>RF01</RegimeFiscale>");
    expect(xml).toContain("<CodiceDestinatario>ABC1234</CodiceDestinatario>");
  });

  it("splits the VAT identifier into IdPaese and IdCodice", () => {
    const xml = writeFatturapa(preset("it-b2b-sdi"));
    expect(block(xml, "IdFiscaleIVA")).toContain("<IdPaese>IT</IdPaese>");
    expect(block(xml, "IdFiscaleIVA")).toContain("<IdCodice>01234567890</IdCodice>");
  });

  it("carries Natura, RiferimentoNormativo and the INTENTO management data", () => {
    const xml = writeFatturapa(preset("it-b2b-sdi"));
    expect(xml).toContain("<Natura>N3.5</Natura>");
    const reason = preset("it-b2b-sdi").vatBreakdown.find((row) => row.natura === "N3.5")!.reason!;
    expect(reason.length).toBeLessThanOrEqual(100);
    const escaped = reason.replace(/'/g, "&apos;");
    expect(xml).toContain(`<RiferimentoNormativo>${escaped}</RiferimentoNormativo>`);
    expect(xml).toContain("<TipoDato>INTENTO</TipoDato>");
    expect(xml).toContain("<RiferimentoTesto>08060120345678901-000001</RiferimentoTesto>");
    expect(xml).toContain("<RiferimentoData>2026-01-15</RiferimentoData>");
  });

  it("uses two decimals for amounts, rates and quantities", () => {
    const xml = writeFatturapa(preset("it-b2b-sdi"));
    expect(xml).toContain("<PrezzoTotale>1500.00</PrezzoTotale>");
    expect(xml).toContain("<AliquotaIVA>22.00</AliquotaIVA>");
    expect(xml).toContain("<Quantita>10.00</Quantita>");
    expect(xml).toContain("<ImportoTotaleDocumento>3180.00</ImportoTotaleDocumento>");
  });

  it("falls back to 0000000 or XXXXXXX when there is no SDI inbox", () => {
    expect(codiceDestinatario({ kind: "PEPPOL", participantId: "0208:1" }, "IT")).toBe("0000000");
    expect(codiceDestinatario({ kind: "PEPPOL", participantId: "0208:1" }, "BE")).toBe("XXXXXXX");
    const xml = writeFatturapa(preset("be-peppol"));
    expect(xml).toContain("<CodiceDestinatario>XXXXXXX</CodiceDestinatario>");
    expect(xml).not.toContain("<PECDestinatario>");
  });

  it("derives a deterministic ProgressivoInvio from the invoice number", () => {
    expect(progressivoInvio("IT-INV-0001")).toBe("ITINV0001");
    expect(progressivoInvio("BE-INV-2026-0007")).toBe("NV20260007");
    expect(progressivoInvio("///")).toBe("1");
  });

  it("leaves the missing buyer country out instead of writing an empty element", () => {
    const xml = writeFatturapa(preset("broken"));
    expect(xml).not.toContain("<Nazione></Nazione>");
    expect(xml).not.toMatch(/<\w+\/>/);
    expect(block(xml, "CessionarioCommittente")).not.toContain("<Nazione>");
  });

  it("names a private individual with Nome and Cognome and no IdFiscaleIVA", () => {
    // AnagraficaType is an xs:choice and DatiAnagraficiCessionarioType makes IdFiscaleIVA optional,
    // so a consumer is CodiceFiscale + Nome + Cognome and nothing else (SDI check 00417).
    const buyer = block(writeFatturapa(preset("it-restaurant-b2c-pec")), "CessionarioCommittente");
    expect(buyer).toContain("<CodiceFiscale>BNCGLI85E41H501P</CodiceFiscale>");
    expect(buyer).toContain("<Nome>Giulia</Nome>");
    expect(buyer).toContain("<Cognome>Bianchi</Cognome>");
    expect(buyer).not.toContain("<Denominazione>");
    expect(buyer).not.toContain("<IdFiscaleIVA>");
    expect(buyer.indexOf("<Nome>")).toBeLessThan(buyer.indexOf("<Cognome>"));
    expect(buyer.indexOf("<CodiceFiscale>")).toBeLessThan(buyer.indexOf("<Anagrafica>"));
    // The seller is a company on the same invoice, so both branches are exercised at once.
    const seller = block(writeFatturapa(preset("it-restaurant-b2c-pec")), "CedentePrestatore");
    expect(seller).toContain("<Denominazione>Trattoria del Colosseo S.r.l.</Denominazione>");
    expect(seller).not.toContain("<Nome>");
  });

  it("rebuilds BT-44 from Nome and Cognome when it reads a consumer back", () => {
    const parsed = parseFatturapa(writeFatturapa(preset("it-restaurant-b2c-pec")));
    expect(parsed.buyer.name).toBe("Giulia Bianchi");
    expect(parsed.buyer.person).toEqual({ forename: "Giulia", surname: "Bianchi" });
    expect(parsed.buyer.vatId).toBeUndefined();
    expect(parsed.buyer.taxId).toBe("BNCGLI85E41H501P");
    // Gender has no FatturaPA element, so the XML cannot give it back.
    expect(parsed.buyer.person?.gender).toBeUndefined();
    expect(parseFatturapa(writeFatturapa(preset("it-b2b-sdi"))).buyer.person).toBeUndefined();
  });

  it("only emits element names that exist in the mapping table", () => {
    const declared = new Set(FATTURAPA_MAP.map((row) => row.path.split("/").pop() ?? ""));
    const structural = new Set([
      "p:FatturaElettronica",
      "FatturaElettronicaHeader",
      "FatturaElettronicaBody",
      "DatiTrasmissione",
      "IdTrasmittente",
      "CedentePrestatore",
      "CessionarioCommittente",
      "DatiAnagrafici",
      "IdFiscaleIVA",
      "Anagrafica",
      "Sede",
      "IscrizioneREA",
      "Contatti",
      "DatiGenerali",
      "DatiGeneraliDocumento",
      "DatiOrdineAcquisto",
      "DatiContratto",
      "DatiConvenzione",
      "DatiRicezione",
      "DatiFattureCollegate",
      "DatiDDT",
      "DatiBollo",
      "DatiBeniServizi",
      "DettaglioLinee",
      "AltriDatiGestionali",
      "DatiRiepilogo",
      "DatiPagamento",
      "DettaglioPagamento",
    ]);
    for (const id of PRESET_IDS) {
      const emitted = [...writeFatturapa(preset(id)).matchAll(/<([A-Za-z][\w:]*)[ />]/g)].map(
        (match) => match[1],
      );
      for (const name of emitted) {
        expect(declared.has(name) || structural.has(name)).toBe(true);
      }
    }
  });

  it("switches FormatoTrasmissione with the length of the destination code (SDI 00426/00427)", () => {
    expect(formatoTrasmissione({ kind: "SDI", codiceDestinatario: "UFY9K3" }, "IT")).toBe(
      FORMATO_TRASMISSIONE_B2G,
    );
    expect(formatoTrasmissione({ kind: "SDI", codiceDestinatario: "M5UXCR1" }, "IT")).toBe(
      FORMATO_TRASMISSIONE_B2B,
    );

    const b2g = writeFatturapa(preset("it-restaurant-b2g-fpa12"));
    expect(b2g).toContain(`versione="${FORMATO_TRASMISSIONE_B2G}"`);
    expect(b2g).toContain("<FormatoTrasmissione>FPA12</FormatoTrasmissione>");
    expect(b2g).toContain("<CodiceDestinatario>UFY9K3</CodiceDestinatario>");
    expect(/<CodiceDestinatario>([A-Z0-9]+)<\/CodiceDestinatario>/.exec(b2g)![1]).toHaveLength(6);

    const b2b = writeFatturapa(preset("it-restaurant-b2b-fattura"));
    expect(b2b).toContain(`versione="${FORMATO_TRASMISSIONE_B2B}"`);
    expect(b2b).toContain("<FormatoTrasmissione>FPR12</FormatoTrasmissione>");
    expect(/<CodiceDestinatario>([A-Z0-9]+)<\/CodiceDestinatario>/.exec(b2b)![1]).toHaveLength(7);
  });

  it("writes the EUR 2.00 virtual stamp duty between Numero and ImportoTotaleDocumento", () => {
    const xml = writeFatturapa(preset("it-restaurant-b2b-fattura"));
    expect(block(xml, "DatiBollo")).toContain("<BolloVirtuale>SI</BolloVirtuale>");
    expect(block(xml, "DatiBollo")).toContain("<ImportoBollo>2.00</ImportoBollo>");
    expect(xml.indexOf("<DatiBollo>")).toBeGreaterThan(xml.indexOf("<Numero>"));
    expect(xml.indexOf("<DatiBollo>")).toBeLessThan(xml.indexOf("<ImportoTotaleDocumento>"));
    expect(writeFatturapa(preset("it-b2b-sdi"))).not.toContain("<DatiBollo>");
  });

  it("carries CUP and CIG inside DatiOrdineAcquisto after IdDocumento", () => {
    const order = block(writeFatturapa(preset("it-restaurant-b2g-fpa12")), "DatiOrdineAcquisto");
    expectOrder(names(order, 8), ["IdDocumento", "CodiceCUP", "CodiceCIG"]);
    expect(order).toContain("<IdDocumento>ODA-2026-000517</IdDocumento>");
    expect(order).toContain("<CodiceCUP>J51B26000120001</CodiceCUP>");
    expect(order).toContain("<CodiceCIG>B12C3D4E5F</CodiceCIG>");
  });

  it("puts the convenzione, the invoiced object and the DDT in their own 2.1.x blocks", () => {
    const rome = writeFatturapa(preset("it-restaurant-b2g-fpa12"));
    expect(block(rome, "DatiContratto")).toContain("<IdDocumento>CTR-MIC-2026-0088</IdDocumento>");
    expect(block(rome, "DatiConvenzione")).toContain(
      "<IdDocumento>CONV-MIC-2026-0042</IdDocumento>",
    );

    const lunch = writeFatturapa(preset("it-restaurant-b2b-fattura"));
    expect(block(lunch, "DatiRicezione")).toContain("<IdDocumento>TAV12-CONTO-00451</IdDocumento>");

    const lyon = writeFatturapa(preset("fr-store-b2b-facturx"));
    expectOrder(names(block(lyon, "DatiDDT"), 8), ["NumeroDDT", "DataDDT"]);
    expect(block(lyon, "DatiDDT")).toContain("<NumeroDDT>BL-2026-0873</NumeroDDT>");
    expect(block(lyon, "DatiDDT")).toContain("<DataDDT>2026-08-25</DataDDT>");
  });

  it("omits DatiDDT unless the despatch advice carries the mandatory DataDDT", () => {
    const source = preset("fr-store-b2b-facturx");
    const references = { ...source.references, despatchAdvice: { number: "BL-2026-0873" } };
    expect(writeFatturapa({ ...source, references })).not.toContain("<DatiDDT>");
  });

  it("reads the FatturaPA-carried references back out of its own output", () => {
    for (const id of PRESET_IDS) {
      const references = preset(id).references ?? {};
      const parsed = parseFatturapa(writeFatturapa(preset(id))).references ?? {};
      expect(parsed.purchaseOrder, id).toBe(references.purchaseOrder);
      expect(parsed.contract, id).toBe(references.contract);
      expect(parsed.tenderOrLot, id).toBe(references.tenderOrLot);
      expect(parsed.invoicedObject, id).toBe(references.invoicedObject);
      expect(parsed.despatchAdvice, id).toEqual(references.despatchAdvice);
      expect(parsed.precedingInvoice, id).toEqual(references.precedingInvoice);
    }
  });

  it("writes TD04 with DatiFattureCollegate pointing at the original invoice", () => {
    const source = preset("it-restaurant-td04-credit");
    const original = preset("it-restaurant-b2b-fattura");
    expect(source.typeCode).toBe("381");
    const xml = writeFatturapa(source);
    expect(xml).toContain("<TipoDocumento>TD04</TipoDocumento>");
    const linked = block(xml, "DatiFattureCollegate");
    expect(linked).toContain(`<IdDocumento>${original.number}</IdDocumento>`);
    expect(linked).toContain(`<Data>${original.issueDate}</Data>`);
    expect(source.references?.precedingInvoice).toEqual({
      number: original.number,
      issueDate: original.issueDate,
    });
    for (const line of source.lines) expect(Number(line.netAmount)).toBeGreaterThan(0);
    expect(source.seller.vatId).not.toBe(source.buyer.vatId);
  });

  it("resolves mapping rows by their spec number", () => {
    expect(fpaRow("2.2.2.8").path).toMatch(/DatiRiepilogo\[\{i\}\]\/RiferimentoNormativo$/);
    expect(() => fpaRow("9.9.9")).toThrow(/no row for 9.9.9/);
  });
});
