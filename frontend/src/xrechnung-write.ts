import type { Invoice } from "./model";
import { writeUbl } from "./ubl-write";
import { XRECHNUNG_CUSTOMIZATION_ID } from "./xrechnung-map";

export function writeXrechnung(invoice: Invoice): string {
  return writeUbl(invoice, XRECHNUNG_CUSTOMIZATION_ID);
}
