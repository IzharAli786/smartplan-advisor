import type { FastifyInstance } from "fastify";
import { and, desc, eq } from "drizzle-orm";
import { db, highFives, users } from "@smart-crm/db";
import { highFiveSchema } from "@smart-crm/shared";
import { parse } from "../lib/validate.js";
import { authenticate } from "../auth/context.js";
import { requireUser, requireManagerial } from "../auth/guards.js";
import { notFound } from "../lib/errors.js";

export async function registerHighFiveRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);

  // POST /api/high-fives — a manager sends a high-five to an advisor in their org.
  app.post("/", async (req) => {
    const manager = requireManagerial(req);
    const input = parse(highFiveSchema, req.body);
    const [advisor] = await db.select({ id: users.id }).from(users).where(and(eq(users.id, input.to_advisor_id), eq(users.orgId, manager.orgId))).limit(1);
    if (!advisor) throw notFound("Advisor not found");
    const [created] = await db
      .insert(highFives)
      .values({ orgId: manager.orgId, fromUserId: manager.id, fromName: manager.fullName, toAdvisorId: input.to_advisor_id, message: input.message ?? null })
      .returning();
    return { highFive: created };
  });

  // GET /api/high-fives/pending — unseen high-fives for the current user (drives the animation).
  app.get("/pending", async (req) => {
    const user = requireUser(req);
    const rows = await db
      .select()
      .from(highFives)
      .where(and(eq(highFives.toAdvisorId, user.id), eq(highFives.seen, false)))
      .orderBy(desc(highFives.createdAt))
      .limit(10);
    return { highFives: rows };
  });

  // POST /api/high-fives/:id/seen — acknowledge (stop re-showing).
  app.post("/:id/seen", async (req) => {
    const user = requireUser(req);
    const { id } = req.params as { id: string };
    await db.update(highFives).set({ seen: true }).where(and(eq(highFives.id, id), eq(highFives.toAdvisorId, user.id)));
    return { ok: true };
  });
}
