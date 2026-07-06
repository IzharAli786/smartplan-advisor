import { and, eq } from "drizzle-orm";
import { db, statusStages } from "@smart-crm/db";

export interface StageInfo {
  key: string;
  label: string;
  isConversion: boolean;
  isTerminal: boolean;
}

/** Load all of an org's stages keyed by stable key. */
export async function getStageMap(orgId: string): Promise<Map<string, StageInfo>> {
  const rows = await db.select().from(statusStages).where(eq(statusStages.orgId, orgId));
  const map = new Map<string, StageInfo>();
  for (const r of rows) {
    map.set(r.key, { key: r.key, label: r.label, isConversion: r.isConversion, isTerminal: r.isTerminal });
  }
  return map;
}

export async function getStage(orgId: string, key: string): Promise<StageInfo | null> {
  const [r] = await db.select().from(statusStages).where(and(eq(statusStages.orgId, orgId), eq(statusStages.key, key))).limit(1);
  return r ? { key: r.key, label: r.label, isConversion: r.isConversion, isTerminal: r.isTerminal } : null;
}

/** The default stage for a brand-new opportunity = lowest sort_order, active. */
export async function getInitialStageKey(orgId: string): Promise<string> {
  const rows = await db.select().from(statusStages).where(eq(statusStages.orgId, orgId)).orderBy(statusStages.sortOrder);
  const first = rows.find((r) => r.active) ?? rows[0];
  if (!first) throw new Error("No status stages configured for this organization");
  return first.key;
}
