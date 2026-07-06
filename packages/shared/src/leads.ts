import { z } from "zod";

/**
 * Apollo lead import — canonical field set the admin uploads, plus header-matching
 * so a slightly-varied Apollo export still maps cleanly. Shared so the API validates
 * and the web app renders the same field labels.
 */

export type ApolloField =
  | "first_name"
  | "last_name"
  | "title"
  | "company_name"
  | "email"
  | "department"
  | "corporate_phone"
  | "num_employees"
  | "keywords"
  | "linkedin_url"
  | "website"
  | "company_address"
  | "company_city"
  | "company_state"
  | "company_phone"
  | "technologies"
  | "annual_revenue"
  | "subsidiary_of";

export const APOLLO_LEAD_FIELDS: { key: ApolloField; label: string }[] = [
  { key: "first_name", label: "First Name" },
  { key: "last_name", label: "Last Name" },
  { key: "title", label: "Title" },
  { key: "company_name", label: "Company Name" },
  { key: "email", label: "Email" },
  { key: "department", label: "Department" },
  { key: "corporate_phone", label: "Corporate Phone" },
  { key: "num_employees", label: "# of Employees" },
  { key: "keywords", label: "Keywords" },
  { key: "linkedin_url", label: "Person LinkedIn URL" },
  { key: "website", label: "Website" },
  { key: "company_address", label: "Company Address" },
  { key: "company_city", label: "Company City" },
  { key: "company_state", label: "Company State" },
  { key: "company_phone", label: "Company Phone" },
  { key: "technologies", label: "Technologies" },
  { key: "annual_revenue", label: "Annual Revenue" },
  { key: "subsidiary_of", label: "Subsidiary Of" },
];

/** Header synonyms (already normalized: lowercase, alphanumeric words). Exact match wins first. */
const APOLLO_SYNONYMS: Record<ApolloField, string[]> = {
  first_name: ["first name", "firstname"],
  last_name: ["last name", "lastname"],
  title: ["title", "job title", "person title"],
  company_name: ["company name", "company", "organization", "account name", "account"],
  email: ["email", "email address", "work email"],
  department: ["department", "departments"],
  corporate_phone: ["corporate phone", "direct phone", "work direct phone", "mobile phone"],
  num_employees: ["of employees", "employees", "num employees", "employee count", "headcount", "company size"],
  keywords: ["keywords", "keyword", "industry keywords"],
  linkedin_url: ["person linkedin url", "linkedin url", "linkedin", "person linkedin"],
  website: ["website", "company website", "web site", "url"],
  company_address: ["company address", "address", "street"],
  company_city: ["company city", "city"],
  company_state: ["company state", "state", "region"],
  company_phone: ["company phone", "primary phone", "phone", "company phone number"],
  technologies: ["technologies", "technology", "tech stack", "technologies used"],
  annual_revenue: ["annual revenue", "revenue", "estimated annual revenue"],
  subsidiary_of: ["subsidiary of", "parent company", "subsidiary", "parent"],
};

