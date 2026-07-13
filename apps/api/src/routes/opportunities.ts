import type { FastifyInstance } from "fastify";
import { and, asc, desc, eq } from "drizzle-orm";
import { db, opportunities, users, claimRequests, statusStages, products, activities, opportunityProducts, journeyStages, opportunityJourney } from "@smart-crm/db";
import {
  opportunityDraftSchema,
  opportunityUpdateSchema,
  convertSchema,
  logActivitySchema,
  normalizeCompanyName,
  normalizeEmail,
  normalizePhoneE164,
  computeNextStep,
  isManagerial,
} from "@smart-crm/shared";
import { parse } from "../lib/validate.js";
import { authenticate } from "../auth/context.js";
import { requireUser } from "../auth/guards.js";
import { forbidden, notFound, conflict, badRequest } from "../lib/errors.js";
import { findMatches } from "../services/dedupe.js";
import { getStage, getInitialStageKey } from "../services/stages.js";
import { ensureConversion, removeConversion } from "../services/convert.js";
import { notify } from "../services/notify.js";
import { logActivity } from "../services/activity.js";
import { transcribeToDraft, isVoiceConfigured } from "../services/voice.js";
import { priceLines, summarizeProducts, replaceProductLines, getProductLines } from "../services/opportunity-products.js";
import { listCommunications } from "../services/communications.js";

function mapOpp(row: typeof opportunities.$inferSelect) {
  return {
    ...row,
    opportunityValue: row.opportunityValue == null ? null : Number(row.opportunityValue),
  };
}

async function notifyManagers(orgId: string, message: string, relatedId: string) {
  const managers = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.orgId, orgId), eq(users.active, true), eq(users.role, "super_admin")));
  await Promise.all(managers.map((m) => notify({ orgId, userId: m.id, type: "claim_request", message, relatedId })));
}

