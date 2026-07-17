import { env } from "../env.js";

/**
 * Outbound Advise→SmartPlan calls. Mirror image of SmartPlan's adviseService:
 * same shared secret (SMARTPLAN_INGEST_SECRET here == ADVISE_INGEST_SECRET on
 * the SmartPlan box) sent in the x-ingest-secret header.
 *
 * Config (both must be set, otherwise calls fail with smartplanConfigured()=false):
 *   SMARTPLAN_APP_URL        e.g. https://www.smartplan.software
 *   SMARTPLAN_INGEST_SECRET  the existing shared ingest secret
 */

const PUSH_TIMEOUT_MS = 10_000;

export function smartplanConfigured(): boolean {
  return !!env.smartplanAppUrl && !!env.smartplanIngestSecret;
}

/** POST JSON to the SmartPlan app. Throws on network error or non-2xx. */
export async function postToSmartPlan<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${env.smartplanAppUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-ingest-secret": env.smartplanIngestSecret },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(PUSH_TIMEOUT_MS),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`SmartPlan ${path} -> ${res.status}${text ? `: ${text.slice(0, 300)}` : ""}`);
  }
  return (await res.json()) as T;
}
