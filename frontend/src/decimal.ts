export type RoundingMode = "half-up" | "half-even";

type Scaled = { units: bigint; scale: number };

const NUMERIC = /^[+-]?(\d+(\.\d*)?|\.\d+)$/;

function toScaled(value: string): Scaled {
  const text = `${value}`.trim();
  if (!NUMERIC.test(text)) {
    throw new Error(`decimal: "${text}" is not a decimal string`);
  }
  const negative = text.startsWith("-");
  const body = text.replace(/^[+-]/, "");
  const dot = body.indexOf(".");
  const whole = dot === -1 ? body : body.slice(0, dot);
  const fraction = dot === -1 ? "" : body.slice(dot + 1);
  const units = BigInt(`${whole || "0"}${fraction}`);
  return { units: negative ? -units : units, scale: fraction.length };
}

function fromScaled({ units, scale }: Scaled): string {
  const negative = units < 0n;
  const digits = (negative ? -units : units).toString().padStart(scale + 1, "0");
  const whole = scale === 0 ? digits : digits.slice(0, digits.length - scale);
  const fraction = scale === 0 ? "" : digits.slice(digits.length - scale).replace(/0+$/, "");
  const text = fraction ? `${whole}.${fraction}` : whole;
  return negative && units !== 0n ? `-${text}` : text;
}

function align(a: Scaled, b: Scaled): { left: bigint; right: bigint; scale: number } {
  const scale = Math.max(a.scale, b.scale);
  return {
    left: a.units * 10n ** BigInt(scale - a.scale),
    right: b.units * 10n ** BigInt(scale - b.scale),
    scale,
  };
}

export function parse(value: string): string {
  return fromScaled(toScaled(value));
}

export function add(a: string, b: string): string {
  const { left, right, scale } = align(toScaled(a), toScaled(b));
  return fromScaled({ units: left + right, scale });
}

export function sub(a: string, b: string): string {
  const { left, right, scale } = align(toScaled(a), toScaled(b));
  return fromScaled({ units: left - right, scale });
}

export function mul(a: string, b: string): string {
  const left = toScaled(a);
  const right = toScaled(b);
  return fromScaled({ units: left.units * right.units, scale: left.scale + right.scale });
}

export function cmp(a: string, b: string): -1 | 0 | 1 {
  const { left, right } = align(toScaled(a), toScaled(b));
  return left < right ? -1 : left > right ? 1 : 0;
}

export function eq(a: string, b: string): boolean {
  return cmp(a, b) === 0;
}

export function neg(value: string): string {
  const scaled = toScaled(value);
  return fromScaled({ units: -scaled.units, scale: scaled.scale });
}

export function abs(value: string): string {
  const scaled = toScaled(value);
  return fromScaled({
    units: scaled.units < 0n ? -scaled.units : scaled.units,
    scale: scaled.scale,
  });
}

export function round(value: string, dp: number, mode: RoundingMode = "half-up"): string {
  if (!Number.isInteger(dp) || dp < 0) {
    throw new Error(`decimal: decimal places must be a non-negative integer, got ${dp}`);
  }
  const scaled = toScaled(value);
  if (scaled.scale <= dp) return fromScaled(scaled);
  const negative = scaled.units < 0n;
  const magnitude = negative ? -scaled.units : scaled.units;
  const factor = 10n ** BigInt(scaled.scale - dp);
  const quotient = magnitude / factor;
  const twiceRemainder = (magnitude % factor) * 2n;
  let units = quotient;
  if (twiceRemainder > factor) units += 1n;
  else if (twiceRemainder === factor && (mode === "half-up" || quotient % 2n === 1n)) units += 1n;
  return fromScaled({ units: negative ? -units : units, scale: dp });
}

export function format(value: string, dp: number, mode: RoundingMode = "half-up"): string {
  const scaled = toScaled(round(value, dp, mode));
  const units = scaled.units * 10n ** BigInt(dp - scaled.scale);
  const negative = units < 0n;
  const digits = (negative ? -units : units).toString().padStart(dp + 1, "0");
  const whole = dp === 0 ? digits : digits.slice(0, digits.length - dp);
  const text = dp === 0 ? whole : `${whole}.${digits.slice(digits.length - dp)}`;
  return negative ? `-${text}` : text;
}

export function sum(values: string[]): string {
  return values.reduce((total, value) => add(total, value), "0");
}

export function percentOf(amount: string, rate: string): string {
  return mul(amount, mul(rate, "0.01"));
}

export function isZero(value: string): boolean {
  return toScaled(value).units === 0n;
}
