import { and, desc, eq, lte } from "drizzle-orm";
import { db, commissionRates } from "@smart-crm/db";

/** Commission rate history (§10). A rate is effective from a date; the rate for a deal
 * is the latest row whose effective_from <= the conversion date. */

const toDateStr = (d: Date) => d.toISOString().slice(0, 10);

/** Record a new effective-dated rate for an advisor (only when it actually changes). */
export async function recordRateChange(orgId: string, advisorId: string, rate: number, effectiveFrom?: string): Promise<void> {
  await db.insert(commissionRates).values({
    orgId,
    advisorId,
    rate: String(rate),
    effectiveFrom: effectiveFrom ?? toDateStr(new Date()),
  });
}

/** The rate in effect for an advisor on a given date, or null if no history exists. */
export async function getEffectiveRate(advisorId: string, onDate: Date): Promise<number | null> {
  const [row] = await db
    .select({ rate: commissionRates.rate })
    .from(commissionRates)
    .where(and(eq(commissionRates.advisorId, advisorId), lte(commissionRates.effectiveFrom, toDateStr(onDate))))
    .orderBy(desc(commissionRates.effectiveFrom), desc(commissionRates.createdAt))
    .limit(1);
  return row ? Number(row.rate) : null;
}

export async function getHistory(advisorId: string) {
  const rows = await db
    .select()
    .from(commissionRates)
    .where(eq(commissionRates.advisorId, advisorId))
    .orderBy(desc(commissionRates.effectiveFrom), desc(commissionRates.createdAt));
  return rows.map((r) => ({ id: r.id, rate: Number(r.rate), effectiveFrom: r.effectiveFrom, createdAt: r.createdAt }));
}

/** All history rows for a set of advisors, grouped, newest first (for report resolution). */
export async function getHistoryFor(advisorIds: string[]): Promise<Map<string, { rate: number; effectiveFrom: string }[]>> {
  const map = new Map<string, { rate: number; effectiveFrom: string }[]>();
  if (advisorIds.length === 0) return map;
  const rows = await db.select().from(commissionRates).orderBy(desc(commissionRates.effectiveFrom), desc(commissionRates.createdAt));
  for (const r of rows) {
    if (!advisorIds.includes(r.advisorId)) continue;
    const list = map.get(r.advisorId) ?? [];
    list.push({ rate: Number(r.rate), effectiveFrom: r.effectiveFrom });
    map.set(r.advisorId, list);
  }
  return map;
}

/** Pick the effective rate for a conversion date from a newest-first history list. */
export function resolveRate(history: { rate: number; effectiveFrom: string }[] | undefined, convertedAt: Date): number | null {
  if (!history || history.length === 0) return null;
  const day = convertedAt.toISOString().slice(0, 10);
  for (const h of history) {
    if (h.effectiveFrom <= day) return h.rate;
  }
  return null;
}
