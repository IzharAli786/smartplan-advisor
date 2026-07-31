import type { FastifyInstance } from "fastify";
import { and, asc, desc, eq } from "drizzle-orm";
import { db, users, advisorFeedback } from "@smart-crm/db";
import { advisorProfileSchema, advisorFeedbackSchema, isManagerial } from "@smart-crm/shared";
import { parse } from "../lib/validate.js";
import { authenticate } from "../auth/context.js";
import { requireUser, requireSuperAdmin } from "../auth/guards.js";
import { forbidden, notFound } from "../lib/errors.js";
import { storage } from "../lib/storage.js";

/**
 * Team page (§ advisor profiles). Three concerns, three visibility rules:
 *  - Bios/capabilities: written by each advisor, readable by EVERY signed-in
 *    user in the org — that's the point of the directory.
 *  - Management notes stay on users.notes (managerial-only via serializeUser);
 *    they are deliberately NOT served by any route here.
 *  - advisor_feedback rows: written by super admins FOR an advisor. Readable
 *    by super admins and by the advisor they're addressed to — nobody else.
 */
export async function registerTeamRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);

  // GET /api/team — advisor directory with bios. All signed-in users.
  app.get("/", async (req) => {
    const user = requireUser(req);
    const rows = await db
      .select({
        id: users.id,
        fullName: users.fullName,
        email: users.email,
        statesCovered: users.statesCovered,
        avatarKey: users.avatarKey,
        bio: users.bio,
        capabilities: users.capabilities,
      })
      .from(users)
      .where(and(eq(users.orgId, user.orgId), eq(users.role, "advisor"), eq(users.active, true)))
      .orderBy(asc(users.fullName));
    return {
      advisors: rows.map((r) => ({
        id: r.id,
        fullName: r.fullName,
        email: r.email,
        statesCovered: r.statesCovered,
        avatarUrl: r.avatarKey ? storage.signedUrl(r.avatarKey, 3600) : null,
        bio: r.bio,
        capabilities: r.capabilities,
      })),
    };
  });

  // PUT /api/team/me/profile — the signed-in user edits their OWN bio/capabilities.
  app.put("/me/profile", async (req) => {
    const user = requireUser(req);
    const input = parse(advisorProfileSchema, req.body);
    await db
      .update(users)
      .set({ bio: input.bio ?? null, capabilities: input.capabilities ?? null, updatedAt: new Date() })
      .where(and(eq(users.id, user.id), eq(users.orgId, user.orgId)));
    return { ok: true };
  });

  /** The advisor the feedback belongs to, or 404. Org-scoped. */
  async function requireAdvisor(orgId: string, advisorId: string) {
    const [row] = await db
      .select({ id: users.id, role: users.role })
      .from(users)
      .where(and(eq(users.id, advisorId), eq(users.orgId, orgId), eq(users.role, "advisor")))
      .limit(1);
    if (!row) throw notFound("Advisor not found");
    return row;
  }

  // GET /api/team/:advisorId/feedback — super admin: any advisor. Advisor: self only.
  app.get("/:advisorId/feedback", async (req) => {
    const user = requireUser(req);
    const { advisorId } = req.params as { advisorId: string };
    if (!isManagerial(user.role) && user.id !== advisorId) {
      throw forbidden("You can only view feedback written for you");
    }
    await requireAdvisor(user.orgId, advisorId);
    const rows = await db
      .select({
        id: advisorFeedback.id,
        body: advisorFeedback.body,
        createdAt: advisorFeedback.createdAt,
        authorName: users.fullName,
      })
      .from(advisorFeedback)
      .leftJoin(users, eq(advisorFeedback.authorId, users.id))
      .where(and(eq(advisorFeedback.advisorId, advisorId), eq(advisorFeedback.orgId, user.orgId)))
      .orderBy(desc(advisorFeedback.createdAt));
    return { feedback: rows };
  });

  // POST /api/team/:advisorId/feedback — super admin writes feedback for an advisor.
  app.post("/:advisorId/feedback", async (req, reply) => {
    const viewer = requireSuperAdmin(req);
    const { advisorId } = req.params as { advisorId: string };
    const input = parse(advisorFeedbackSchema, req.body);
    await requireAdvisor(viewer.orgId, advisorId);
    const [created] = await db
      .insert(advisorFeedback)
      .values({ orgId: viewer.orgId, advisorId, authorId: viewer.id, body: input.body })
      .returning();
    reply.code(201);
    return { feedback: { id: created!.id, body: created!.body, createdAt: created!.createdAt, authorName: viewer.fullName } };
  });

  // DELETE /api/team/:advisorId/feedback/:feedbackId — super admin only.
  app.delete("/:advisorId/feedback/:feedbackId", async (req) => {
    const viewer = requireSuperAdmin(req);
    const { advisorId, feedbackId } = req.params as { advisorId: string; feedbackId: string };
    const [removed] = await db
      .delete(advisorFeedback)
      .where(
        and(
          eq(advisorFeedback.id, feedbackId),
          eq(advisorFeedback.advisorId, advisorId),
          eq(advisorFeedback.orgId, viewer.orgId),
        ),
      )
      .returning();
    if (!removed) throw notFound("Feedback not found");
    return { ok: true };
  });
}
