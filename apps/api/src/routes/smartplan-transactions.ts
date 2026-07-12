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

/** Shared-secret guard for the two server-to-server endpoints below. */
function requireIngestSecret(headers: Record<string, unknown>): void {
  if (!env.smartplanIngestSecret) throw badRequest("Ingest is not configured on the server", "ingest_disabled");
  if ((headers["x-ingest-secret"] as string | undefined) !== env.smartplanIngestSecret) throw forbidden("Bad ingest secret");
}

export async function registerSmartPlanTxnRoutes(app: FastifyInstance) {
  // ── Server-to-server endpoints (NO session). ──────────────────────────────
  // These two are guarded by the x-ingest-secret header only. They MUST NOT be
  // covered by the `authenticate` hook, and in Fastify an addHook() in a plugin
  // scope applies to ALL routes of that scope — even ones registered before the
  // addHook call. So the session routes live in an encapsulated sub-plugin
  // below, and the hook is attached there, never here.

  // Stripe ingest: a webhook adapter posts normalized transactions here.
  app.post("/ingest", async (req) => {
    requireIngestSecret(req.headers as Record<string, unknown>);
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

    // A recovered payment cancels its earlier failure adjustment: when the
    // positive row for invoice X arrives, drop the "X:failed" adjustment (if
    // any) so a transient decline that Stripe later collects doesn't net the
    // advisor's commission to zero. Idempotent — deleting nothing is fine.
    if (input.status !== "adjustment" && input.amount > 0) {
      await db
        .delete(smartplanTransactions)
        .where(
          and(
            eq(smartplanTransactions.orgId, advisor.orgId),
            eq(smartplanTransactions.stripeTransactionId, `${input.stripe_transaction_id}:failed`),
            eq(smartplanTransactions.status, "adjustment"),
          ),
        );
    }

    return { transaction: created ?? null, deduped: !created };
  });

  // Referral activation: SmartPlan posts here when a REFERRED customer's
  // instance activates. Creates a pipeline opportunity owned by the referring
  // advisor so it shows up in their pipeline.
  app.post("/activation", async (req) => {
    requireIngestSecret(req.headers as Record<string, unknown>);
    const input = parse(smartPlanActivationSchema, req.body);

    // Only active advisors receive new work — mirrors the leads/imports rule.
    const [advisor] = await db
      .select({ id: users.id, orgId: users.orgId })
      .from(users)
      .where(and(eq(users.id, input.advisor_id), eq(users.active, true)))
      .limit(1);
    if (!advisor) throw notFound("Advisor not found or inactive");

    // Non-Latin/punctuation-only names normalize to "" — fall back to the raw
    // lowercased name so distinct companies never collapse onto one dedupe key.
    const companyNameNormalized = normalizeCompanyName(input.company_name) || input.company_name.trim().toLowerCase();

    // Idempotent: one opportunity per (advisor, company) — safe under webhook
    // retries and the checkout/subscription double-fire from SmartPlan.
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

    // The partial unique index opportunities_referral_dedupe_idx (migration
    // 0021) backstops the SELECT-then-INSERT race: concurrent activations for
    // the same advisor+company conflict, and the loser re-reads the winner.
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
        // Store only a validated 2-letter code (or empty). Raw free text like
        // "Ontario" would make the opportunity fail the web edit form's
        // usState validation forever.
        state: usStateCode(input.state) ?? "",
        notes: "Created from a SmartPlan referral activation.",
        nextStep,
        nextStepDue,
        source: "referral",
        lastActivityAt: now,
      })
      .onConflictDoNothing()
      .returning({ id: opportunities.id });

    if (!opp) {
      // Lost the race — return the row the concurrent request created.
      const [winner] = await db
        .select({ id: opportunities.id })
        .from(opportunities)
        .where(and(eq(opportunities.advisorId, advisor.id), eq(opportunities.companyNameNormalized, companyNameNormalized)))
        .limit(1);
      return { opportunity_id: winner?.id ?? null, deduped: true };
    }

    await logActivity({
      opportunityId: opp.id,
      advisorId: advisor.id,
      type: "system",
      subject: "SmartPlan referral activated",
    });

    return { opportunity_id: opp.id, deduped: false };
  });

  // ── Session routes (advisor/manager UI) — encapsulated so the authenticate
  // hook applies ONLY to them, never to /ingest or /activation above. ────────
  await app.register(async (authed) => {
    authed.addHook("preHandler", authenticate);

    // GET /api/smartplan-transactions?advisorId=&q=&status=&from=&to= — filtered list.
    authed.get("/", async (req) => {
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
    authed.post("/", async (req) => {
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

    authed.delete("/:id", async (req) => {
      const manager = requireManagerial(req);
      const { id } = req.params as { id: string };
      await db.delete(smartplanTransactions).where(and(eq(smartplanTransactions.id, id), eq(smartplanTransactions.orgId, manager.orgId)));
      return { ok: true };
    });
  });
}
