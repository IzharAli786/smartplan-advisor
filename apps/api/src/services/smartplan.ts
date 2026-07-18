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

/** Non-2xx from SmartPlan — carries the upstream status so routes can map 403/404 through. */
export class SmartPlanError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** JSON request to the SmartPlan app. Throws SmartPlanError on non-2xx, Error on network failure. */
export async function smartplanRequest<T>(method: "GET" | "POST" | "DELETE", path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${env.smartplanAppUrl}${path}`, {
    method,
    headers: {
      "x-ingest-secret": env.smartplanIngestSecret,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(PUSH_TIMEOUT_MS),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new SmartPlanError(res.status, `SmartPlan ${method} ${path} -> ${res.status}${text ? `: ${text.slice(0, 300)}` : ""}`);
  }
  return (await res.json()) as T;
}

/** POST JSON to the SmartPlan app. Throws on network error or non-2xx. */
export async function postToSmartPlan<T>(path: string, body: unknown): Promise<T> {
  return smartplanRequest<T>("POST", path, body);
}
