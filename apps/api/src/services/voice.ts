import { env } from "../env.js";
import { HttpError } from "../lib/errors.js";

/**
 * Voice capture via ChatGPT/OpenAI (build spec §6.2). Two steps, behind one interface so
 * the rest of the app never knows voice exists — it just receives an OpportunityDraft-
 * shaped object, the SAME contract the typed form produces:
 *   1. Whisper transcribes the audio note.
 *   2. A GPT model extracts structured opportunity fields as strict JSON.
 *
 * The advisor ALWAYS reviews the pre-filled form before saving — we never auto-save a
 * voice entry blind (§6.2).
 */
export function isVoiceConfigured(): boolean {
  return !!env.openaiApiKey;
}

export interface VoiceDraft {
  contractor_company_name?: string;
  contact_name?: string;
  contact_email?: string;
  contact_cell?: string;
  num_technicians?: number;
  product?: string;
  opportunity_value?: number;
  state?: string;
  notes?: string;
}

async function transcribe(audio: Buffer, filename: string, mimetype: string): Promise<string> {
  const form = new FormData();
  form.append("file", new Blob([audio], { type: mimetype || "audio/webm" }), filename || "note.webm");
  form.append("model", env.openaiTranscribeModel);

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.openaiApiKey}` },
    body: form,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new HttpError(502, `Transcription failed: ${res.status} ${detail.slice(0, 200)}`, "transcribe_failed");
  }
  const data = (await res.json()) as { text?: string };
  return data.text ?? "";
}

const SYSTEM_PROMPT = `You extract structured CRM data from a sales advisor's spoken note about a commercial HVAC contractor opportunity.
Return ONLY a JSON object with these optional keys (omit a key entirely if the note doesn't mention it):
- contractor_company_name (string)
- contact_name (string)
- contact_email (string)
- contact_cell (string, keep digits/format as spoken)
- num_technicians (integer)
- opportunity_value (number, US dollars, no symbols)
- state (string, 2-letter US state code, uppercase)
- product (string — MUST exactly match one of the provided product options, else omit)
- notes (string — anything useful that doesn't fit the other fields)
Never invent data. If unsure, omit the field.`;

async function extract(transcript: string, products: string[]): Promise<VoiceDraft> {
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
          content: `Product options: ${JSON.stringify(products)}\n\nVoice note transcript:\n"""${transcript}"""`,
        },
      ],
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new HttpError(502, `Extraction failed: ${res.status} ${detail.slice(0, 200)}`, "extract_failed");
  }
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content ?? "{}";
  try {
    return JSON.parse(content) as VoiceDraft;
  } catch {
    return {};
  }
}

export async function transcribeToDraft(args: {
  audio: Buffer;
  filename: string;
  mimetype: string;
  products: string[];
}): Promise<{ transcript: string; draft: VoiceDraft }> {
  if (!isVoiceConfigured()) {
    throw new HttpError(503, "Voice capture isn't configured — set OPENAI_API_KEY on the server.", "voice_disabled");
  }
  const transcript = await transcribe(args.audio, args.filename, args.mimetype);
  if (!transcript.trim()) return { transcript, draft: {} };
  const draft = await extract(transcript, args.products);
  return { transcript, draft };
}
