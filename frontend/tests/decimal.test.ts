import { describe, expect, it } from "vitest";
import {
  abs,
  add,
  cmp,
  eq,
  format,
  isZero,
  mul,
  neg,
  parse,
  percentOf,
  round,
  sub,
  sum,
} from "../src/decimal";

describe("parse", () => {
  it("canonicalises decimal strings", () => {
    expect(parse("0.10")).toBe("0.1");
    expect(parse("1.500")).toBe("1.5");
    expect(parse("0012.30")).toBe("12.3");
    expect(parse("+7")).toBe("7");
    expect(parse("-0.0")).toBe("0");
    expect(parse(" 22.00 ")).toBe("22");
    expect(parse(".5")).toBe("0.5");
  });

  it("throws on non-numeric input", () => {
    for (const value of ["", "abc", "1,5", "1.2.3", "1e3", "--1", "NaN", "12 34"]) {
      expect(() => parse(value)).toThrow(/is not a decimal string/);
    }
  });
});

describe("arithmetic", () => {
  it("adds without binary floating point error", () => {
    expect(add("0.1", "0.2")).toBe("0.3");
    expect(add("1250.00", "262.50")).toBe("1512.5");
    expect(sum(["1500.00", "500.00", "800.00"])).toBe("2800");
    expect(sum([])).toBe("0");
  });

  it("subtracts and negates across zero", () => {
    expect(sub("0.3", "0.1")).toBe("0.2");
    expect(sub("1.00", "1.00")).toBe("0");
    expect(sub("1.00", "3.50")).toBe("-2.5");
    expect(neg("-2.5")).toBe("2.5");
    expect(neg("0.00")).toBe("0");
    expect(abs("-1234.56")).toBe("1234.56");
  });

  it("multiplies with the sum of the operand scales", () => {
    expect(mul("1.05", "2")).toBe("2.1");
    expect(mul("-3.5", "2.5")).toBe("-8.75");
    expect(mul("0.00", "12.34")).toBe("0");
    expect(percentOf("1500.00", "22.00")).toBe("330");
    expect(percentOf("1250.00", "21.00")).toBe("262.5");
  });

  it("compares by value, not by text", () => {
    expect(cmp("1.10", "1.1")).toBe(0);
    expect(cmp("2", "10")).toBe(-1);
    expect(cmp("-1", "-2")).toBe(1);
    expect(eq("22.00", "22")).toBe(true);
    expect(eq("-0.00", "0")).toBe(true);
    expect(isZero("0.000")).toBe(true);
    expect(isZero("0.001")).toBe(false);
  });
});

describe("round", () => {
  it("rounds halves away from zero by default", () => {
    expect(round("1.005", 2)).toBe("1.01");
    expect(round("2.675", 2)).toBe("2.68");
    expect(round("-1.005", 2)).toBe("-1.01");
    expect(round("0.005", 2)).toBe("0.01");
    expect(round("1.004999", 2)).toBe("1");
  });

  it("supports banker's rounding", () => {
    expect(round("1.005", 2, "half-even")).toBe("1");
    expect(round("1.015", 2, "half-even")).toBe("1.02");
    expect(round("-1.005", 2, "half-even")).toBe("-1");
  });

  it("keeps shorter values untouched and rejects bad precision", () => {
    expect(round("1.5", 4)).toBe("1.5");
    expect(round("7", 0)).toBe("7");
    expect(() => round("1.5", -1)).toThrow(/non-negative integer/);
  });
});

describe("format", () => {
  it("pads and truncates to a fixed number of decimals", () => {
    expect(format("1250", 2)).toBe("1250.00");
    expect(format("0.1", 2)).toBe("0.10");
    expect(format("22.00", 2)).toBe("22.00");
    expect(format("-3.456", 2)).toBe("-3.46");
    expect(format("1.005", 2)).toBe("1.01");
    expect(format("3180", 0)).toBe("3180");
    expect(format("-0.001", 2)).toBe("0.00");
  });
});
