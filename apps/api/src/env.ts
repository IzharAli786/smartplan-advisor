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
  mailerDriver: process.env.MAILER_DRIVER ?? "dev",
  mailFrom: process.env.MAIL_FROM ?? "SmartPlan CRM <no-reply@smartplan.software>",
  resendApiKey: process.env.RESEND_API_KEY ?? "",
  smartplanIngestSecret: process.env.SMARTPLAN_INGEST_SECRET ?? "",
  // Base URL of the SmartPlan app — used to mirror super-admin logins into its
  // Eco-Admin (same shared secret as the inbound ingest, other direction).
  smartplanAppUrl: (process.env.SMARTPLAN_APP_URL ?? "https://dev.smartplan.software").replace(/\/+$/, ""),
  storageDriver: process.env.STORAGE_DRIVER ?? "dev",
  storageLocalDir: process.env.STORAGE_LOCAL_DIR ?? "storage-dev",
  openaiApiKey: process.env.OPENAI_API_KEY ?? "",
  openaiTranscribeModel: process.env.OPENAI_TRANSCRIBE_MODEL ?? "whisper-1",
  openaiExtractModel: process.env.OPENAI_EXTRACT_MODEL ?? "gpt-4o-mini",
  isProd: process.env.NODE_ENV === "production",
};

export const SESSION_COOKIE = "scrm_session";
