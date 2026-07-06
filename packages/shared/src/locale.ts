/**
 * Per-organization locale preferences — chosen at registration, applied everywhere
 * money and dates are displayed. Kept here so the API (validation) and the web app
 * (dropdowns + formatting) share a single source of truth.
 */

export interface CurrencyOption {
  code: string; // ISO 4217, stored on the org
  label: string;
  symbol: string;
}

export const CURRENCIES: CurrencyOption[] = [
  { code: "USD", label: "US Dollar ($)", symbol: "$" },
  { code: "GBP", label: "British Pound (£)", symbol: "£" },
  { code: "EUR", label: "Euro (€)", symbol: "€" },
  { code: "CAD", label: "Canadian Dollar (C$)", symbol: "C$" },
  { code: "AUD", label: "Australian Dollar (A$)", symbol: "A$" },
  { code: "NZD", label: "New Zealand Dollar (NZ$)", symbol: "NZ$" },
];

export const CURRENCY_CODES = CURRENCIES.map((c) => c.code) as [string, ...string[]];
export const DEFAULT_CURRENCY = "USD";

export type DateFormat = "MM/DD/YYYY" | "DD/MM/YYYY" | "YYYY-MM-DD" | "DD MMM YYYY";

export interface DateFormatOption {
  value: DateFormat;
  label: string;
}

export const DATE_FORMATS: DateFormatOption[] = [
  { value: "MM/DD/YYYY", label: "MM/DD/YYYY — 07/03/2026 (US)" },
  { value: "DD/MM/YYYY", label: "DD/MM/YYYY — 03/07/2026 (UK / EU)" },
  { value: "YYYY-MM-DD", label: "YYYY-MM-DD — 2026-07-03 (ISO)" },
  { value: "DD MMM YYYY", label: "DD MMM YYYY — 03 Jul 2026" },
];

export const DATE_FORMAT_VALUES = DATE_FORMATS.map((d) => d.value) as [DateFormat, ...DateFormat[]];
export const DEFAULT_DATE_FORMAT: DateFormat = "MM/DD/YYYY";

export function currencySymbol(code: string): string {
  return CURRENCIES.find((c) => c.code === code)?.symbol ?? "$";
}
