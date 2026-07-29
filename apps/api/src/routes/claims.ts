import type { FastifyInstance } from "fastify";
import { and, eq, inArray, sql as dsql } from "drizzle-orm";
import { db, claimRequests, opportunities, quotes, users } from "@smart-crm/db";
import { claimDecisionSchema, type OpportunityDraft } from "@smart-crm/shared";
import { parse } from "../lib/validate.js";
import { authenticate } from "../auth/context.js";
import { requireManagerial } from "../auth/guards.js";
import { conflict, notFound } from "../lib/errors.js";
import { logActivity } from "../services/activity.js";
import { sendTakeoverAlerts, takeoverEmailHtml, type TakeoverAlert } from "../services/takeover-notify.js";

/** Postgres unique-violation. postgres-js surfaces `code` but no `statusCode`. */
function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "23505";
}

const NOTES_CAP = 20000;

/**
 * Approval is a PURE OWNERSHIP MOVE — the account's own data is never overwritten by the
 * requester's draft. The incumbent may have spent months enriching the record; replacing
 * their contact, product, value and notes with a stranger's cold-call capture destroyed
 * that (the old behaviour). Instead the draft is preserved verbatim as a dated block at
 * the end of `notes`, where the new owner can read it and promote whatever is actually
 * better field-by-field.
 *
 * Capped at NOTES_CAP because opportunityUpdateSchema enforces the same limit — letting
 * notes grow past it would make every subsequent PATCH 400 on a field nobody touched.
 * When we must truncate we drop the OLDEST content, since the newest intake is the reason
 * the manager is looking at this record at all.
 */
