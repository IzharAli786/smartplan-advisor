import { env } from "../env.js";

/**
 * AI-assisted spreadsheet import (Pipeline): given the spreadsheet's column headers and a
 * few sample rows, work out which column maps to each of our opportunity fields. Uses
 * ChatGPT when an OpenAI key is configured; otherwise falls back to a header-name heuristic
 * so import still works without AI.
 */
export const IMPORT_FIELDS = [
  "contractor_company_name",
  "contact_name",
  "contact_email",
  "contact_cell",
  "state",
  "product",
  "num_technicians",
  "opportunity_value",
  "notes",
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];
export type ColumnMapping = Partial<Record<ImportField, string>>; // field → source header

const SYNONYMS: Record<ImportField, string[]> = {
  contractor_company_name: ["company", "company name", "contractor", "contractor name", "business", "account", "organization", "organisation", "customer", "client"],
  contact_name: ["contact", "contact name", "name", "primary contact", "full name", "owner"],
  contact_email: ["email", "e-mail", "email address", "contact email"],
  contact_cell: ["phone", "cell", "mobile", "telephone", "phone number", "contact phone", "cell phone"],
  state: ["state", "st", "region", "province"],
  product: ["product", "service", "plan", "package"],
  num_technicians: ["technicians", "techs", "# techs", "number of technicians", "num techs", "tech count", "no of technicians"],
  opportunity_value: ["value", "deal value", "amount", "revenue", "price", "deal size", "opportunity value", "estimated value", "contract value"],
  notes: ["notes", "note", "comments", "description", "remarks"],
};

function heuristicMap(headers: string[]): ColumnMapping {
  const norm = (s: string) => s.trim().toLowerCase().replace(/[_\-]+/g, " ").replace(/\s+/g, " ");
  const map: ColumnMapping = {};
  const used = new Set<string>();
  for (const field of IMPORT_FIELDS) {
    const syns = SYNONYMS[field];
    // exact match first, then contains
    let hit = headers.find((h) => !used.has(h) && syns.includes(norm(h)));
    if (!hit) hit = headers.find((h) => !used.has(h) && syns.some((s) => norm(h).includes(s)));
    if (hit) {
      map[field] = hit;
      used.add(hit);
    }
  }
  return map;
}

export function isImportAiConfigured(): boolean {
  return !!env.openaiApiKey;
}

const SYSTEM_PROMPT = `You map spreadsheet columns to a CRM's opportunity fields for commercial HVAC sales.
Given the spreadsheet's column headers and a few sample rows, return ONLY a JSON object mapping each of these fields to the BEST-matching column header (use the exact header string), or omit the field if no column fits:
- contractor_company_name (the contractor/business/customer company)
- contact_name (a person's name)
- contact_email
- contact_cell (phone/mobile)
- state (US state)
- product (should match one of the provided product options if possible)
- num_technicians (a count of technicians)
- opportunity_value (a dollar amount / deal size)
- notes (freeform)
Never invent headers. Only use headers from the provided list.`;

async function aiMap(headers: string[], sampleRows: Record<string, unknown>[], products: string[]): Promise<ColumnMapping> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.openaiApiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: env.openaiExtractModel,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `Headers: ${JSON.stringify(headers)}\n\nProduct options: ${JSON.stringify(products)}\n\nSample rows (up to 5):\n${JSON.stringify(sampleRows.slice(0, 5))}`,
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`AI mapping failed: ${res.status}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const parsed = JSON.parse(data.choices?.[0]?.message?.content ?? "{}") as Record<string, unknown>;
  const map: ColumnMapping = {};
  for (const field of IMPORT_FIELDS) {
    const v = parsed[field];
    if (typeof v === "string" && headers.includes(v)) map[field] = v;
  }
  return map;
}

/** Best-effort column mapping. Falls back to heuristics if AI is unavailable or errors. */
export async function mapColumns(headers: string[], sampleRows: Record<string, unknown>[], products: string[]): Promise<{ mapping: ColumnMapping; usedAi: boolean }> {
  if (isImportAiConfigured()) {
    try {
      const ai = await aiMap(headers, sampleRows, products);
      // Backfill anything AI missed with the heuristic.
      const heur = heuristicMap(headers);
      return { mapping: { ...heur, ...ai }, usedAi: true };
    } catch {
      /* fall through to heuristic */
    }
  }
  return { mapping: heuristicMap(headers), usedAi: false };
}
