/**
 * Money and duration arithmetic.
 *
 * Every monetary value in this plugin is an integer count of minor units
 * (cents, pence, yen). Every duration is an integer count of seconds. Floats
 * are introduced exactly once, at the edge, when a human types a rate into the
 * settings tab — and are converted to integers immediately.
 *
 * The reason is not pedantry. `Math.round(hours / 0.1) * 0.1` yields
 * 0.30000000000000004, and summing float amounts across twenty line items
 * drifts. On an invoice that drift is a number somebody is asked to pay.
 */

/** Currencies whose minor unit is not 1/100. Everything else defaults to 2. */
const MINOR_UNIT_DIGITS: Record<string, number> = {
  BIF: 0, CLP: 0, DJF: 0, GNF: 0, ISK: 0, JPY: 0, KMF: 0, KRW: 0,
  PYG: 0, RWF: 0, UGX: 0, UYI: 0, VND: 0, VUV: 0, XAF: 0, XOF: 0, XPF: 0,
  BHD: 3, IQD: 3, JOD: 3, KWD: 3, LYD: 3, OMR: 3, TND: 3,
};

/**
 * Decimal places for a currency. The setting accepts a symbol ("£") as well as
 * a code, so anything unrecognised gets the 2-digit default rather than an
 * error — a wrong symbol must never block an invoice.
 */
export function minorUnitDigits(currency: string): number {
  const code = currency.trim().toUpperCase();
  return MINOR_UNIT_DIGITS[code] ?? 2;
}

export function minorUnitScale(currency: string): number {
  return Math.pow(10, minorUnitDigits(currency));
}

/**
 * Convert a human-typed rate ("87.5") into integer minor units.
 * Returns null for anything that is not a finite, non-negative number, so the
 * caller can refuse rather than bill NaN.
 */
export function parseRateToMinor(input: string | number, currency: string): number | null {
  let n: number;
  if (typeof input === "number") {
    n = input;
  } else {
    const trimmed = input.trim();
    // `Number("")` is 0, which would quietly bill every line at nothing.
    if (trimmed === "") return null;
    n = Number(trimmed.replace(",", "."));
  }
  if (!Number.isFinite(n) || n < 0) return null;
  const scaled = Math.round(n * minorUnitScale(currency));
  if (!Number.isSafeInteger(scaled)) return null;
  return scaled;
}

/** Format integer minor units for display: `USD 1234.50`. */
export function formatMoney(minor: number, currency: string): string {
  const digits = minorUnitDigits(currency);
  const scale = Math.pow(10, digits);
  const negative = minor < 0;
  const abs = Math.abs(minor);
  const whole = Math.floor(abs / scale);
  const frac = abs % scale;
  const body = digits === 0 ? String(whole) : `${whole}.${String(frac).padStart(digits, "0")}`;
  return `${negative ? "-" : ""}${currency} ${body}`;
}

/** Format integer seconds as decimal hours, for display only. */
export function formatHours(seconds: number): string {
  return (seconds / 3600).toFixed(2);
}

/**
 * Round a duration to a billing increment.
 *
 * `stepHours` comes from settings (0.25 = nearest quarter hour, 0 = none).
 * Rounding is half-up on exact ties so a 7.5-minute entry under quarter-hour
 * rounding bills 0.25h rather than 0 — the direction a freelancer expects.
 *
 * A non-zero duration can still round to zero (a 2-minute entry under
 * quarter-hour rounding). That is correct behaviour for the policy, but the
 * caller must surface it instead of letting the line vanish; see
 * `InvoiceLine.roundedToZero`.
 */
export function roundSeconds(seconds: number, stepHours: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  if (!Number.isFinite(stepHours) || stepHours <= 0) return Math.round(seconds);
  const stepSeconds = Math.round(stepHours * 3600);
  if (stepSeconds <= 0) return Math.round(seconds);
  return Math.floor(seconds / stepSeconds + 0.5) * stepSeconds;
}

/**
 * Amount for a duration at a rate, in integer minor units.
 *
 * Computed as a single integer expression so there is no intermediate float:
 * seconds * rateMinor / 3600, rounded half-up. At realistic magnitudes
 * (10^7 seconds, 10^7 minor units) the product stays well inside
 * Number.MAX_SAFE_INTEGER; the guard catches the unrealistic rest.
 */
export function amountMinor(seconds: number, rateMinorPerHour: number): number {
  if (seconds <= 0 || rateMinorPerHour <= 0) return 0;
  const product = seconds * rateMinorPerHour;
  if (!Number.isSafeInteger(product)) {
    // Fall back to a two-step division that loses precision rather than
    // silently returning a wrong integer.
    return Math.round((seconds / 3600) * rateMinorPerHour);
  }
  return Math.floor(product / 3600 + 0.5);
}

/** Sum integer minor units. Separate function so the intent is greppable. */
export function sumMinor(values: readonly number[]): number {
  let total = 0;
  for (const v of values) total += v;
  return total;
}
