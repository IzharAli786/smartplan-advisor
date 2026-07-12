import type { FastifyInstance } from "fastify";
import { and, desc, eq, gte, ilike, lte, or } from "drizzle-orm";
import { db, smartplanTransactions, opportunities, users } from "@smart-crm/db";
import {
  smartPlanTxnSchema,
  smartPlanTxnIngestSchema,
  smartPlanActivationSchema,
  isManagerial,
  normalizeCompanyName,
  normalizeEmail,
  normalizePhoneE164,
  computeNextStep,
  usStateCode,
} from "@smart-crm/shared";
import { parse } from "../lib/validate.js";
import { authenticate } from "../auth/context.js";
import { requireUser, requireManagerial } from "../auth/guards.js";
import { badRequest, forbidden, notFound } from "../lib/errors.js";
import { getStage, getInitialStageKey } from "../services/stages.js";
import { logActivity } from "../services/activity.js";
import { env } from "../env.js";

export async function registerSmartPlanTxnRoutes(app: FastifyInstance) {
  // ── Stripe ingest (no session): a webhook adapter posts normalized transactions here. ──
  // Guarded by a shared secret header. Configure SMARTPLAN_INGEST_SECRET to enable.
  app.post("/ingest", async (req) => {
    if (!env.smartplanIngestSecret) throw badRequest("Ingest is not configured on the server", "ingest_disabled");
    if ((req.headers["x-ingest-secret"] as string | undefined) !== env.smartplanIngestSecret) throw forbidden("Bad ingest secret");
    const input = parse(smartPlanTxnIngestSchema, req.body);
    const [advisor] = await db.select({ orgId: users.orgId }).from(users).where(eq(users.id, input.advisor_id)).limit(1);
    if (!advisor) throw notFound("Advisor not found");
    const [created] = await db
      .insert(smartplanTransactions)
      .values({
        orgId: advisor.orgId,
        advisorId: input.advisor_id,
        stripeTransactionId: input.stripe_transaction_id,
        occurredAt: input.occurred_at ?? new Date(),
        amount: String(input.amount),
        product: input.product ?? null,
        status: input.status,
        source: "stripe",
      })
      .onConflictDoNothing()
      .returning();
    return { transaction: created ?? null, deduped: !created };
  });

  // ── Referral activation (no session) — a SmartPlan webhook posts here when a
  // referred customer activates. We create a pipeline opportunity owned by the
  // referring advisor so it appears in their pipeline. Same shared secret. ──
  app.post("/activation", async (req) => {
    if (!env.smartplanIngestSecret) throw badRequest("Ingest is not configured on the server", "ingest_disabled");
    if ((req.headers["x-ingest-secret"] as string | undefined) !== env.smartplanIngestSecret) throw forbidden("Bad ingest secret");
    const input = parse(smartPlanActivationSchema, req.body);

    const [advisor] = await db
      .select({ id: users.id, orgId: users.orgId })
      .from(users)
      .where(eq(users.id, input.advisor_id))
      .limit(1);
    if (!advisor) throw notFound("Advisor not found");

    const companyNameNormalized = normalizeCompanyName(input.company_name);
    // Idempotent: one referral opportunity per (advisor, company) — safe under
    // webhook retries.
    const [existing] = await db
      .select({ id: opportunities.id })
      .from(opportunities)
      .where(and(eq(opportunities.advisorId, advisor.id), eq(opportunities.companyNameNormalized, companyNameNormalized)))
      .limit(1);
    if (existing) return { opportunity_id: existing.id, deduped: true };

    const now = new Date();
    const initialStage = await getInitialStageKey(advisor.orgId);
    const stage = await getStage(advisor.orgId, initialStage);
    const { nextStep, nextStepDue } = computeNextStep({
      stageKey: initialStage,
      isTerminal: stage?.isTerminal ?? false,
      statusChangedAt: now,
      followUpAt: null,
    });

    const [opp] = await db
      .insert(opportunities)
      .values({
        orgId: advisor.orgId,
        advisorId: advisor.id,
        contractorCompanyName: input.company_name,
        companyNameNormalized,
        contactName: input.contact_name ?? null,
        contactEmail: input.contact_email ?? null,
        contactEmailNormalized: normalizeEmail(input.contact_email),
        contactCell: input.contact_cell ?? null,
        contactCellE164: normalizePhoneE164(input.contact_cell),
        product: input.product ?? null,
        opportunityValue: input.opportunity_value != null ? String(input.opportunity_value) : null,
        status: initialStage,
        statusChangedAt: now,
        state: usStateCode(input.state) ?? input.state ?? "",
        notes: "Created from a SmartPlan referral activation.",
        nextStep,
        nextStepDue,
        source: "referral",
        lastActivityAt: now,
      })
      .returning({ id: opportunities.id });

    await logActivity({
      opportunityId: opp!.id,
      advisorId: advisor.id,
      type: "system",
      subject: "SmartPlan referral activated",
    });

    return { opportunity_id: opp!.id, deduped: false };
  });

  app.addHook("preHandler", authenticate);

  // GET /api/smartplan-transactions?advisorId=&q=&status=&from=&to= — filtered list.
  app.get("/", async (req) => {
    const user = requireUser(req);
    const q = req.query as { advisorId?: string; q?: string; status?: string; from?: string; to?: string };
    const conds = [eq(smartplanTransactions.orgId, user.orgId)];
    // Advisors only ever see their own; managers may scope to one advisor or see all.
    if (!isManagerial(user.role)) conds.push(eq(smartplanTransactions.advisorId, user.id));
    else if (q.advisorId) conds.push(eq(smartplanTransactions.advisorId, q.advisorId));
    if (q.status === "active" || q.status === "inactive" || q.status === "adjustment") conds.push(eq(smartplanTransactions.status, q.status));
    if (q.from) conds.push(gte(smartplanTransactions.occurredAt, new Date(q.from)));
    if (q.to) {
      const to = new Date(q.to);
      to.setHours(23, 59, 59, 999);
      conds.push(lte(smartplanTransactions.occurredAt, to));
    }
    if (q.q) {
      const like = `%${q.q}%`;
      const m = or(ilike(smartplanTransactions.stripeTransactionId, like), ilike(smartplanTransactions.product, like));
      if (m) conds.push(m);
    }
    const rows = await db.select().from(smartplanTransactions).where(and(...conds)).orderBy(desc(smartplanTransactions.occurredAt)).limit(500);
    return { transactions: rows };
  });

  // POST /api/smartplan-transactions — add a manual transaction (managerial).
  app.post("/", async (req) => {
    const manager = requireManagerial(req);
    const input = parse(smartPlanTxnSchema, req.body);
    const [advisor] = await db.select({ id: users.id }).from(users).where(and(eq(users.id, input.advisor_id), eq(users.orgId, manager.orgId))).limit(1);
    if (!advisor) throw notFound("Advisor not found");
    const [created] = await db
      .insert(smartplanTransactions)
      .values({
        orgId: manager.orgId,
        advisorId: input.advisor_id,
        stripeTransactionId: input.stripe_transaction_id ?? null,
        occurredAt: input.occurred_at ?? new Date(),
        amount: String(input.amount),
        product: input.product ?? null,
        status: input.status,
        source: "manual",
      })
      .returning();
    return { transaction: created };
  });

  app.delete("/:id", async (req) => {
    const manager = requireManagerial(req);
    const { id } = req.params as { id: string };
    await db.delete(smartplanTransactions).where(and(eq(smartplanTransactions.id, id), eq(smartplanTransactions.orgId, manager.orgId)));
    return { ok: true };
  });
}