export async function registerOpportunityRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);

  // GET /api/opportunities/voice-status — is ChatGPT voice capture available? (drives the UI)
  app.get("/voice-status", async (req) => {
    requireUser(req);
    return { enabled: isVoiceConfigured() };
  });

  // POST /api/opportunities/transcribe — voice note → transcript + extracted draft (§6.2).
  // Returns the SAME shape the typed form fills; the advisor reviews before saving.
  app.post("/transcribe", async (req) => {
    const user = requireUser(req);
    const file = await req.file();
    if (!file) throw badRequest("No audio provided", "no_audio");
    const audio = await file.toBuffer();
    if (audio.byteLength === 0) throw badRequest("Empty recording", "empty_audio");

    const productRows = await db.select({ label: products.label }).from(products).where(and(eq(products.orgId, user.orgId), eq(products.active, true)));
    const result = await transcribeToDraft({
      audio,
      filename: file.filename || "note.webm",
      mimetype: file.mimetype || "audio/webm",
      products: productRows.map((p) => p.label),
    });
    return result;
  });

  // GET /api/opportunities — advisors see only their own (§11.2); managerial see all + filters.
  app.get("/", async (req) => {
    const user = requireUser(req);
    const q = req.query as { advisorId?: string; state?: string; status?: string };
    const conds = [eq(opportunities.orgId, user.orgId)];
    if (isManagerial(user.role)) {
      if (q.advisorId) conds.push(eq(opportunities.advisorId, q.advisorId));
    } else {
      // Advisor scope is enforced server-side — never trust a client advisorId.
      conds.push(eq(opportunities.advisorId, user.id));
    }
    if (q.state) conds.push(eq(opportunities.state, q.state.toUpperCase()));
    if (q.status) conds.push(eq(opportunities.status, q.status));

    const rows = await db
      .select()
      .from(opportunities)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(opportunities.updatedAt));
    return { opportunities: rows.map(mapOpp) };
  });

  // POST /api/opportunities — typed capture (§6.1) with territory dedupe (§5.1).
  app.post("/", async (req) => {
    const user = requireUser(req);
    const draft = parse(opportunityDraftSchema, req.body);

    const companyNorm = normalizeCompanyName(draft.contractor_company_name);
    const emailNorm = normalizeEmail(draft.contact_email);
    const cellE164 = normalizePhoneE164(draft.contact_cell);

    const { ownMatch, conflict: territoryConflict } = await findMatches({
      orgId: user.orgId,
      requestingAdvisorId: user.id,
      companyNameNormalized: companyNorm,
      contactEmailNormalized: emailNorm,
      contactCellE164: cellE164,
    });

    // Active account owned by another advisor → BLOCK + raise a takeover request (§5.1).
    if (territoryConflict) {
      const [cr] = await db
        .insert(claimRequests)
        .values({
          orgId: user.orgId,
          matchedOpportunityId: territoryConflict.id,
          matchedCompanyName: territoryConflict.contractorCompanyName,
          requestingAdvisorId: user.id,
          currentOwnerId: territoryConflict.advisorId,
          draft, // nothing is re-typed later
          status: "pending",
        })
        .returning({ id: claimRequests.id });

      await notifyManagers(
        user.orgId,
        `${user.fullName} is requesting to take over ${territoryConflict.contractorCompanyName}, currently held by ${territoryConflict.ownerName}.`,
        cr!.id,
      );
      await notify({
        orgId: user.orgId,
        userId: user.id,
        type: "claim_request",
        message: `${territoryConflict.contractorCompanyName} is already an active account (${territoryConflict.ownerName}'s). Your takeover request has been sent for review.`,
        relatedId: cr!.id,
      });

      throw conflict(
        `${territoryConflict.contractorCompanyName} is already an active account (${territoryConflict.ownerName}'s). Your takeover request has been sent to a manager for review.`,
        "territory_blocked",
      );
    }

    const initialStage = await getInitialStageKey(user.orgId);
    const stage = await getStage(user.orgId, initialStage);
    const now = new Date();
    const { nextStep, nextStepDue } = computeNextStep({
      stageKey: initialStage,
      isTerminal: stage?.isTerminal ?? false,
      statusChangedAt: now,
      followUpAt: draft.follow_up_at ?? null,
    });

    // Multi-product: price the lines (unit price × technicians) → auto deal value.
    const lines = draft.product_lines ?? [];
    const priced = lines.length ? await priceLines(lines) : null;
    const productLabel = lines.length ? summarizeProducts(lines) : (draft.product ?? null);
    const techTotal = lines.length ? lines.reduce((s, l) => s + (l.technicians ?? 1), 0) : (draft.num_technicians ?? null);
    const dealValue = draft.opportunity_value != null ? draft.opportunity_value : (priced?.total ?? null);

    const [created] = await db
      .insert(opportunities)
      .values({
        orgId: user.orgId,
        advisorId: user.id,
        contractorCompanyName: draft.contractor_company_name,
        companyNameNormalized: companyNorm,
        contactName: draft.contact_name ?? null,
        contactEmail: draft.contact_email ?? null,
        contactEmailNormalized: emailNorm,
        contactCell: draft.contact_cell ?? null,
        contactCellE164: cellE164,
        numTechnicians: techTotal,
        product: productLabel,
        opportunityValue: dealValue != null ? String(dealValue) : null,
        status: initialStage,
        statusChangedAt: now,
        state: draft.state,
        notes: draft.notes ?? null,
        followUpAt: draft.follow_up_at ?? null,
        nextReviewAt: draft.next_review_at ?? null,
        reviewNotes: draft.review_notes ?? null,
        nextStep,
        nextStepDue,
        customFields: draft.custom_fields,
        source: draft.source,
        lastActivityAt: now,
      })
      .returning();

    if (priced?.rows.length) {
      await db.insert(opportunityProducts).values(
        priced.rows.map((r) => ({
          opportunityId: created!.id,
          product: r.product,
          technicians: r.technicians,
          unitPrice: String(r.unitPrice),
          amount: String(r.amount),
          sortOrder: r.sortOrder,
        })),
      );
    }

    await logActivity({
      opportunityId: created!.id,
      advisorId: user.id,
      type: "system",
      subject: draft.source === "voice" ? "Opportunity created from a voice note" : "Opportunity created",
    });

    // Own existing account = warn only, no request (§5.1).
    return {
      opportunity: mapOpp(created!),
      warning: ownMatch
        ? `You already have an opportunity for ${ownMatch.contractorCompanyName} — make sure this isn't a duplicate.`
        : null,
    };
  });

  // GET /api/opportunities/:id — owner or managerial.
  app.get("/:id", async (req) => {
    const user = requireUser(req);
    const { id } = req.params as { id: string };
    const [row] = await db.select().from(opportunities).where(and(eq(opportunities.id, id), eq(opportunities.orgId, user.orgId))).limit(1);
    if (!row) throw notFound("Opportunity not found");
    if (!isManagerial(user.role) && row.advisorId !== user.id) throw forbidden();
    return { opportunity: mapOpp(row), productLines: await getProductLines(id) };
  });

  // GET /api/opportunities/:id/activities — the activity timeline (owner or managerial).
  app.get("/:id/activities", async (req) => {
    const user = requireUser(req);
    const { id } = req.params as { id: string };
    const [row] = await db.select({ advisorId: opportunities.advisorId }).from(opportunities).where(and(eq(opportunities.id, id), eq(opportunities.orgId, user.orgId))).limit(1);
    if (!row) throw notFound("Opportunity not found");
    if (!isManagerial(user.role) && row.advisorId !== user.id) throw forbidden();
    const rows = await db.select().from(activities).where(eq(activities.opportunityId, id)).orderBy(desc(activities.createdAt));
    return { activities: rows };
  });

  // GET /api/opportunities/:id/communications — dated log of quotes/emails sent for this deal.
  app.get("/:id/communications", async (req) => {
    const user = requireUser(req);
    const { id } = req.params as { id: string };
    const [row] = await db.select({ advisorId: opportunities.advisorId }).from(opportunities).where(and(eq(opportunities.id, id), eq(opportunities.orgId, user.orgId))).limit(1);
    if (!row) throw notFound("Opportunity not found");
    if (!isManagerial(user.role) && row.advisorId !== user.id) throw forbidden();
    return { communications: await listCommunications({ orgId: user.orgId, opportunityId: id }) };
  });

  // ── Journey stages (graphical stepper): the configurable touchpoint sequence ──
  async function loadJourney(orgId: string, opportunityId: string) {
    const stages = await db.select().from(journeyStages).where(and(eq(journeyStages.orgId, orgId), eq(journeyStages.active, true))).orderBy(asc(journeyStages.sortOrder));
    const done = await db.select().from(opportunityJourney).where(eq(opportunityJourney.opportunityId, opportunityId));
    const doneMap = new Map(done.map((d) => [d.stageId, d.completedAt]));
    return stages.map((s) => ({ stageId: s.id, label: s.label, sortOrder: s.sortOrder, completedAt: doneMap.get(s.id) ?? null }));
  }

  app.get("/:id/journey", async (req) => {
    const user = requireUser(req);
    const { id } = req.params as { id: string };
    const [row] = await db.select({ advisorId: opportunities.advisorId }).from(opportunities).where(and(eq(opportunities.id, id), eq(opportunities.orgId, user.orgId))).limit(1);
    if (!row) throw notFound("Opportunity not found");
    if (!isManagerial(user.role) && row.advisorId !== user.id) throw forbidden();
    return { journey: await loadJourney(user.orgId, id) };
  });

  // POST /api/opportunities/:id/journey/:stageId  { done: boolean } — mark a stage done/undone.
  app.post("/:id/journey/:stageId", async (req) => {
    const user = requireUser(req);
    const { id, stageId } = req.params as { id: string; stageId: string };
    const done = (req.body as { done?: boolean })?.done !== false;
    const [row] = await db.select({ advisorId: opportunities.advisorId }).from(opportunities).where(and(eq(opportunities.id, id), eq(opportunities.orgId, user.orgId))).limit(1);
    if (!row) throw notFound("Opportunity not found");
    if (!isManagerial(user.role) && row.advisorId !== user.id) throw forbidden();

    if (done) {
      const [existing] = await db
        .select({ id: opportunityJourney.id })
        .from(opportunityJourney)
        .where(and(eq(opportunityJourney.opportunityId, id), eq(opportunityJourney.stageId, stageId)))
        .limit(1);
      if (!existing) await db.insert(opportunityJourney).values({ opportunityId: id, stageId });
    } else {
      await db.delete(opportunityJourney).where(and(eq(opportunityJourney.opportunityId, id), eq(opportunityJourney.stageId, stageId)));
    }
    return { journey: await loadJourney(user.orgId, id) };
  });

  // POST /api/opportunities/:id/activities — log a call / text / email / note (auto-logging).
  app.post("/:id/activities", async (req) => {
    const user = requireUser(req);
    const { id } = req.params as { id: string };
    const input = parse(logActivitySchema, req.body);
    const [row] = await db.select().from(opportunities).where(and(eq(opportunities.id, id), eq(opportunities.orgId, user.orgId))).limit(1);
    if (!row) throw notFound("Opportunity not found");
    if (!isManagerial(user.role) && row.advisorId !== user.id) throw forbidden();

    const who = row.contactName ?? "contact";
    const defaultSubject: Record<string, string> = {
      call: `Called ${who}`,
      sms: `Texted ${who}`,
      email: `Emailed ${who}`,
      note: "Note",
    };
    await logActivity({
      opportunityId: id,
      advisorId: user.id,
      type: input.type,
      subject: input.subject || defaultSubject[input.type] || "Activity",
      body: input.body ?? null,
      outcome: input.outcome ?? null,
    });
    const [latest] = await db.select().from(activities).where(eq(activities.opportunityId, id)).orderBy(desc(activities.createdAt)).limit(1);
    return { activity: latest };
  });

  // PATCH /api/opportunities/:id — edit + status change (recomputes next step; converts on won).
  app.patch("/:id", async (req) => {
    const user = requireUser(req);
    const { id } = req.params as { id: string };
    const input = parse(opportunityUpdateSchema, req.body);

    const [row] = await db.select().from(opportunities).where(and(eq(opportunities.id, id), eq(opportunities.orgId, user.orgId))).limit(1);
    if (!row) throw notFound("Opportunity not found");
    if (!isManagerial(user.role) && row.advisorId !== user.id) throw forbidden();

    const now = new Date();
    const patch: Record<string, unknown> = { updatedAt: now, lastActivityAt: now };

    if (input.contractor_company_name !== undefined) {
      patch.contractorCompanyName = input.contractor_company_name;
      patch.companyNameNormalized = normalizeCompanyName(input.contractor_company_name);
    }
    if (input.contact_name !== undefined) patch.contactName = input.contact_name ?? null;
    if (input.contact_email !== undefined) {
      patch.contactEmail = input.contact_email ?? null;
      patch.contactEmailNormalized = normalizeEmail(input.contact_email);
    }
    if (input.contact_cell !== undefined) {
      patch.contactCell = input.contact_cell ?? null;
      patch.contactCellE164 = normalizePhoneE164(input.contact_cell);
    }
    if (input.num_technicians !== undefined) patch.numTechnicians = input.num_technicians ?? null;
    if (input.product !== undefined) patch.product = input.product;
    if (input.state !== undefined) patch.state = input.state;
    if (input.notes !== undefined) patch.notes = input.notes ?? null;
    if (input.follow_up_at !== undefined) patch.followUpAt = input.follow_up_at ?? null;
    if (input.next_review_at !== undefined) patch.nextReviewAt = input.next_review_at ?? null;
    if (input.review_notes !== undefined) patch.reviewNotes = input.review_notes ?? null;

    // Multi-product edit: re-price the lines and recompute the deal value (unless explicitly set).
    if (input.product_lines !== undefined) {
      const lines = input.product_lines ?? [];
      const total = await replaceProductLines(id, lines);
      patch.product = lines.length ? summarizeProducts(lines) : null;
      patch.numTechnicians = lines.length ? lines.reduce((s, l) => s + (l.technicians ?? 1), 0) : null;
      patch.opportunityValue = input.opportunity_value != null ? String(input.opportunity_value) : lines.length ? String(total) : null;
    } else if (input.opportunity_value !== undefined) {
      patch.opportunityValue = input.opportunity_value != null ? String(input.opportunity_value) : null;
    }

    let newStageKey = row.status;
    let stageChanged = false;
    if (input.status !== undefined && input.status !== row.status) {
      const stage = await getStage(user.orgId, input.status);
      if (!stage) throw conflict("Unknown status stage", "bad_status");
      newStageKey = input.status;
      stageChanged = true;
      patch.status = newStageKey;
      patch.statusChangedAt = now;
    }

    // Recompute next step from the (possibly new) stage + follow-up.
    const stageInfo = await getStage(user.orgId, newStageKey);
    const followUpForCalc =
      input.follow_up_at !== undefined ? (input.follow_up_at ?? null) : row.followUpAt;
    const { nextStep, nextStepDue } = computeNextStep({
      stageKey: newStageKey,
      isTerminal: stageInfo?.isTerminal ?? false,
      statusChangedAt: stageChanged ? now : row.statusChangedAt,
      followUpAt: followUpForCalc,
    });
    patch.nextStep = nextStep;
    patch.nextStepDue = nextStepDue;

    const [updated] = await db.update(opportunities).set(patch).where(and(eq(opportunities.id, id), eq(opportunities.orgId, user.orgId))).returning();

    // Conversion side-effects when crossing into / out of a conversion stage (§5.2, §10).
    if (stageChanged && stageInfo?.isConversion) {
      await ensureConversion(id);
    } else if (stageChanged && !stageInfo?.isConversion) {
      await removeConversion(id);
    }

    if (stageChanged) {
      await logActivity({
        opportunityId: id,
        advisorId: user.id,
        type: "status_change",
        subject: `Status changed to ${stageInfo?.label ?? newStageKey}`,
        metadata: { from: row.status, to: newStageKey },
      });
    }

    return { opportunity: mapOpp(updated!) };
  });

  // POST /api/opportunities/:id/convert — explicit conversion with a deal value (§10).
  app.post("/:id/convert", async (req) => {
    const user = requireUser(req);
    const { id } = req.params as { id: string };
    const { deal_value } = parse(convertSchema, req.body);

    const [row] = await db.select().from(opportunities).where(and(eq(opportunities.id, id), eq(opportunities.orgId, user.orgId))).limit(1);
    if (!row) throw notFound("Opportunity not found");
    if (!isManagerial(user.role) && row.advisorId !== user.id) throw forbidden();

    const [conversionRow] = await db
      .select({ key: statusStages.key })
      .from(statusStages)
      .where(and(eq(statusStages.orgId, user.orgId), eq(statusStages.isConversion, true), eq(statusStages.active, true)))
      .limit(1);
    const conversionStage = conversionRow?.key;
    if (!conversionStage) throw conflict("No conversion (won) stage configured", "no_conversion_stage");

    const now = new Date();
    await db
      .update(opportunities)
      .set({
        status: conversionStage,
        statusChangedAt: now,
        opportunityValue: String(deal_value),
        nextStep: null,
        nextStepDue: null,
        updatedAt: now,
        lastActivityAt: now,
      })
      .where(and(eq(opportunities.id, id), eq(opportunities.orgId, user.orgId)));

    await ensureConversion(id, deal_value);
    await logActivity({
      opportunityId: id,
      advisorId: user.id,
      type: "system",
      subject: `Marked won · deal value ${new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(deal_value)}`,
    });
    const [updated] = await db.select().from(opportunities).where(and(eq(opportunities.id, id), eq(opportunities.orgId, user.orgId))).limit(1);
    return { opportunity: mapOpp(updated!) };
  });
}
