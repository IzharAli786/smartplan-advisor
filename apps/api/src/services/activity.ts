import { eq } from "drizzle-orm";
import { db, activities, opportunities } from "@smart-crm/db";

type ActivityType = "call" | "sms" | "email" | "note" | "status_change" | "quote" | "system";

/**
 * Append an activity to an opportunity's timeline and bump its last-activity time (used by
 * the next-step engine / "going cold" detection). One place so every entry is consistent —
 * manual logs, status changes, quote events and system notes all flow through here.
 */
export async function logActivity(args: {
  opportunityId: string;
  advisorId?: string | null;
  type: ActivityType;
  subject: string;
  body?: string | null;
  outcome?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await db.insert(activities).values({
    opportunityId: args.opportunityId,
    advisorId: args.advisorId ?? null,
    type: args.type,
    subject: args.subject,
    body: args.body ?? null,
    outcome: args.outcome ?? null,
    metadata: args.metadata ?? {},
  });
  await db.update(opportunities).set({ lastActivityAt: new Date() }).where(eq(opportunities.id, args.opportunityId));
}
