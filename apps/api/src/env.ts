import "./loadenv.js";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const env = {
  port: Number(process.env.API_PORT ?? 4000),
  webOrigins: (process.env.WEB_ORIGIN ?? "http://localhost:5173")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  authSecret: required("AUTH_SECRET"),
  sessionTtlHours: Number(process.env.SESSION_TTL_HOURS ?? 168),
  cookieSecure: process.env.COOKIE_SECURE === "true",
  databaseUrl: required("DATABASE_URL"),
  // Resend is PRIMARY whenever an API key is configured — just paste
  // RESEND_API_KEY (+ RESEND_FROM_EMAIL) into the box .env and restart; no
  // MAILER_DRIVER edit needed. Remove the key to fall back to the dev outbox.
  mailerDriver: process.env.RESEND_API_KEY ? "resend" : (process.env.MAILER_DRIVER ?? "dev"),
  // MAIL_FROM ("Name <addr>") wins when set; RESEND_FROM_EMAIL (bare address,
  // must be on the Resend-verified domain) is the simpler alias.
  // `||` (not ??) so a blank `MAIL_FROM=` / `RESEND_FROM_EMAIL=` line in .env
  // falls through instead of producing an empty from-address.
  mailFrom: process.env.MAIL_FROM || process.env.RESEND_FROM_EMAIL || "SmartPlan CRM <no-reply@smartplan.software>",
  resendApiKey: process.env.RESEND_API_KEY ?? "",
  smartplanIngestSecret: process.env.SMARTPLAN_INGEST_SECRET ?? "",
  // Public origin of the SmartPlan app — used for outbound Advise→SmartPlan
  // calls (advisor feedback forwarding). Auth reuses SMARTPLAN_INGEST_SECRET
  // in the x-ingest-secret header (same shared value both directions).
  smartplanAppUrl: (process.env.SMARTPLAN_APP_URL ?? "").replace(/\/+$/, ""),
  storageDriver: process.env.STORAGE_DRIVER ?? "dev",
  storageLocalDir: process.env.STORAGE_LOCAL_DIR ?? "storage-dev",
  openaiApiKey: process.env.OPENAI_API_KEY ?? "",
  openaiTranscribeModel: process.env.OPENAI_TRANSCRIBE_MODEL ?? "whisper-1",
  openaiExtractModel: process.env.OPENAI_EXTRACT_MODEL ?? "gpt-4o-mini",
  isProd: process.env.NODE_ENV === "production",
};

export const SESSION_COOKIE = "scrm_session";
