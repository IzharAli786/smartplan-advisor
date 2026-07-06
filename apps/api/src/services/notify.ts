import { db, notifications } from "@smart-crm/db";

type NotificationType =
  | "claim_request"
  | "claim_decision"
  | "account_reassigned"
  | "follow_up"
  | "next_step"
  | "quote_update";

/** Insert an in-app notification (§5 notifications, §13). One place so the shape is consistent. */
export async function notify(args: {
  orgId: string;
  userId: string;
  type: NotificationType;
  message: string;
  relatedId?: string | null;
}): Promise<void> {
  await db.insert(notifications).values({
    orgId: args.orgId,
    userId: args.userId,
    type: args.type,
    message: args.message,
    relatedId: args.relatedId ?? null,
  });
}
