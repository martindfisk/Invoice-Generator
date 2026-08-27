import type { Invoice } from "./model";
import { parseUbl } from "./ubl-parse";

export function parseXrechnung(xml: string): Invoice {
  return { ...parseUbl(xml), format: "xrechnung" };
}
