import type { MappingRow } from "./model";
import { UBL_MAP } from "./ubl-map";

// BR-DE-21 accepts only the three identifiers the KoSIT Schematron builds from
// urn:xeinkauf.de (XRechnung-UBL-validation.xsl 2.5.0, $XR-CIUS-ID / $XR-EXTENSION-ID /
// $XR-CVD-ID). The urn:xoev-de:kosit:standard form belongs to XRechnung 2.x and was retired
// when KoSIT moved the URN namespace to xeinkauf.de for 3.0.
export const XRECHNUNG_CUSTOMIZATION_ID =
  "urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0";

export const XRECHNUNG_SPEC =
  "XRechnung 3.0.2 (KoSIT CIUS of EN 16931-1:2017) on the UBL 2.1 binding";

export const XRECHNUNG_LEITWEG_SCHEME = "0204";

const LABELS: Record<string, string> = {
  "BT-24": "Specification identifier (XRechnung 3.0.2, urn:xeinkauf.de:kosit:xrechnung_3.0)",
  "BT-10": "Buyer reference - Leitweg-ID, mandatory in XRechnung (BR-DE-15)",
  "BT-41": "Seller contact point - mandatory in XRechnung (BR-DE-5)",
  "BT-42": "Seller contact telephone number - mandatory in XRechnung (BR-DE-6)",
  "BT-43": "Seller contact email address - mandatory in XRechnung (BR-DE-7)",
};

export const XRECHNUNG_MAP: MappingRow[] = UBL_MAP.map((row) => {
  const label = row.bt ? LABELS[row.bt] : undefined;
  return label ? { ...row, label } : row;
});
