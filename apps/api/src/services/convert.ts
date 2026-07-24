import { and, eq, isNull } from "drizzle-orm";
import { db, transactions, opportunities, users } from "@smart-crm/db";
import { getEffectiveRate } from "./commission.js";

/**
 * Conversion → money record (§10, §5 transactions). Snapshots the advisor's CURRENT
 * commission rate at the moment of conversion and stores the computed amount. The
 * snapshot is copied, never referenced live — a 2027 report about a 2026 deal must show
 * the rate that deal earned (§5 transactions note).
 *
 * THE EARNER IS PINNED AT FIRST CONVERSION. A given opportunity yields at most one
 * transaction row, ever: reverting a win VOIDS it, re-winning RESTORES it verbatim.
 * Previously the revert hard-deleted the row and the re-win re-inserted it reading the
 * opportunity's CURRENT owner — so after a takeover (§5.1) the new owner could move the
 * deal out of Won and back to silently take the previous advisor's commission, quota
 * attainment and badge tier. It also meant one mis-click on the status dropdown
 * permanently destroyed a financial record.
 *
 * Pinning happens at first conversion rather than at takeover approval on purpose: a
 * takeover of a deal that was never won must credit the NEW owner when they close it.
 *
 * EVERY reader of `transactions` must filter `voided_at IS NULL`, or voided deals leak
 * back into commission figures. The readers are:
 *   apps/api/src/routes/reports.ts          (commission statement, converted report)
 *   apps/api/src/routes/dashboard.ts        (monthly won trend, won by product)
 *   apps/api/src/services/performance.ts    (won YTD/MTD → quota attainment → badges)
 *   apps/api/src/services/reports-data.ts   (getTransactions — feeds every report there)
 */
export async function ensureConversion(opportunityId: string, dealValueOverride?: number): Promise<void> {
  const [existing] = await db
    .select({ id: transactions.id, voidedAt: transactions.voidedAt })
    .from(transactions)
    .where(eq(transactions.opportunityId, opportunityId))
    .limit(1);

  // Already earned and live — nothing to do.
  if (existing && existing.voidedAt == null) return;

  // Previously earned then reverted: restore the ORIGINAL row untouched. We deliberately
  // ignore dealValueOverride here — recomputing would re-resolve the rate at today's date
  // and move converted_at into a new reporting period, i.e. silently rewrite an advisor's
  // past commission. Correcting a re-closed deal's value needs an explicit managerial
  // action, not a side effect of a stage toggle.
  if (existing) {
    await db.update(transactions).set({ voidedAt: null }).where(eq(transactions.id, existing.id));
    return;
  }

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

/**
 * Reverse a conversion if a deal is moved back out of a won stage (keeps reports honest).
 * VOIDS the money row rather than deleting it, so the original earner survives a later
 * re-win and the audit trail is never destroyed. See ensureConversion above.
 */
export async function removeConversion(opportunityId: string): Promise<void> {
  await db
    .update(transactions)
    .set({ voidedAt: new Date() })
    .where(and(eq(transactions.opportunityId, opportunityId), isNull(transactions.voidedAt)));
}
