/**
 * Normalization helpers used at write time by the API and for preview on the client.
 * Keeping these in the shared package guarantees the client and server compute the
 * SAME normalized value, so duplicate matching (§5.1) is consistent.
 */

const COMPANY_NOISE_TOKENS = new Set([
  "inc",
  "incorporated",
  "llc",
  "llp",
  "ltd",
  "co",
  "corp",
  "corporation",
  "company",
  "hvac",
  "heating",
  "cooling",
  "mechanical",
  "services",
  "service",
  "the",
]);

/**
 * Lowercase, strip punctuation, drop common HVAC/legal noise tokens, collapse spaces.
 * Used for `company_name_normalized` and pg_trgm similarity matching.
 */
export function normalizeCompanyName(raw: string): string {
  const cleaned = raw
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const kept = cleaned
    .split(" ")
    .filter((tok) => tok.length > 0 && !COMPANY_NOISE_TOKENS.has(tok));
  // If filtering removed everything (e.g. literally "HVAC Services"), fall back to cleaned.
  return (kept.length > 0 ? kept.join(" ") : cleaned).trim();
}

/**
 * Territory-matching key (§5.1): lowercase, strip punctuation, collapse spaces —
 * but KEEP every token, including legal/industry suffixes.
 *
 *   "Acme, Inc."  === "acme inc"        → same account, blocks
 *   "Acme Inc"    !== "Acme LLC"        → different accounts, no block
 *   "Acme HVAC"   !== "Acme Plumbing"   → different accounts, no block
 *
 * Deliberately DIFFERENT from normalizeCompanyName, which deletes noise tokens and
 * would collapse "Acme Inc" and "Acme LLC" onto one key. This one backs the exact
 * duplicate check that blocks an advisor's save, so a false match stops real work —
 * it must only fire when the two names are genuinely the same string.
 *
 * Use it for the territory block ONLY. Cross-system lookups (SmartPlan/Stripe, which
 * send legal billing names) still want the tolerant normalizeCompanyName.
 */
export function normalizeCompanyKey(raw: string): string {
  const cleaned = raw
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  // Non-Latin / punctuation-only names clean to "" — fall back to the raw lowercased
  // name so distinct companies never collapse onto one empty key (same guard the
  // SmartPlan activation ingest uses).
  return cleaned || raw.trim().toLowerCase();
}

/**
 * Best-effort E.164 normalization for US numbers (the advisor roster is US-based).
 * Returns null when we can't confidently normalize, so matching skips it rather than
 * matching on garbage.
 */
export function normalizePhoneE164(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length === 0) return null;
  // Already has a plus / international — keep digits with leading +.
  if (raw.trim().startsWith("+") && digits.length >= 8) return `+${digits}`;
  return null;
}

/** Lowercased, trimmed email for equality matching. */
export function normalizeEmail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const e = raw.trim().toLowerCase();
  return e.length > 0 ? e : null;
}
