import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { db, users } from "@smart-crm/db";
import { feedbackSchema } from "@smart-crm/shared";
import { parse } from "../lib/validate.js";
import { authenticate } from "../auth/context.js";
import { requireUser } from "../auth/guards.js";
import { HttpError, badRequest, forbidden, notFound } from "../lib/errors.js";
import { smartplanRequest, smartplanConfigured, SmartPlanError } from "../services/smartplan.js";

/** The subset of SmartPlan's feedback row the Advise UI shows. */
interface SmartPlanFeedback {
  id: number;
  title: string;
  description: string;
  category: string;
  priority: string;
  status: string;
  resolution: string | null;
  createdAt: string;
}

/**
 * Advisor feedback. SmartPlan is the system of record — nothing is stored in
 * the Advise DB. Every route resolves the advisor's email (req.user carries no
 * email) and talks to SmartPlan's /api/advise/feedback endpoints, which scope
 * strictly to advisor-sourced rows owned by that email.
 */
export async function registerFeedbackRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);

  async function requireEmail(userId: string): Promise<string> {
    const [row] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
    if (!row?.email) throw new HttpError(500, "Your account has no email on file", "no_email");
    return row.email;
  }

  function requireConfigured(): void {
    if (!smartplanConfigured()) {
      throw new HttpError(503, "Feedback is not configured on this server", "feedback_disabled");
    }
  }

  // List the advisor's own feedback (drives the My Feedback page).
  app.get("/", async (req) => {
    const user = requireUser(req);
    requireConfigured();
    const email = await requireEmail(user.id);
    try {
      const feedback = await smartplanRequest<SmartPlanFeedback[]>(
        "GET",
        `/api/advise/feedback?email=${encodeURIComponent(email)}`,
      );
      return { feedback };
    } catch (err) {
      req.log.error({ err }, "feedback list from SmartPlan failed");
      throw new HttpError(502, "Could not load your feedback right now — please try again", "feedback_fetch_failed");
    }
  });

  // Submit feedback → forwarded to SmartPlan's central eco-admin inbox,
  // tagged source="advisor" so admins can tell it apart from in-app rows.
  app.post("/", async (req, reply) => {
    const user = requireUser(req);
    const input = parse(feedbackSchema, req.body);
    requireConfigured();
    const email = await requireEmail(user.id);
    try {
      await smartplanRequest("POST", "/api/advise/feedback", {
        title: input.title,
        description: input.description,
        category: input.category,
        priority: input.priority,
        userName: user.fullName,
        userEmail: email,
      });
    } catch (err) {
      req.log.error({ err }, "feedback forward to SmartPlan failed");
      throw new HttpError(502, "Could not deliver your feedback right now — please try again", "feedback_forward_failed");
    }
    reply.code(201);
    return { ok: true };
  });

  // Delete the advisor's own feedback (SmartPlan re-checks ownership by email).
  app.delete("/:id", async (req) => {
    const user = requireUser(req);
    const id = Number((req.params as { id: string }).id);
    if (!Number.isInteger(id)) throw badRequest("Invalid feedback ID");
    requireConfigured();
    const email = await requireEmail(user.id);
    try {
      await smartplanRequest("DELETE", `/api/advise/feedback/${id}?email=${encodeURIComponent(email)}`);
    } catch (err) {
      if (err instanceof SmartPlanError && err.status === 404) throw notFound("Feedback not found");
      if (err instanceof SmartPlanError && err.status === 403) throw forbidden("You can only delete your own feedback");
      req.log.error({ err }, "feedback delete on SmartPlan failed");
      throw new HttpError(502, "Could not delete this feedback right now — please try again", "feedback_delete_failed");
    }
    return { ok: true };
  });
}
