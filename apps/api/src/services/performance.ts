import { and, asc, eq, gte, sql as dsql } from "drizzle-orm";
import { db, advisorSalesSetup, activityEntries, badgeTiers, transactions } from "@smart-crm/db";

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface Setup {
  daysToSell: number;
  hoursPerDay: number;
  annualObjective: number;
  closeRate: number;
  avgSaleSize: number;
  personalObjective: number;
}

const DEFAULT_SETUP: Setup = { daysToSell: 250, hoursPerDay: 6, annualObjective: 0, closeRate: 0, avgSaleSize: 0, personalObjective: 0 };

export async function getSetup(advisorId: string): Promise<Setup> {
  const [row] = await db.select().from(advisorSalesSetup).where(eq(advisorSalesSetup.advisorId, advisorId)).limit(1);
  if (!row) return { ...DEFAULT_SETUP };
  return {
    daysToSell: row.daysToSell,
    hoursPerDay: Number(row.hoursPerDay),
    annualObjective: Number(row.annualObjective),
    closeRate: Number(row.closeRate),
    avgSaleSize: Number(row.avgSaleSize),
    personalObjective: Number(row.personalObjective),
  };
}

export interface Badge {
  label: string;
  color: string | null;
  minPercent: number;
}

async function pickBadges(orgId: string) {
  const tiers = await db.select().from(badgeTiers).where(eq(badgeTiers.orgId, orgId)).orderBy(asc(badgeTiers.minPercent));
  return tiers.map((t) => ({ label: t.label, color: t.color, minPercent: Number(t.minPercent) }));
}

function highestBadge(tiers: Badge[], pct: number): Badge | null {
  let best: Badge | null = null;
  for (const t of tiers) if (pct >= t.minPercent) best = t;
  return best;
}

/** Full performance summary for an advisor: setup, derived $/hour, activity-adjusted
 * projection, attainment vs objective, and the year + month ego badge. */
export async function computeSummary(orgId: string, advisorId: string) {
  const setup = await getSetup(advisorId);
  const totalHours = round2(setup.daysToSell * setup.hoursPerDay);
  const requiredPerHour = totalHours > 0 ? round2(setup.annualObjective / totalHours) : 0;
  const personalPerHour = totalHours > 0 ? round2(setup.personalObjective / totalHours) : 0;

  const now = new Date();
  const yearStart = `${now.getUTCFullYear()}-01-01`;
  const monthStart = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;

  // Activity hours logged this year, by category.
  const entries = await db
    .select({ category: activityEntries.category, hours: activityEntries.hours, occurredOn: activityEntries.occurredOn })
    .from(activityEntries)
    .where(and(eq(activityEntries.advisorId, advisorId), gte(activityEntries.occurredOn, yearStart)));
  let salesHours = 0;
  let nonSalesHours = 0;
  for (const e of entries) {
    const h = Number(e.hours);
    if (e.category === "non_sales") nonSalesHours += h;
    else salesHours += h;
  }
  salesHours = round2(salesHours);
  nonSalesHours = round2(nonSalesHours);

  // Every non-sales hour pulls the projection down by the required $/hour; sales hours are neutral.
  const adjustedAnnual = Math.max(0, round2(setup.annualObjective - nonSalesHours * requiredPerHour));
  const personalAdjusted = Math.max(0, round2(setup.personalObjective - nonSalesHours * personalPerHour));

  // Won deal value (YTD + MTD) from transactions.
  const [wonYear] = await db
    .select({ v: dsql<string>`COALESCE(sum(${transactions.dealValue}), 0)` })
    .from(transactions)
    .where(and(eq(transactions.advisorId, advisorId), gte(transactions.convertedAt, dsql`${yearStart}::timestamptz`)));
  const [wonMonth] = await db
    .select({ v: dsql<string>`COALESCE(sum(${transactions.dealValue}), 0)` })
    .from(transactions)
    .where(and(eq(transactions.advisorId, advisorId), gte(transactions.convertedAt, dsql`${monthStart}::timestamptz`)));
  const wonYtd = round2(Number(wonYear?.v ?? 0));
  const wonMtd = round2(Number(wonMonth?.v ?? 0));

  // Attainment vs the advisor's objective (personal target if set, else assigned).
  const objective = setup.personalObjective > 0 ? setup.personalObjective : setup.annualObjective;
  const monthObjective = objective > 0 ? objective / 12 : 0;
  const attainmentYear = objective > 0 ? round2((wonYtd / objective) * 100) : 0;
  const attainmentMonth = monthObjective > 0 ? round2((wonMtd / monthObjective) * 100) : 0;

  const tiers = await pickBadges(orgId);
  const badgeYear = highestBadge(tiers, attainmentYear);
  const badgeMonth = highestBadge(tiers, attainmentMonth);

  return {
    setup,
    derived: {
      totalHours,
      requiredPerHour,
      personalPerHour,
      salesHours,
      nonSalesHours,
      adjustedAnnual,
      personalAdjusted,
      wonYtd,
      wonMtd,
      objective,
      attainmentYear,
      attainmentMonth,
    },
    badgeYear,
    badgeMonth,
  };
}