export function composeTakeoverNotes(
  existing: string | null,
  draft: OpportunityDraft,
  requesterName: string,
  when: Date,
): string {
  const date = when.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const lines: string[] = [`--- Takeover intake (${requesterName}, ${date}) ---`];

  const contact = [draft.contact_name, draft.contact_email, draft.contact_cell].filter(Boolean).join(" · ");
  if (contact) lines.push(`Contact: ${contact}`);

  const productBits = [draft.product, draft.num_technicians != null ? `${draft.num_technicians} technicians` : null]
    .filter(Boolean)
    .join(" · ");
  if (productBits) lines.push(`Product: ${productBits}`);

  const valueBits = [
    draft.opportunity_value != null ? `Value: ${draft.opportunity_value}` : null,
    draft.state ? `State: ${draft.state}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  if (valueBits) lines.push(valueBits);

  // The typed name only appears when it differs — under exact matching it usually only
  // varies by case or punctuation, and repeating it adds noise.
  if (draft.contractor_company_name) lines.push(`Typed as: ${draft.contractor_company_name}`);
  if (draft.notes) lines.push(`Notes: ${draft.notes}`);

  const block = lines.join("\n");
  const composed = existing?.trim() ? `${existing.trim()}\n\n${block}` : block;
  if (composed.length <= NOTES_CAP) return composed;

  const marker = "[… earlier notes truncated …]\n\n";
  return marker + composed.slice(composed.length - (NOTES_CAP - marker.length));
}

export async function registerClaimRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);

  // GET /api/claim-requests?status=pending — manager queue with full context (§12).
  app.get("/", async (req) => {
    const manager = requireManagerial(req);
    // Validated rather than cast: the value is interpolated against an enum column, so an
    // arbitrary string would surface as a raw Postgres 22P02 instead of an empty list.
    const raw = (req.query as { status?: string }).status ?? "pending";
    const status = (["pending", "approved", "rejected"] as const).find((s) => s === raw) ?? "pending";

    // One query. The previous version issued a second one that loaded EVERY user in the
    // org just to resolve owner names. Lateral counts give the manager the fairness
    // signals — how much work the incumbent has actually put in — without an N+1.
    const rows = await db.execute<{
      id: string;
      matched_opportunity_id: string;
      matched_company_name: string;
      requesting_advisor_id: string;
      current_owner_id: string;
      draft: OpportunityDraft;
      matched_on: string | null;
      status: string;
      decision_note: string | null;
      created_at: Date;
      requester_name: string | null;
      current_owner_name: string | null;
      current_company_name: string | null;
      owner_stage_label: string | null;
      deal_value: string | null;
      opportunity_source: string | null;
      opportunity_created_at: Date | null;
      last_activity_at: Date | null;
      activity_count: number;
      quote_count: number;
    }>(dsql`
      SELECT cr.id,
             cr.matched_opportunity_id,
             cr.matched_company_name,
             cr.requesting_advisor_id,
             cr.current_owner_id,
             cr.draft,
             cr.matched_on,
             cr.status,
             cr.decision_note,
             cr.created_at,
             ru.full_name  AS requester_name,
             ou.full_name  AS current_owner_name,
             -- The LIVE name, which now diverges from matched_company_name whenever the
             -- incumbent renamed the account after the request was raised.
             o.contractor_company_name AS current_company_name,
             s.label       AS owner_stage_label,
             o.opportunity_value       AS deal_value,
             o.source      AS opportunity_source,
             o.created_at  AS opportunity_created_at,
             o.last_activity_at,
             COALESCE(ac.n, 0)::int AS activity_count,
             COALESCE(qc.n, 0)::int AS quote_count
      FROM claim_requests cr
      LEFT JOIN users ru ON ru.id = cr.requesting_advisor_id
      LEFT JOIN users ou ON ou.id = cr.current_owner_id
      LEFT JOIN opportunities o ON o.id = cr.matched_opportunity_id
      LEFT JOIN status_stages s ON s.org_id = o.org_id AND s.key = o.status
      LEFT JOIN LATERAL (SELECT count(*) AS n FROM activities a WHERE a.opportunity_id = o.id) ac ON true
      LEFT JOIN LATERAL (SELECT count(*) AS n FROM quotes q WHERE q.opportunity_id = o.id) qc ON true
      WHERE cr.org_id = ${manager.orgId} AND cr.status = ${status}::claim_status
      ORDER BY cr.created_at DESC
    `);

    return {
      claimRequests: rows.map((r) => ({
        id: r.id,
        matchedOpportunityId: r.matched_opportunity_id,
        matchedCompanyName: r.matched_company_name,
        requestingAdvisorId: r.requesting_advisor_id,
        currentOwnerId: r.current_owner_id,
        draft: r.draft,
        matchedOn: r.matched_on,
        status: r.status,
        decisionNote: r.decision_note,
        createdAt: r.created_at,
        requesterName: r.requester_name,
        currentOwnerName: r.current_owner_name,
        currentCompanyName: r.current_company_name,
        ownerStageLabel: r.owner_stage_label,
        dealValue: r.deal_value == null ? null : Number(r.deal_value),
        opportunitySource: r.opportunity_source,
        opportunityCreatedAt: r.opportunity_created_at,
        lastActivityAt: r.last_activity_at,
        activityCount: r.activity_count,
        quoteCount: r.quote_count,
      })),
    };
  });

  // POST /api/claim-requests/:id/decide — one-tap approve/reject (§5.1, §12).
  app.post("/:id/decide", async (req) => {
    const manager = requireManagerial(req);
    const { id } = req.params as { id: string };
    const { decision, decision_note } = parse(claimDecisionSchema, req.body);

    const [cr] = await db
      .select()
      .from(claimRequests)
      .where(and(eq(claimRequests.id, id), eq(claimRequests.orgId, manager.orgId)))
      .limit(1);
    if (!cr) throw notFound("Claim request not found");
    if (cr.status !== "pending") throw conflict("This request has already been decided", "already_decided");

    const now = new Date();
    const alerts: TakeoverAlert[] = [];

    // ---- Rejection: no side effects on the account, both parties told. ----
    if (decision !== "approved") {
      const updated = await db
        .update(claimRequests)
        .set({ status: "rejected", decidedBy: manager.id, decidedAt: now, decisionNote: decision_note ?? null })
        .where(and(eq(claimRequests.id, id), eq(claimRequests.status, "pending")))
        .returning({ id: claimRequests.id });
      if (updated.length === 0) throw conflict("This request has already been decided", "already_decided");

      const names = await loadNames(manager.orgId, [cr.requestingAdvisorId, cr.currentOwnerId]);
      const noteLine = decision_note ? `Manager's note: ${decision_note}` : "";
      alerts.push(
        {
          orgId: manager.orgId,
          userId: cr.requestingAdvisorId,
          type: "claim_decision",
          // The requester does NOT own this account, so a deep-link would 403 them.
          relatedId: null,
          message: `Your takeover request for ${cr.matchedCompanyName} was not approved.`,
          subject: `Takeover request declined — ${cr.matchedCompanyName}`,
          html: takeoverEmailHtml({
            greetingName: names.get(cr.requestingAdvisorId) ?? "there",
            intro: `Your request to take over ${cr.matchedCompanyName} was not approved. The account stays with ${names.get(cr.currentOwnerId) ?? "its current advisor"}.`,
            details: [noteLine],
          }),
        },
        {
          orgId: manager.orgId,
          userId: cr.currentOwnerId,
          type: "claim_decision",
          relatedId: cr.matchedOpportunityId, // they still own it — link works
          message: `A takeover request for ${cr.matchedCompanyName} was declined. The account stays with you.`,
          subject: `You keep ${cr.matchedCompanyName}`,
          html: takeoverEmailHtml({
            greetingName: names.get(cr.currentOwnerId) ?? "there",
            intro: `${names.get(cr.requestingAdvisorId) ?? "Another advisor"} requested ${cr.matchedCompanyName}. A manager declined it — the account stays with you.`,
            details: [noteLine],
            ctaLabel: "Open the account",
            ctaPath: `/opportunities/${cr.matchedOpportunityId}`,
          }),
        },
      );
      await sendTakeoverAlerts(alerts, req.log);
      return { ok: true, status: "rejected" };
    }

    // ---- Approval. Everything below is stale-state checking before any write. ----
    const [opp] = await db
      .select()
      .from(opportunities)
      .where(and(eq(opportunities.id, cr.matchedOpportunityId), eq(opportunities.orgId, manager.orgId)))
      .limit(1);

    // The account was deleted while the request sat in the queue. Close the request so it
    // stops cluttering the queue rather than leaving an undecidable row behind.
    if (!opp) {
      await db
        .update(claimRequests)
        .set({
          status: "rejected",
          decidedBy: manager.id,
          decidedAt: now,
          decisionNote: "The account no longer exists.",
        })
        .where(and(eq(claimRequests.id, id), eq(claimRequests.status, "pending")));
      throw conflict("That account no longer exists — the request has been closed.", "stale_request");
    }

    // Already theirs (a second manager approved a duplicate, or ownership moved by hand).
    // Close it approved and skip the side effects; re-running them would append the intake
    // block a second time and log a phantom transfer.
    if (opp.advisorId === cr.requestingAdvisorId) {
      await db
        .update(claimRequests)
        .set({ status: "approved", decidedBy: manager.id, decidedAt: now, decisionNote: decision_note ?? null })
        .where(and(eq(claimRequests.id, id), eq(claimRequests.status, "pending")));
      return { ok: true, status: "approved", noop: true };
    }

    // Ownership moved to a THIRD advisor since the request was raised. The manager was
    // looking at stale context, so refuse rather than silently transferring away from
    // someone who never had a say.
    if (opp.advisorId !== cr.currentOwnerId) {
      await db
        .update(claimRequests)
        .set({
          status: "rejected",
          decidedBy: manager.id,
          decidedAt: now,
          decisionNote: "The account changed owner while this request was pending.",
        })
        .where(and(eq(claimRequests.id, id), eq(claimRequests.status, "pending")));
      const names = await loadNames(manager.orgId, [cr.requestingAdvisorId]);
      await sendTakeoverAlerts(
        [
          {
            orgId: manager.orgId,
            userId: cr.requestingAdvisorId,
            type: "claim_decision",
            relatedId: null,
            message: `Your takeover request for ${cr.matchedCompanyName} was closed — the account changed owner while it was pending. Please raise it again.`,
            subject: `Takeover request closed — ${cr.matchedCompanyName}`,
            html: takeoverEmailHtml({
              greetingName: names.get(cr.requestingAdvisorId) ?? "there",
              intro: `Your request for ${cr.matchedCompanyName} was closed because the account changed owner while it was pending. Raise the request again if you still want it.`,
            }),
          },
        ],
        req.log,
      );
      throw conflict("The account changed owner while this request was pending — the request has been closed.", "owner_changed");
    }

    // Migration 0021 puts a partial unique index on (advisor_id, company_name_normalized)
    // WHERE source = 'referral'. If the requester already holds a referral row for this
    // company, the UPDATE below violates it — and a raw postgres-js error carries `code`
    // but no `statusCode`, so app.ts's passthrough misses it and the manager sees a bare
    // "Internal server error". Check up front, and belt-and-braces the 23505 anyway.
    if (opp.source === "referral") {
      const [dupe] = await db
        .select({ id: opportunities.id })
        .from(opportunities)
        .where(
          and(
            eq(opportunities.orgId, manager.orgId),
            eq(opportunities.advisorId, cr.requestingAdvisorId),
            eq(opportunities.companyNameNormalized, opp.companyNameNormalized),
            eq(opportunities.source, "referral"),
          ),
        )
        .limit(1);
      if (dupe) {
        throw conflict(
          `${cr.matchedCompanyName} can't be transferred: the requesting advisor already holds a referral account for this company. Merge the two accounts first.`,
          "duplicate_referral_account",
        );
      }
    }

    const names = await loadNames(manager.orgId, [cr.requestingAdvisorId, cr.currentOwnerId]);
    const requesterName = names.get(cr.requestingAdvisorId) ?? "another advisor";
    const ownerName = names.get(cr.currentOwnerId) ?? "the previous advisor";

    try {
      await db.transaction(async (tx) => {
        // Compare-and-swap FIRST: whoever flips pending→approved owns the transfer, so two
        // managers double-clicking can't both run the side effects (leads.ts uses the same
        // pattern). Zero rows means someone else got here first.
        const claimed = await tx
          .update(claimRequests)
          .set({ status: "approved", decidedBy: manager.id, decidedAt: now, decisionNote: decision_note ?? null })
          .where(and(eq(claimRequests.id, id), eq(claimRequests.status, "pending")))
          .returning({ id: claimRequests.id });
        if (claimed.length === 0) throw conflict("This request has already been decided", "already_decided");

        // THE MOVE. Ownership and notes only — see composeTakeoverNotes.
        await tx
          .update(opportunities)
          .set({
            advisorId: cr.requestingAdvisorId,
            notes: composeTakeoverNotes(opp.notes, cr.draft as OpportunityDraft, requesterName, now),
            updatedAt: now,
            lastActivityAt: now,
          })
          .where(and(eq(opportunities.id, opp.id), eq(opportunities.orgId, manager.orgId)));

        // Quotes must follow the account. loadQuoteForUser() ANDs the advisor filter with
        // the opportunity filter, so leaving these behind gives the new owner an empty
        // quote list and a 403 on any quote link the account already contains.
        await tx.update(quotes).set({ advisorId: cr.requestingAdvisorId }).where(eq(quotes.opportunityId, opp.id));

        // Durable per-account audit. `activities` is the right home for this (rather than
        // `communications`) because it is scoped to the opportunity and travels with it.
        await logActivity(
          {
            opportunityId: opp.id,
            advisorId: cr.requestingAdvisorId,
            type: "system",
            subject: `Account transferred from ${ownerName} to ${requesterName}`,
            body: decision_note ?? null,
            metadata: {
              fromAdvisorId: cr.currentOwnerId,
              toAdvisorId: cr.requestingAdvisorId,
              approvedBy: manager.id,
              claimRequestId: cr.id,
            },
          },
          tx,
        );
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw conflict(
          `${cr.matchedCompanyName} can't be transferred: the requesting advisor already holds a referral account for this company. Merge the two accounts first.`,
          "duplicate_referral_account",
        );
      }
      throw err;
    }

    // Alerts fire AFTER commit — never inside the transaction (see takeover-notify.ts).
    const noteLine = decision_note ? `Manager's note: ${decision_note}` : "";
    alerts.push(
      {
        orgId: manager.orgId,
        userId: cr.requestingAdvisorId,
        type: "claim_decision",
        relatedId: opp.id, // it's theirs now — link works
        message: `Your takeover request for ${opp.contractorCompanyName} was approved. It's now in your pipeline.`,
        subject: `Takeover approved — ${opp.contractorCompanyName}`,
        html: takeoverEmailHtml({
          greetingName: requesterName,
          intro: `${opp.contractorCompanyName} has been transferred to you.`,
          details: [
            "The existing account history, contact details and stage were kept as they were. Your captured details were added to the end of the account notes — review them and update the fields you want to change.",
            noteLine,
          ],
          ctaLabel: "Open the account",
          ctaPath: `/opportunities/${opp.id}`,
        }),
      },
      {
        orgId: manager.orgId,
        userId: cr.currentOwnerId,
        type: "account_reassigned",
        // They no longer own it — a deep-link would drop them into a 403.
        relatedId: null,
        message: `${opp.contractorCompanyName} has been reassigned to ${requesterName} by a manager.`,
        subject: `${opp.contractorCompanyName} has been reassigned`,
        html: takeoverEmailHtml({
          greetingName: ownerName,
          intro: `A manager has approved a takeover request for ${opp.contractorCompanyName}. The account is now assigned to ${requesterName} and has been removed from your pipeline.`,
          details: [
            noteLine,
            "Any commission you have already earned on this account is unaffected and stays with you.",
          ],
        }),
      },
    );
    await sendTakeoverAlerts(alerts, req.log);

    return { ok: true, status: "approved" };
  });
}

/** id → full name for the handful of users involved in one decision. */
async function loadNames(orgId: string, ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const rows = await db
    .select({ id: users.id, fullName: users.fullName })
    .from(users)
    .where(and(eq(users.orgId, orgId), inArray(users.id, unique)));
  return new Map(rows.map((r) => [r.id, r.fullName]));
}
