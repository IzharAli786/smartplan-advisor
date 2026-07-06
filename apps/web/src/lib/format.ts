import { currencySymbol, type DateFormat } from "@smart-crm/shared";

/**
 * Display preferences come from the org (chosen at registration). They're set once,
 * from the auth response, via setFormatPrefs() — so every money()/date helper below
 * renders in the currency and date format the business picked.
 */
let currency = "USD";
let dateFormat: DateFormat = "MM/DD/YYYY";

export function setFormatPrefs(prefs: { currency?: string | null; dateFormat?: string | null } | null | undefined): void {
  if (!prefs) return;
  if (prefs.currency) currency = prefs.currency;
  if (prefs.dateFormat) dateFormat = prefs.dateFormat as DateFormat;
}

export function currentCurrency(): string {
  return currency;
}
export function currentCurrencySymbol(): string {
  return currencySymbol(currency);
}

export function money(v: number | null | undefined): string {
  if (v == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(v);
}

/** Short money for tight spaces (chart labels): "$12.5k", "£8k". */
export function moneyCompact(n: number): string {
  const s = currencySymbol(currency);
  return n >= 1000 ? `${s}${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : `${s}${Math.round(n)}`;
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Date in the org's chosen format (default US mm/dd/yyyy). */
export function dateShort(v: string | Date | null | undefined): string {
  if (!v) return "—";
  const d = typeof v === "string" ? new Date(v) : v;
  if (Number.isNaN(d.getTime())) return "—";
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const yyyy = d.getFullYear();
  switch (dateFormat) {
    case "DD/MM/YYYY":
      return `${dd}/${mm}/${yyyy}`;
    case "YYYY-MM-DD":
      return `${yyyy}-${mm}-${dd}`;
    case "DD MMM YYYY":
      return `${dd} ${MON[d.getMonth()]} ${yyyy}`;
    default:
      return `${mm}/${dd}/${yyyy}`;
  }
}

export function relativeDue(v: string | null | undefined): string {
  if (!v) return "";
  const d = new Date(v);
  const now = new Date();
  const days = Math.round((d.getTime() - now.getTime()) / 86_400_000);
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days === 0) return "due today";
  if (days === 1) return "due tomorrow";
  return `due in ${days}d`;
}

export function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

/** Date + time in the org's chosen date format, with h:mm AM/PM. */
export function dateTimeShort(v: string | Date | null | undefined): string {
  if (!v) return "—";
  const d = typeof v === "string" ? new Date(v) : v;
  if (Number.isNaN(d.getTime())) return "—";
  const t = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `${dateShort(d)} ${t}`;
}
