import type { FastifyInstance } from "fastify";
import { and, desc, eq, count } from "drizzle-orm";
import { db, notifications } from "@smart-crm/db";
import { authenticate } from "../auth/context.js";
import { requireUser } from "../auth/guards.js";

export async function registerNotificationRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);

  // GET /api/notifications — current user's notifications + unread badge count (§13).
  app.get("/", async (req) => {
    const user = requireUser(req);
    const rows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, user.id))
      .orderBy(desc(notifications.createdAt))
      .limit(100);
    const [{ value: unread } = { value: 0 }] = await db
      .select({ value: count() })
      .from(notifications)
      .where(and(eq(notifications.userId, user.id), eq(notifications.read, false)));
    return { notifications: rows, unread: Number(unread) };
  });

  app.post("/:id/read", async (req) => {
    const user = requireUser(req);
    const { id } = req.params as { id: string };
    await db
      .update(notifications)
      .set({ read: true })
      .where(and(eq(notifications.id, id), eq(notifications.userId, user.id)));
    return { ok: true };
  });

  app.post("/read-all", async (req) => {
    const user = requireUser(req);
    await db.update(notifications).set({ read: true }).where(eq(notifications.userId, user.id));
    return { ok: true };
  });
}
