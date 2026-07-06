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
