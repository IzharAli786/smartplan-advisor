import { eq } from "drizzle-orm";
import { db, activities, opportunities } from "@smart-crm/db";

type ActivityType = "call" | "sms" | "email" | "note" | "status_change" | "quote" | "system";

/**
 * Either the pooled connection or an open transaction. Callers inside `db.transaction()`
 * MUST pass the `tx` handle: this function also writes `opportunities.lastActivityAt`, so
 * running it on the pool while the caller's transaction holds a row lock on the same
 * opportunity deadlocks until the statement timeout.
 */
type Exec = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Append an activity to an opportunity's timeline and bump its last-activity time (used by
 * the next-step engine / "going cold" detection). One place so every entry is consistent —
 * manual logs, status changes, quote events and system notes all flow through here.
 */
export async function logActivity(
  args: {
    opportunityId: string;
    advisorId?: string | null;
    type: ActivityType;
    subject: string;
    body?: string | null;
    outcome?: string | null;
    metadata?: Record<string, unknown>;
  },
  exec: Exec = db,
): Promise<void> {
  await exec.insert(activities).values({
    opportunityId: args.opportunityId,
    advisorId: args.advisorId ?? null,
    type: args.type,
    subject: args.subject,
    body: args.body ?? null,
    outcome: args.outcome ?? null,
    metadata: args.metadata ?? {},
  });
  await exec.update(opportunities).set({ lastActivityAt: new Date() }).where(eq(opportunities.id, args.opportunityId));
}
