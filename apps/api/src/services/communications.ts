import { and, desc, eq, sql } from "drizzle-orm";
import { db, communications, contacts } from "@smart-crm/db";

type Kind = "quote" | "email" | "invite" | "reset" | "other";

export interface RecordCommInput {
  orgId: string;
  toEmail: string;
  subject: string;
  kind: Kind;
  opportunityId?: string | null;
  advisorId?: string | null;
  provider: string;
  providerMessageId?: string | null;
  status?: string;
}

/**
 * Log an outbound communication (quote, email, …) by date & time. Best-effort: a logging
 * failure must never break the send. Links to an address-book contact when the recipient
 * email matches one the same advisor owns.
 */
export async function recordCommunication(input: RecordCommInput): Promise<void> {
  try {
    let contactId: string | null = null;
    if (input.advisorId && input.toEmail) {
      const [c] = await db
        .select({ id: contacts.id })
        .from(contacts)
        .where(and(eq(contacts.ownerId, input.advisorId), sql`lower(${contacts.email}) = lower(${input.toEmail})`))
        .limit(1);
      contactId = c?.id ?? null;
    }
    await db.insert(communications).values({
      orgId: input.orgId,
      toEmail: input.toEmail,
      subject: input.subject,
      kind: input.kind,
      opportunityId: input.opportunityId ?? null,
      contactId,
      advisorId: input.advisorId ?? null,
      provider: input.provider,
      providerMessageId: input.providerMessageId ?? null,
      status: input.status ?? "sent",
    });
  } catch (err) {
    console.error("[communications] failed to record", err);
  }
}

export async function listCommunications(filter: {
  orgId: string;
  opportunityId?: string;
  contactId?: string;
  email?: string;
  advisorId?: string; // when set, scope to this advisor (advisors see their own)
}) {
  const conds = [eq(communications.orgId, filter.orgId)];
  if (filter.opportunityId) conds.push(eq(communications.opportunityId, filter.opportunityId));
  if (filter.contactId) conds.push(eq(communications.contactId, filter.contactId));
  if (filter.email) conds.push(sql`lower(${communications.toEmail}) = lower(${filter.email})`);
  if (filter.advisorId) conds.push(eq(communications.advisorId, filter.advisorId));
  return db
    .select()
    .from(communications)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(communications.createdAt))
    .limit(200);
}
