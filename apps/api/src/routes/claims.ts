import type { FastifyInstance } from "fastify";
import { and, desc, eq } from "drizzle-orm";
import { db, claimRequests, opportunities, users } from "@smart-crm/db";
import {
  claimDecisionSchema,
  normalizeCompanyName,
  normalizeEmail,
  normalizePhoneE164,
  type OpportunityDraft,
} from "@smart-crm/shared";
import { parse } from "../lib/validate.js";
import { authenticate } from "../auth/context.js";
import { requireManagerial } from "../auth/guards.js";
import { conflict, notFound } from "../lib/errors.js";
import { notify } from "../services/notify.js";

export async function registerClaimRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);

  // GET /api/claim-requests?status=pending — manager queue with full context (§12).
  app.get("/", async (req) => {
    const manager = requireManagerial(req);
    const status = (req.query as { status?: string }).status ?? "pending";
    const requester = users;
    const rows = await db
      .select({
        id: claimRequests.id,
        matchedOpportunityId: claimRequests.matchedOpportunityId,
        matchedCompanyName: claimRequests.matchedCompanyName,
        requestingAdvisorId: claimRequests.requestingAdvisorId,
        currentOwnerId: claimRequests.currentOwnerId,
        draft: claimRequests.draft,
        status: claimRequests.status,
        decisionNote: claimRequests.decisionNote,
        createdAt: claimRequests.createdAt,
        requesterName: requester.fullName,
      })
      .from(claimRequests)
      .leftJoin(requester, eq(requester.id, claimRequests.requestingAdvisorId))
      .where(and(eq(claimRequests.orgId, manager.orgId), eq(claimRequests.status, status as "pending" | "approved" | "rejected")))
      .orderBy(desc(claimRequests.createdAt));

    // owner name (separate join to avoid alias confusion)
    const ownerIds = rows.map((r) => r.currentOwnerId);
    const owners = ownerIds.length
      ? await db.select({ id: users.id, fullName: users.fullName }).from(users).where(eq(users.orgId, manager.orgId))
      : [];
    const ownerName = new Map(owners.map((o) => [o.id, o.fullName]));

    return {
      claimRequests: rows.map((r) => ({ ...r, currentOwnerName: ownerName.get(r.currentOwnerId) ?? null })),
    };
  });

  // POST /api/claim-requests/:id/decide — one-tap approve/reject (§5.1, §12).
  app.post("/:id/decide", async (req) => {
    const manager = requireManagerial(req);
    const { id } = req.params as { id: string };
    const { decision, decision_note } = parse(claimDecisionSchema, req.body);

    const [cr] = await db.select().from(claimRequests).where(and(eq(claimRequests.id, id), eq(claimRequests.orgId, manager.orgId))).limit(1);
    if (!cr) throw notFound("Claim request not found");
    if (cr.status !== "pending") throw conflict("This request has already been decided", "already_decided");

    const now = new Date();

    if (decision === "approved") {
      const draft = cr.draft as OpportunityDraft;
      // Default per §5.1: ownership TRANSFERS to the requester; the captured draft becomes
      // their opportunity. We transfer the existing row (stable id/history) and overlay the draft.
      await db
        .update(opportunities)
        .set({
          advisorId: cr.requestingAdvisorId,
          contractorCompanyName: draft.contractor_company_name,
          companyNameNormalized: normalizeCompanyName(draft.contractor_company_name),
          contactName: draft.contact_name ?? null,
          contactEmail: draft.contact_email ?? null,
          contactEmailNormalized: normalizeEmail(draft.contact_email),
          contactCell: draft.contact_cell ?? null,
          contactCellE164: normalizePhoneE164(draft.contact_cell),
          numTechnicians: draft.num_technicians ?? null,
          product: draft.product,
          opportunityValue: draft.opportunity_value != null ? String(draft.opportunity_value) : null,
          state: draft.state,
          notes: draft.notes ?? null,
          updatedAt: now,
          lastActivityAt: now,
        })
        .where(and(eq(opportunities.id, cr.matchedOpportunityId), eq(opportunities.orgId, manager.orgId)));

      await db
        .update(claimRequests)
        .set({ status: "approved", decidedBy: manager.id, decidedAt: now, decisionNote: decision_note ?? null })
        .where(eq(claimRequests.id, id));

      await notify({
        orgId: manager.orgId,
        userId: cr.requestingAdvisorId,
        type: "claim_decision",
        message: `Your takeover request for ${cr.matchedCompanyName} was approved. It's now in your pipeline.`,
        relatedId: cr.matchedOpportunityId,
      });
      await notify({
        orgId: manager.orgId,
        userId: cr.currentOwnerId,
        type: "account_reassigned",
        message: `${cr.matchedCompanyName} has been reassigned to another advisor by a manager.`,
        relatedId: cr.matchedOpportunityId,
      });
      return { ok: true, status: "approved" };
    }

    // Rejected — draft discarded (kept on the row as a record); requester notified.
    await db
      .update(claimRequests)
      .set({ status: "rejected", decidedBy: manager.id, decidedAt: now, decisionNote: decision_note ?? null })
      .where(eq(claimRequests.id, id));
    await notify({
      orgId: manager.orgId,
      userId: cr.requestingAdvisorId,
      type: "claim_decision",
      message: `Your takeover request for ${cr.matchedCompanyName} was not approved.`,
      relatedId: cr.matchedOpportunityId,
    });
    return { ok: true, status: "rejected" };
  });
}
