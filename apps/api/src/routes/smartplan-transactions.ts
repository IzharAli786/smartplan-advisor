import type { FastifyInstance } from "fastify";
import { and, asc, desc, eq, gte, ilike, lte, ne, or, sql as dsql } from "drizzle-orm";
import { db, smartplanTransactions, opportunities, organizations, users } from "@smart-crm/db";
import {
  smartPlanTxnSchema,
  smartPlanTxnIngestSchema,
  smartPlanActivationSchema,
  smartPlanAdvisorSyncSchema,
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
import { recordRateChange } from "../services/commission.js";
import { issueInvite } from "./users.js";
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
        companyName: input.company_name ?? null,
        companyNameNormalized: input.company_name ? normalizeCompanyName(input.company_name) : null,
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

  // Advisor sync: SmartPlan's Eco Admin posts here when a Smart Advisor
  // (referral partner) is created or edited. Upserts a REAL Advise advisor
  // account by email so the roster stays in sync, and returns the user's UUID
  // — SmartPlan stores it as the commission-routing link. Idempotent.
  app.post("/advisor-sync", async (req) => {
    requireIngestSecret(req.headers as Record<string, unknown>);
    const input = parse(smartPlanAdvisorSyncSchema, req.body);
    const toDateStr = (d?: Date) => (d ? d.toISOString().slice(0, 10) : null);

    // IDENTITY-FIRST lookup: when SmartPlan already holds a link, match by
    // user id — so an email correction updates THE SAME account instead of
    // spawning a duplicate. A stale/unknown id falls back to email matching.
    let existing: { id: string; role: string; active: boolean; email: string; passwordHash: string | null } | undefined;
    if (input.advise_user_id) {
      const [byId] = await db
        .select({ id: users.id, role: users.role, active: users.active, email: users.email, passwordHash: users.passwordHash })
        .from(users)
        .where(eq(users.id, input.advise_user_id))
        .limit(1);
      if (byId) existing = byId;
    }
    if (!existing) {
      const [byEmail] = await db
        .select({ id: users.id, role: users.role, active: users.active, email: users.email, passwordHash: users.passwordHash })
        .from(users)
        .where(dsql`lower(${users.email}) = lower(${input.email})`)
        .limit(1);
      if (byEmail) existing = byEmail;
    }

    if (existing) {
      // NEVER let a sync touch a manager/super-admin account: a Smart Advisor
      // created in SmartPlan with (say) Tom's email must not rename or
      // deactivate him. Only advisor-role accounts are sync-managed.
      if (existing.role !== "advisor") {
        throw badRequest("That email belongs to a non-advisor Advise account", "email_reserved");
      }
      // Refresh profile fields only. Role, password, and the commission rate
      // stay Advise-managed (rate changes have effective-dating rules the
      // manager controls in Advise — a sync must not silently rewrite money).
      const patch: Record<string, unknown> = {
        fullName: input.full_name,
        updatedAt: new Date(),
      };
      // Email change (id-matched): keep the roster unique.
      if (existing.email.toLowerCase() !== input.email.toLowerCase()) {
        const [dupe] = await db
          .select({ id: users.id })
          .from(users)
          .where(and(dsql`lower(${users.email}) = lower(${input.email})`, ne(users.id, existing.id)))
          .limit(1);
        if (dupe) throw badRequest("That email is already used by another Advise account", "email_taken");
        patch.email = input.email;
      }
      if (input.phone !== undefined) patch.phone = input.phone;
      if (input.referral_link !== undefined) patch.referralLink = input.referral_link;
      if (input.referred_by !== undefined) patch.referredBy = input.referred_by;
      if (input.enrolled_date !== undefined) patch.enrolledDate = toDateStr(input.enrolled_date);
      if (input.active !== undefined && input.active !== existing.active) {
        patch.active = input.active;
        // Deactivation revokes sessions, same as the managerial PATCH.
        if (!input.active) patch.sessionVersion = dsql`${users.sessionVersion} + 1`;
      }
      await db.update(users).set(patch).where(eq(users.id, existing.id));
      // Re-send the set-password invite when SmartPlan's eco-admin asks AND the
      // advisor hasn't set a password yet. An already-active advisor is never
      // re-invited (that's the safeguard against resetting a live account).
      let invited = false;
      if (input.request_invite && !existing.passwordHash) {
        try {
          await issueInvite(existing.id, input.email, input.full_name);
          invited = true;
        } catch (err) {
          req.log.error({ err }, "advisor-sync: re-invite email failed");
        }
      }
      return { user_id: existing.id, created: false, invited };
    }

    // Create an invited advisor account — mirrors POST /api/users for the
    // advisor role. Org resolution: join the org of the most recently created
    // ACTIVE super admin — that's the org actually being operated. (Databases
    // that went through setup experiments can hold several orgs; "oldest org"
    // once filed synced advisors into an abandoned seed org where the real
    // admin could never see them.) Fallback: oldest org.
    const [adminOrg] = await db
      .select({ orgId: users.orgId })
      .from(users)
      .where(and(eq(users.role, "super_admin"), eq(users.active, true)))
      .orderBy(desc(users.createdAt))
      .limit(1);
    let syncOrgId = adminOrg?.orgId ?? null;
    if (!syncOrgId) {
      const [org] = await db.select({ id: organizations.id }).from(organizations).orderBy(asc(organizations.createdAt)).limit(1);
      syncOrgId = org?.id ?? null;
    }
    if (!syncOrgId) throw notFound("No organization exists in Advise yet");
    const org = { id: syncOrgId };

    const rate = input.commission_rate ?? 15;
    const stateCode = usStateCode(input.state);
    // onConflictDoNothing + re-select: the users_email_unique index backstops a
    // concurrent double-sync for the same new email (e.g. double-click Create).
    const [created] = await db
      .insert(users)
      .values({
        role: "advisor",
        orgId: org.id,
        fullName: input.full_name,
        email: input.email,
        phone: input.phone ?? null,
        referralLink: input.referral_link ?? null,
        enrolledDate: toDateStr(input.enrolled_date),
        referredBy: input.referred_by ?? null,
        statesCovered: stateCode ? [stateCode] : [],
        currentCommissionRate: String(rate),
        active: input.active ?? true,
        invitedAt: new Date(),
      })
      .onConflictDoNothing()
      .returning({ id: users.id, email: users.email, fullName: users.fullName });

    if (!created) {
      // Lost a concurrent race — return the row the winner created.
      const [winner] = await db
        .select({ id: users.id, role: users.role })
        .from(users)
        .where(dsql`lower(${users.email}) = lower(${input.email})`)
        .limit(1);
      if (!winner || winner.role !== "advisor") throw badRequest("That email belongs to a non-advisor Advise account", "email_reserved");
      return { user_id: winner.id, created: false, invited: false };
    }

    // Seed the effective-dated commission history, like the normal create flow.
    await recordRateChange(org.id, created.id, rate, toDateStr(input.enrolled_date) ?? undefined);

    // Send the set-password invite. A mailer hiccup must not fail the sync —
    // the account exists; the invite can be re-sent (SmartPlan resend or the
    // Advise UI). `invited` tells SmartPlan whether the email actually went out.
    let invited = false;
    try {
      await issueInvite(created.id, created.email, created.fullName);
      invited = true;
    } catch (err) {
      req.log.error({ err }, "advisor-sync: invite email failed (account created)");
    }

    return { user_id: created.id, created: true, invited };
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
