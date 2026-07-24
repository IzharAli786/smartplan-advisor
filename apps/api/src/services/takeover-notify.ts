import type { FastifyBaseLogger } from "fastify";
import { eq } from "drizzle-orm";
import { db, users } from "@smart-crm/db";
import { env } from "../env.js";
import { mailer } from "../lib/mailer.js";
import { notify, type NotificationType } from "./notify.js";
import { recordCommunication } from "./communications.js";

/**
 * Takeover alerts (§5.1) — one helper so every event in the flow lands the same way:
 * an in-app notification AND an email, logged to communications.
 *
 * TWO RULES THAT MUST NOT BE RELAXED:
 *
 * 1. NEVER call this inside `db.transaction()`. It talks to SMTP over the network; a
 *    hung provider would hold a Postgres transaction — and its row locks — open for the
 *    full HTTP timeout. Every caller fires alerts AFTER commit.
 * 2. Email failure is logged, never thrown. A takeover decision that already committed
 *    must not 500 because Resend was down; the in-app notification is the source of
 *    truth and the email is the courtesy copy. Same posture as the advisor-sync call in
 *    routes/smartplan-transactions.ts.
 *
 * `recordCommunication` is deliberately passed `opportunityId: null`. The per-opportunity
 * comms view is NOT advisor-filtered (services/communications.ts listCommunications), so
 * attaching these would show the new owner the previous owner's email address on the very
 * account that was just taken from them. The durable per-account audit belongs in
 * `activities`, which the approval handler writes.
 */

export interface TakeoverAlert {
  orgId: string;
  /** Recipient. Skipped silently if they're deactivated or have no email. */
  userId: string;
  type: NotificationType;
  /**
   * Deep-link target for the in-app bell. MUST be null when the recipient can't read the
   * record — an advisor who just lost an account 403s on its detail route, and
   * NotificationsPage would navigate them straight into the error.
   */
  relatedId: string | null;
  /** In-app notification text. Kept short — it renders in the bell dropdown. */
  message: string;
  /** Email subject. */
  subject: string;
  /** Email body (HTML). Build with takeoverEmailHtml() so the alerts look consistent. */
  html: string;
}

/** Absolute link back into the web app, for email bodies. */
export function webLink(path: string): string {
  return `${env.webOrigins[0]}${path}`;
}

/**
 * Standard body: a greeting, the lines of detail, and an optional call-to-action link.
 * Plain inline markup — the mailer has no template engine and these must render in
 * Outlook as well as anywhere else.
 */
export function takeoverEmailHtml(args: {
  greetingName: string;
  intro: string;
  details?: string[];
  ctaLabel?: string;
  ctaPath?: string;
}): string {
  const details = (args.details ?? []).filter(Boolean).map((d) => `<p style="margin:4px 0">${escapeHtml(d)}</p>`).join("");
  const cta =
    args.ctaLabel && args.ctaPath
      ? `<p style="margin:16px 0"><a href="${webLink(args.ctaPath)}">${escapeHtml(args.ctaLabel)}</a></p>`
      : "";
  return (
    `<p>Hi ${escapeHtml(args.greetingName)},</p>` +
    `<p>${escapeHtml(args.intro)}</p>` +
    details +
    cta +
    `<p style="color:#6b7280;font-size:12px">SmartPlan Advisor CRM</p>`
  );
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * In-app + email for one recipient. Resolves even when the email fails; only an
 * in-app notification insert failure propagates (that one means the DB is unhealthy and
 * the caller should know).
 */
export async function sendTakeoverAlert(alert: TakeoverAlert, log?: FastifyBaseLogger): Promise<void> {
  await notify({
    orgId: alert.orgId,
    userId: alert.userId,
    type: alert.type,
    message: alert.message,
    relatedId: alert.relatedId,
  });

  try {
    const [recipient] = await db
      .select({ email: users.email, fullName: users.fullName, active: users.active })
      .from(users)
      .where(eq(users.id, alert.userId))
      .limit(1);
    // Don't email deactivated accounts — their mailbox is usually gone with them, and a
    // bounce storm on a bulk import is worse than a missing courtesy copy.
    if (!recipient?.email || !recipient.active) return;

    const sent = await mailer.sendEmail({ to: recipient.email, subject: alert.subject, html: alert.html });
    await recordCommunication({
      orgId: alert.orgId,
      toEmail: recipient.email,
      subject: alert.subject,
      kind: "other",
      opportunityId: null, // see the header note — never attach these to the account
      advisorId: alert.userId,
      provider: sent.provider,
      providerMessageId: sent.id,
      status: sent.status,
    });
  } catch (err) {
    (log ?? console).error({ err, userId: alert.userId, type: alert.type }, "[takeover] email failed");
  }
}

/**
 * Fan-out. `allSettled` so one bad recipient (deleted user, mail bounce) can't stop the
 * others — a takeover decision notifies both advisors, and telling only one is worse than
 * telling neither.
 */
export async function sendTakeoverAlerts(alerts: TakeoverAlert[], log?: FastifyBaseLogger): Promise<void> {
  const results = await Promise.allSettled(alerts.map((a) => sendTakeoverAlert(a, log)));
  for (const r of results) {
    if (r.status === "rejected") (log ?? console).error({ err: r.reason }, "[takeover] alert failed");
  }
}
