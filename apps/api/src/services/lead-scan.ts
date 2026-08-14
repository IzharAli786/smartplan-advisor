import { env } from "../env.js";
import { HttpError } from "../lib/errors.js";
import { LEAD_SCAN_KEYS, usStateCode, type LeadScanKey } from "@smart-crm/shared";

/**
 * Lead capture from a photo/screenshot via OpenAI vision — same contract as voice.ts:
 * the image (a LinkedIn profile, business card, email signature…) goes to a vision
 * model which returns lead-shaped fields as strict JSON, and the app receives a
 * draft the SAME shape the typed Add Lead form produces.
 *
 * The user ALWAYS reviews the pre-filled form before saving, and the image itself
 * is never persisted — it only lives in memory for the OpenAI call.
 */
export function isLeadScanConfigured(): boolean {
  return !!env.openaiApiKey;
}

/** OpenAI vision accepts exactly these; HEIC (the iPhone camera default) is not one of them. */
export const SCAN_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

export type LeadScanDraft = Partial<Record<Exclude<LeadScanKey, "num_employees">, string>> & {
  num_employees?: number;
};

/** Per-field caps mirroring leadUpdateSchema — model output is clamped, never trusted. */
const MAX_LEN: Record<Exclude<LeadScanKey, "num_employees">, number> = {
  first_name: 120,
  last_name: 120,
  title: 200,
  company_name: 240,
  email: 200,
  department: 160,
  corporate_phone: 60,
  company_phone: 60,
  keywords: 4000,
  linkedin_url: 400,
  website: 400,
  company_address: 400,
  company_city: 160,
  company_state: 120,
  technologies: 4000,
  annual_revenue: 120,
  subsidiary_of: 240,
  notes: 4000,
};

const SYSTEM_PROMPT = `You extract CRM lead data from a photo or screenshot — typically a LinkedIn profile, business card, email signature or company website.
Return ONLY a JSON object with these optional keys (omit any the image doesn't clearly show):
- first_name, last_name (strings)
- title (string — the person's job title)
- company_name (string — the person's CURRENT employer)
- email (string)
- department (string)
- corporate_phone, company_phone (strings, keep the formatting shown)
- linkedin_url (string — only if a URL is actually visible in the image; NEVER construct one from the person's name)
- website (string — the company website)
- company_address, company_city (strings)
- company_state (string — 2-letter code if a US state)
- num_employees (integer)
- keywords (string — industry/specialty keywords, comma separated)
- technologies (string, comma separated)
- annual_revenue (string)
- subsidiary_of (string — parent company)
- notes (string — other useful context visible in the image, e.g. the person's About/summary text)
Never invent data. If unsure about a value, omit its key. If the image contains no lead information, return {}.`;

export async function scanImageToLeadDraft(args: {
  image: Buffer;
  mimetype: string;
}): Promise<{ draft: LeadScanDraft }> {
  if (!isLeadScanConfigured()) {
    throw new HttpError(503, "Photo scan isn't configured — set OPENAI_API_KEY on the server.", "scan_disabled");
  }
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.openaiApiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: env.openaiVisionModel,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            { type: "text", text: "Extract the lead's details from this image." },
            {
              type: "image_url",
              image_url: { url: `data:${args.mimetype};base64,${args.image.toString("base64")}`, detail: "high" },
            },
          ],
        },
      ],
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new HttpError(502, `Scan failed: ${res.status} ${detail.slice(0, 200)}`, "scan_failed");
  }
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content ?? "{}";
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(content) as Record<string, unknown>;
  } catch {
    raw = {};
  }
  return { draft: sanitize(raw) };
}

/** Whitelist + clamp the model's JSON: unknown keys dropped, strings trimmed/capped, numbers coerced. */
function sanitize(raw: Record<string, unknown>): LeadScanDraft {
  const draft: LeadScanDraft = {};
  for (const key of LEAD_SCAN_KEYS) {
    const v = raw[key];
    if (v == null || typeof v === "object") continue;
    if (key === "num_employees") {
      const n = Number(String(v).replace(/[^0-9.\-]/g, ""));
      if (Number.isFinite(n) && n >= 0 && n <= 10_000_000) draft.num_employees = Math.round(n);
      continue;
    }
    let s = String(v).trim();
    if (!s) continue;
    if (key === "company_state") s = usStateCode(s) ?? s;
    draft[key] = s.slice(0, MAX_LEN[key]);
  }
  return draft;
}
