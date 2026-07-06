import type { FastifyInstance } from "fastify";
import { and, desc, eq } from "drizzle-orm";
import { db, advisorSalesSetup, activityEntries, activityTypes, users } from "@smart-crm/db";
import { advisorSetupSchema, activityEntrySchema, isManagerial } from "@smart-crm/shared";
import { parse } from "../lib/validate.js";
import { authenticate } from "../auth/context.js";
import { requireUser } from "../auth/guards.js";
import { forbidden, notFound } from "../lib/errors.js";
import { getSetup, computeSummary } from "../services/performance.js";

export async function registerPerformanceRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);

  // Resolve the target advisor (self by default; managers may target any advisor in their org).
  async function resolveTarget(req: Parameters<typeof requireUser>[0], advisorIdParam?: string): Promise<{ orgId: string; advisorId: string }> {
    const viewer = requireUser(req);
    const advisorId = advisorIdParam || viewer.id;
    if (advisorId !== viewer.id && !isManagerial(viewer.role)) throw forbidden();
    const [u] = await db.select({ id: users.id }).from(users).where(and(eq(users.id, advisorId), eq(users.orgId, viewer.orgId))).limit(1);
    if (!u) throw notFound("Advisor not found");
    return { orgId: viewer.orgId, advisorId };
  }

  app.get("/setup", async (req) => {
    const { advisorId } = await resolveTarget(req, (req.query as { advisorId?: string }).advisorId);
    return { setup: await getSetup(advisorId) };
  });

  app.put("/setup", async (req) => {
    const { orgId, advisorId } = await resolveTarget(req, (req.query as { advisorId?: string }).advisorId);
    const input = parse(advisorSetupSchema, req.body);
    const values = {
      daysToSell: input.days_to_sell ?? 250,
      hoursPerDay: String(input.hours_per_day ?? 6),
      annualObjective: String(input.annual_objective ?? 0),
      closeRate: String(input.close_rate ?? 0),
      avgSaleSize: String(input.avg_sale_size ?? 0),
      personalObjective: String(input.personal_objective ?? 0),
      updatedAt: new Date(),
    };
    await db
      .insert(advisorSalesSetup)
      .values({ orgId, advisorId, ...values })
      .onConflictDoUpdate({ target: advisorSalesSetup.advisorId, set: values });
    return { setup: await getSetup(advisorId) };
  });

  app.get("/summary", async (req) => {
    const { orgId, advisorId } = await resolveTarget(req, (req.query as { advisorId?: string }).advisorId);
    return await computeSummary(orgId, advisorId);
  });

  // ── Activity log ──
  app.get("/activities", async (req) => {
    const { advisorId } = await resolveTarget(req, (req.query as { advisorId?: string }).advisorId);
    const rows = await db
      .select()
      .from(activityEntries)
      .where(eq(activityEntries.advisorId, advisorId))
      .orderBy(desc(activityEntries.occurredOn), desc(activityEntries.createdAt))
      .limit(200);
    return { activities: rows };
  });

  app.post("/activities", async (req) => {
    const { orgId, advisorId } = await resolveTarget(req, (req.query as { advisorId?: string }).advisorId);
    const input = parse(activityEntrySchema, req.body);
    const [type] = await db
      .select()
      .from(activityTypes)
      .where(and(eq(activityTypes.id, input.activity_type_id), eq(activityTypes.orgId, orgId)))
      .limit(1);
    if (!type) throw notFound("Unknown activity type");
    const [created] = await db
      .insert(activityEntries)
      .values({
        orgId,
        advisorId,
        activityTypeId: type.id,
        category: type.category,
        label: type.label,
        hours: String(input.hours),
        occurredOn: (input.occurred_on ?? new Date()).toISOString().slice(0, 10),
        notes: input.notes ?? null,
      })
      .returning();
    return { activity: created };
  });

  app.delete("/activities/:id", async (req) => {
    const viewer = requireUser(req);
    const { id } = req.params as { id: string };
    const [row] = await db.select().from(activityEntries).where(and(eq(activityEntries.id, id), eq(activityEntries.orgId, viewer.orgId))).limit(1);
    if (!row) throw notFound("Activity not found");
    if (row.advisorId !== viewer.id && !isManagerial(viewer.role)) throw forbidden();
    await db.delete(activityEntries).where(eq(activityEntries.id, id));
    return { ok: true };
  });
}
