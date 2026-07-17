import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { db, users } from "@smart-crm/db";
import { feedbackSchema } from "@smart-crm/shared";
import { parse } from "../lib/validate.js";
import { authenticate } from "../auth/context.js";
import { requireUser } from "../auth/guards.js";
import { HttpError } from "../lib/errors.js";
import { postToSmartPlan, smartplanConfigured } from "../services/smartplan.js";

export async function registerFeedbackRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);

  // Forward advisor feedback to SmartPlan's central eco-admin feedback inbox.
  // Nothing is stored locally — SmartPlan is the system of record and tags the
  // row source="advisor" so admins can tell it apart from in-app submissions.
  app.post("/", async (req, reply) => {
    const user = requireUser(req);
    const input = parse(feedbackSchema, req.body);

    if (!smartplanConfigured()) {
      throw new HttpError(503, "Feedback is not configured on this server", "feedback_disabled");
    }

    // req.user carries no email — read it off the live row for attribution.
    const [row] = await db.select({ email: users.email }).from(users).where(eq(users.id, user.id)).limit(1);

    try {
      await postToSmartPlan("/api/advise/feedback", {
        title: input.title,
        description: input.description,
        category: input.category,
        priority: input.priority,
        userName: user.fullName,
        userEmail: row?.email ?? null,
      });
    } catch (err) {
      req.log.error({ err }, "feedback forward to SmartPlan failed");
      throw new HttpError(502, "Could not deliver your feedback right now — please try again", "feedback_forward_failed");
    }

    reply.code(201);
    return { ok: true };
  });
}