function normalizeHeader(h: string): string {
  return h
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export type ApolloMapping = Partial<Record<ApolloField, string>>;

/**
 * Map spreadsheet headers → Apollo fields. Synonyms are listed most-specific first,
 * and we match them in that priority order so that (e.g.) "Company State" is claimed
 * by company_state before the generic "State" synonym can grab Apollo's person-level
 * State column. Each header is used at most once.
 *
 *   Pass 1: for each field, try its synonyms in order, taking the first EXACT header match.
 *   Pass 2: looser "contains" match for anything still unmapped.
 */
export function mapApolloColumns(headers: string[]): ApolloMapping {
  const norm = headers.map(normalizeHeader);
  const used = new Set<number>();
  const mapping: ApolloMapping = {};

  const claim = (field: ApolloField, idx: number) => {
    mapping[field] = headers[idx]!;
    used.add(idx);
  };

  // Pass 1 — exact match, synonyms in priority order.
  for (const { key } of APOLLO_LEAD_FIELDS) {
    const syns = APOLLO_SYNONYMS[key];
    let done = false;
    for (const syn of syns) {
      for (let i = 0; i < norm.length && !done; i++) {
        if (used.has(i)) continue;
        if (norm[i] === syn) {
          claim(key, i);
          done = true;
        }
      }
      if (done) break;
    }
  }
  // Pass 2 — contains match for anything still unmapped.
  for (const { key } of APOLLO_LEAD_FIELDS) {
    if (mapping[key]) continue;
    const syns = APOLLO_SYNONYMS[key];
    for (let i = 0; i < norm.length; i++) {
      if (used.has(i)) continue;
      const h = norm[i]!;
      if (syns.some((s) => h === s || h.includes(s) || s.includes(h))) {
        claim(key, i);
        break;
      }
    }
  }
  return mapping;
}

/** US state name / abbreviation → 2-letter postal code. Apollo exports full names. */
const US_STATES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO",
  connecticut: "CT", delaware: "DE", "district of columbia": "DC", florida: "FL", georgia: "GA",
  hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY",
  louisiana: "LA", maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN",
  mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV", "new hampshire": "NH",
  "new jersey": "NJ", "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND",
  ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC",
  "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT", virginia: "VA",
  washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY",
};

/** Normalise a state value ("California", "ca", "CA ") to its 2-letter code, else null. */
export function usStateCode(input: string | null | undefined): string | null {
  if (!input) return null;
  const t = input.trim();
  if (!t) return null;
  const lower = t.toLowerCase();
  if (US_STATES[lower]) return US_STATES[lower]!;
  if (/^[a-z]{2}$/.test(lower)) {
    const code = lower.toUpperCase();
    if (Object.values(US_STATES).includes(code)) return code;
  }
  return null;
}

/** UI-facing lead workflow statuses (reuses the lead_status enum). */
export const LEAD_STATUSES = [
  { value: "new", label: "New" },
  { value: "claimed", label: "Working" },
  { value: "converted", label: "Converted" },
  { value: "dismissed", label: "Dismissed" },
] as const;
export const LEAD_STATUS_VALUES = LEAD_STATUSES.map((s) => s.value) as [string, ...string[]];

/** ── Zod: import + management ─────────────────────────────── */
const optStr = (max: number) =>
  z.string().trim().max(max).optional().or(z.literal("").transform(() => undefined));

export const leadImportRowSchema = z.object({
  company_name: z.string().trim().min(1).max(240),
  first_name: optStr(120),
  last_name: optStr(120),
  title: optStr(200),
  email: optStr(200),
  department: optStr(160),
  corporate_phone: optStr(60),
  num_employees: z.coerce.number().int().min(0).max(10_000_000).optional(),
  keywords: optStr(4000),
  linkedin_url: optStr(400),
  website: optStr(400),
  company_address: optStr(400),
  company_city: optStr(160),
  company_state: optStr(120),
  company_phone: optStr(60),
  technologies: optStr(4000),
  annual_revenue: optStr(120),
  subsidiary_of: optStr(240),
});
export type LeadImportRow = z.infer<typeof leadImportRowSchema>;

export const leadImportCommitSchema = z.object({
  advisor_id: z.string().uuid(),
  rows: z.array(leadImportRowSchema).max(5000),
  dry_run: z.boolean().default(false),
});
export type LeadImportCommit = z.infer<typeof leadImportCommitSchema>;

export const leadUpdateSchema = z.object({
  status: z.enum(LEAD_STATUS_VALUES).optional(),
  assigned_advisor_id: z.string().uuid().optional(),
  notes: z.string().trim().max(4000).optional().or(z.literal("").transform(() => undefined)),
});
export type LeadUpdateInput = z.infer<typeof leadUpdateSchema>;

export const leadConvertSchema = z.object({
  product: z.string().trim().max(160).optional().or(z.literal("").transform(() => undefined)),
  opportunity_value: z.coerce.number().min(0).max(1_000_000_000).optional(),
  num_technicians: z.coerce.number().int().min(0).max(100000).optional(),
});
export type LeadConvertInput = z.infer<typeof leadConvertSchema>;
