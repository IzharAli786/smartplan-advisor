import type { FastifyInstance } from "fastify";
import { and, asc, eq, or, lte, isNotNull } from "drizzle-orm";
import { db, opportunities, claimRequests } from "@smart-crm/db";
import { authenticate } from "../auth/context.js";
import { requireUser } from "../auth/guards.js";

/**
 * Advisor "Today" home (§4, §8.1): the one screen that answers "What do I do today?"
 * Due/overdue next steps + follow-ups + the advisor's own pending takeover requests,
 * scoped to the current user, sorted by urgency. No navigation required.
 */
export async function registerTodayRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);

  app.get("/", async (req) => {
    const user = requireUser(req);

    // End of "today" — anything due on/before this is surfaced.
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

    const rows = await db
      .select()
      .from(opportunities)
      .where(
        and(
          eq(opportunities.orgId, user.orgId),
          eq(opportunities.advisorId, user.id),
          or(
            and(isNotNull(opportunities.nextStepDue), lte(opportunities.nextStepDue, endOfToday)),
            and(isNotNull(opportunities.followUpAt), lte(opportunities.followUpAt, endOfToday)),
          ),
        ),
      )
      .orderBy(asc(opportunities.nextStepDue));

    const now = Date.now();
    const items = rows.map((r) => {
      const dueAt = r.nextStepDue ?? r.followUpAt;
      return {
        id: r.id,
        contractorCompanyName: r.contractorCompanyName,
        status: r.status,
        nextStep: r.nextStep,
        nextStepDue: r.nextStepDue,
        followUpAt: r.followUpAt,
        product: r.product,
        state: r.state,
        overdue: dueAt ? dueAt.getTime() < now : false,
      };
    });

    // The advisor's own pending takeover requests (conflict alerts they raised).
    const pendingClaims = await db
      .select({
        id: claimRequests.id,
        matchedCompanyName: claimRequests.matchedCompanyName,
        status: claimRequests.status,
        createdAt: claimRequests.createdAt,
      })
      .from(claimRequests)
      .where(and(eq(claimRequests.orgId, user.orgId), eq(claimRequests.requestingAdvisorId, user.id), eq(claimRequests.status, "pending")));

    return {
      items,
      overdueCount: items.filter((i) => i.overdue).length,
      pendingClaims,
    };
  });
}
