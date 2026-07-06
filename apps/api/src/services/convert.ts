import { and, eq } from "drizzle-orm";
import { db, transactions, opportunities, users } from "@smart-crm/db";
import { getEffectiveRate } from "./commission.js";

/**
 * Conversion → money record (§10, §5 transactions). Snapshots the advisor's CURRENT
 * commission rate at the moment of conversion and stores the computed amount. The
 * snapshot is copied, never referenced live — a 2027 report about a 2026 deal must show
 * the rate that deal earned (§5 transactions note).
 *
 * Idempotent: a given opportunity yields at most one transaction.
 */
export async function ensureConversion(opportunityId: string, dealValueOverride?: number): Promise<void> {
  const [existing] = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(eq(transactions.opportunityId, opportunityId))
    .limit(1);
  if (existing) return;

  const [opp] = await db
    .select({
      id: opportunities.id,
      orgId: opportunities.orgId,
      advisorId: opportunities.advisorId,
      value: opportunities.opportunityValue,
    })
    .from(opportunities)
    .where(eq(opportunities.id, opportunityId))
    .limit(1);
  if (!opp) return;

  const [advisor] = await db
    .select({ rate: users.currentCommissionRate })
    .from(users)
    .where(eq(users.id, opp.advisorId))
    .limit(1);

  const dealValue = dealValueOverride ?? (opp.value != null ? Number(opp.value) : 0);
  const convertedAt = new Date();
  // Use the rate that was EFFECTIVE on the conversion date (commission history, §10),
  // falling back to the advisor's current rate if no history exists.
  const effective = await getEffectiveRate(opp.advisorId, convertedAt);
  const rate = effective ?? (advisor?.rate != null ? Number(advisor.rate) : 0);
  const amount = Math.round(((dealValue * rate) / 100) * 100) / 100;

  await db.insert(transactions).values({
    orgId: opp.orgId,
    opportunityId: opp.id,
    advisorId: opp.advisorId,
    convertedAt,
    dealValue: String(dealValue),
    commissionRateSnapshot: String(rate),
    commissionAmount: String(amount),
  });
}

/** Reverse a conversion if a deal is moved back out of a won stage (keeps reports honest). */
export async function removeConversion(opportunityId: string): Promise<void> {
  await db.delete(transactions).where(and(eq(transactions.opportunityId, opportunityId)));
}
