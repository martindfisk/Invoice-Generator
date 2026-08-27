import { describe, expect, it } from "vitest";
import { checkSdi, type SdiOptions } from "../src/fatturapa-rules";
import { getFormat } from "../src/formats";
import type { Invoice } from "../src/model";
import { preset, PRESET_IDS } from "../src/presets";
import { transmissionFrom } from "../src/validation";

const CLEAN = "it-restaurant-b2b-fattura";
const RECEIVED_ON = "2026-12-31";

function base(): Invoice {
  return structuredClone(preset(CLEAN));
}

function ids(invoice: Invoice, options: SdiOptions = {}): string[] {
  return checkSdi(invoice, { receivedOn: RECEIVED_ON, ...options }).map((f) => f.ruleId);
}

function fires(mutate: (invoice: Invoice) => void, options: SdiOptions = {}) {
  const invoice = base();
  mutate(invoice);
  return { codes: ids(invoice, options), invoice };
}

describe("the clean Italian preset", () => {
  it("raises no SDI check", () => {
    expect(checkSdi(preset(CLEAN), { receivedOn: RECEIVED_ON })).toEqual([]);
  });

  it("raises no SDI check on any natively Italian preset", () => {
    for (const id of PRESET_IDS.filter((name) => name.startsWith("it-"))) {
      expect(ids(preset(id), {}), id).toEqual([]);
    }
  });

  it("stays clean when the transmission header is read back from the XML it produces", () => {
    const invoice = preset(CLEAN);
    const xml = getFormat("fatturapa").write(invoice);
    expect(transmissionFrom(xml)).toEqual({
      formatoTrasmissione: "FPR12",
      codiceDestinatario: "M5UXCR1",
    });
    expect(ids(invoice, { transmission: transmissionFrom(xml) })).toEqual([]);
  });
});

describe("SDI checks", () => {
  it("00400: Natura is required on a line taxed at 0", () => {
    const { codes } = fires((invoice) => {
      delete invoice.lines[2].vat.natura;
    });
    expect(codes).toContain("00400");
  });

  it("00401: Natura is not allowed on a line with a rate", () => {
    const { codes } = fires((invoice) => {
      invoice.lines[0].vat.natura = "N1";
    });
    expect(codes).toContain("00401");
  });

  it("00403: the invoice date must not be after the day SDI receives it", () => {
    expect(ids(base(), { receivedOn: "2026-08-01" })).toContain("00403");
    expect(ids(base(), { receivedOn: "2026-08-24" })).not.toContain("00403");
  });

  it("00417: the cessionario needs a VAT id or a codice fiscale", () => {
    const { codes } = fires((invoice) => {
      delete invoice.buyer.vatId;
      delete invoice.buyer.taxId;
    });
    expect(codes).toContain("00417");
  });

  it("00419: every rate used on a line needs a DatiRiepilogo", () => {
    const { codes } = fires((invoice) => {
      invoice.lines[0].vat.rate = "22.00";
    });
    expect(codes).toContain("00419");
  });

  it("00421: Imposta must match Imponibile x Aliquota within one euro", () => {
    expect(
      fires((invoice) => {
        invoice.vatBreakdown[0].taxAmount = "0.00";
      }).codes,
    ).toContain("00421");
    expect(
      fires((invoice) => {
        invoice.vatBreakdown[0].taxAmount = "30.00";
      }).codes,
    ).not.toContain("00421");
  });

  it("00422: Imponibile must match the sum of the matching PrezzoTotale within one euro", () => {
    expect(
      fires((invoice) => {
        invoice.vatBreakdown[0].taxableAmount = "500.00";
      }).codes,
    ).toContain("00422");
    expect(
      fires((invoice) => {
        invoice.vatBreakdown[0].taxableAmount = "308.50";
      }).codes,
    ).not.toContain("00422");
  });

  it("00423: PrezzoTotale must be PrezzoUnitario x Quantita within one cent", () => {
    expect(
      fires((invoice) => {
        invoice.lines[0].netAmount = "999.00";
      }).codes,
    ).toContain("00423");
    expect(
      fires((invoice) => {
        invoice.lines[0].netAmount = "272.01";
      }).codes,
    ).not.toContain("00423");
  });

  it("00424: AliquotaIVA must be a percentage", () => {
    expect(
      fires((invoice) => {
        invoice.lines[0].vat.rate = "110.00";
      }).codes,
    ).toContain("00424");
    expect(
      fires((invoice) => {
        invoice.vatBreakdown[0].rate = "-1.00";
      }).codes,
    ).toContain("00424");
  });

  it("00425: Numero must contain a digit", () => {
    const { codes } = fires((invoice) => {
      invoice.number = "FATTURA/UNO";
    });
    expect(codes).toContain("00425");
    expect(codes).toHaveLength(1);
  });

  it("00426: an FPA12 document needs a six-character CodiceDestinatario", () => {
    expect(
      ids(base(), {
        transmission: { formatoTrasmissione: "FPA12", codiceDestinatario: "M5UXCR1" },
      }),
    ).toEqual(["00426"]);
    expect(
      ids(base(), { transmission: { formatoTrasmissione: "FPA12", codiceDestinatario: "UFY9MA" } }),
    ).toEqual([]);
  });

  it("00427: an FPR12 document needs a seven-character CodiceDestinatario", () => {
    const { codes } = fires((invoice) => {
      if (invoice.buyer.channel.kind === "SDI") invoice.buyer.channel.codiceDestinatario = "ABC12";
    });
    expect(codes).toEqual(["00427"]);
  });

  it("00429: a DatiRiepilogo taxed at 0 needs a Natura", () => {
    const { codes } = fires((invoice) => {
      delete invoice.vatBreakdown[1].natura;
    });
    expect(codes).toContain("00429");
  });

  it("00430: a DatiRiepilogo with a rate must not carry a Natura", () => {
    const { codes } = fires((invoice) => {
      invoice.vatBreakdown[0].natura = "N1";
    });
    expect(codes).toContain("00430");
  });

  it("00471: cedente and cessionario must differ on a TD01", () => {
    const { codes } = fires((invoice) => {
      invoice.buyer.vatId = invoice.seller.vatId;
      invoice.buyer.taxId = invoice.seller.taxId;
    });
    expect(codes).toContain("00471");
  });

  it("00471 does not apply to a TD04 credit note", () => {
    const invoice = preset("it-restaurant-td04-credit");
    const same = structuredClone(invoice);
    same.buyer.vatId = same.seller.vatId;
    same.buyer.taxId = same.seller.taxId;
    expect(ids(same)).not.toContain("00471");
  });

  it("cites the check code, a FatturaPA block and a model field", () => {
    const findings = checkSdi(
      (() => {
        const invoice = base();
        delete invoice.lines[2].vat.natura;
        return invoice;
      })(),
      { receivedOn: RECEIVED_ON },
    );
    expect(findings[0]).toMatchObject({
      ruleId: "00400",
      severity: "error",
      fpa: "2.2.1.14",
      field: "lines.2.vat.natura",
    });
    for (const finding of findings) {
      expect(finding.fpa, finding.ruleId).toMatch(/^\d(\.\d+)*$/);
      expect(finding.message, finding.ruleId).not.toBe("");
    }
  });
});
