import type { FastifyInstance } from "fastify";
import { and, desc, eq, ilike, or } from "drizzle-orm";
import { db, leads, leadNotes, opportunities, users } from "@smart-crm/db";
import {
  importAnalyzeSchema,
  leadImportCommitSchema,
  leadCreateSchema,
  leadUpdateSchema,
  leadNoteSchema,
  leadConvertSchema,
  mapApolloColumns,
  APOLLO_LEAD_FIELDS,
  normalizeCompanyName,
  normalizeCompanyKey,
  normalizeEmail,
  normalizePhoneE164,
  computeNextStep,
  usStateCode,
  type ApolloField,
} from "@smart-crm/shared";
import { parse } from "../lib/validate.js";
import { authenticate } from "../auth/context.js";
import { requireManagerial, requireUser } from "../auth/guards.js";
import { badRequest, notFound, forbidden, conflict } from "../lib/errors.js";
import { isLeadScanConfigured, scanImageToLeadDraft, SCAN_IMAGE_TYPES } from "../services/lead-scan.js";
import { findMatches } from "../services/dedupe.js";
import { getStage, getInitialStageKey } from "../services/stages.js";
import { logActivity } from "../services/activity.js";

/** Coerce a spreadsheet cell to an integer, tolerating "1,200 employees", "5000", etc. */
function toInt(v: unknown): number | undefined {
  if (v == null || v === "") return undefined;
  const n = Number(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? Math.round(n) : undefined;
}
function str(v: unknown): string | undefined {
  if (v == null || v === "") return undefined;
  // Apollo/Excel guards text cells (esp. phones) with a leading apostrophe: '+1 888…
  const s = String(v).trim().replace(/^'+/, "").trim();
  return s === "" ? undefined : s;
}
/** Best contact number for a lead: corporate/direct phone first, else the company line. */
function bestPhone(row: { corporate_phone?: string; company_phone?: string }): string | undefined {
  return row.corporate_phone || row.company_phone || undefined;
}

type LeadPreview = { index: number; status: "created" | "duplicate" | "in_pipeline"; detail?: string | null };

export async function registerLeadRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);

  // POST /api/leads/import/analyze — map Apollo columns → our fields, return a preview.
  app.post("/import/analyze", async (req) => {
    requireManagerial(req);
    const input = parse(importAnalyzeSchema, req.body);
    if (input.headers.length === 0) throw badRequest("The file has no columns", "no_headers");

    const mapping = mapApolloColumns(input.headers);
    const rows = (input.rows as Record<string, unknown>[])
      .map((row) => {
        const out: Record<string, unknown> = {};
        for (const { key } of APOLLO_LEAD_FIELDS) {
          const header = mapping[key as ApolloField];
          if (!header) continue;
          const raw = row[header];
          if (key === "num_employees") out[key] = toInt(raw);
          else if (key === "company_state") {
            const cleaned = str(raw);
            out[key] = usStateCode(cleaned) ?? cleaned; // "California" → "CA", keep foreign values as-is
          } else out[key] = str(raw);
        }
        return out;
      })
      .filter((r) => r.company_name); // a lead must at least have a company

    const matchedHeaders = new Set(Object.values(mapping));
    const unmatched = input.headers.filter((h) => !matchedHeaders.has(h));
    return { mapping, rows, unmatched, total: rows.length };
  });

  // POST /api/leads/import — dry_run=true flags duplicates; else creates leads for one advisor.
  app.post("/import", async (req) => {
    const user = requireManagerial(req);
    const input = parse(leadImportCommitSchema, req.body);

    // The selected advisor must belong to this org and be active.
    const [advisor] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, input.advisor_id), eq(users.orgId, user.orgId), eq(users.active, true)))
      .limit(1);
    if (!advisor) throw badRequest("Choose an active Smart Advisor for this import", "bad_advisor");

    // A "duplicate" is simply the SAME COMPANY — one lead per contractor, regardless of
    // which contact person the row carries (per admin workflow: the advisor works the
    // company, not each Apollo contact). Keyed on normalizeCompanyKey (case/punctuation
    // insensitive, keeps every token) so "Acme, Inc." = "Acme Inc" but
    // "Acme HVAC" ≠ "Acme Plumbing" — the same lesson as migration 0024.
    const existing = await db
      .select({ company: leads.companyName })
      .from(leads)
      .where(eq(leads.orgId, user.orgId));
    const seenCompanies = new Set(existing.map((e) => normalizeCompanyKey(e.company)));

    const now = new Date();
    const results: LeadPreview[] = [];
    let created = 0;

    for (let i = 0; i < input.rows.length; i++) {
      const row = input.rows[i]!;
      const companyNorm = normalizeCompanyName(row.company_name);
      const emailNorm = normalizeEmail(row.email ?? null);
      const phoneE164 = normalizePhoneE164(bestPhone(row) ?? null);
      const companyKey = normalizeCompanyKey(row.company_name);

      // Company already a lead? (skip). Otherwise note if it's already worked in the pipeline.
      const dupCompany = seenCompanies.has(companyKey);
      let inPipelineOwner: string | null = null;
      if (!dupCompany) {
        const { ownMatch, conflict } = await findMatches({
          orgId: user.orgId,
          requestingAdvisorId: input.advisor_id,
          companyKey,
          contactEmailNormalized: emailNorm,
          contactCellE164: phoneE164,
        });
        inPipelineOwner = conflict?.ownerName ?? ownMatch?.ownerName ?? null;
      }

      const status: LeadPreview["status"] = dupCompany ? "duplicate" : inPipelineOwner ? "in_pipeline" : "created";

      // Track within this batch too, so a file with several contacts at one company
      // previews the way the live run will import: first row wins, the rest duplicate.
      seenCompanies.add(companyKey);

      if (input.dry_run) {
        results.push({ index: i, status, detail: inPipelineOwner });
        continue;
      }
      // Live run: only skip same-company duplicates. An "in_pipeline" company is a deliberate
      // admin assignment over an existing opportunity, so we import it (flagged in the preview).
      if (dupCompany) {
        results.push({ index: i, status, detail: inPipelineOwner });
        continue;
      }

      await db.insert(leads).values({
        orgId: user.orgId,
        assignedAdvisorId: input.advisor_id,
        status: "new",
        firstName: row.first_name ?? null,
        lastName: row.last_name ?? null,
        title: row.title ?? null,
        email: row.email ?? null,
        emailNormalized: emailNorm,
        department: row.department ?? null,
        linkedinUrl: row.linkedin_url ?? null,
        companyName: row.company_name,
        companyNameNormalized: companyNorm,
        website: row.website ?? null,
        companyAddress: row.company_address ?? null,
        companyCity: row.company_city ?? null,
        companyState: usStateCode(row.company_state) ?? row.company_state ?? null,
        corporatePhone: row.corporate_phone ?? null,
        companyPhone: row.company_phone ?? null,
        phoneE164,
        numEmployees: row.num_employees ?? null,
        keywords: row.keywords ?? null,
        technologies: row.technologies ?? null,
        annualRevenue: row.annual_revenue ?? null,
        subsidiaryOf: row.subsidiary_of ?? null,
        source: "apollo",
        createdBy: user.id,
        createdAt: now,
        updatedAt: now,
      });
      created++;
      results.push({ index: i, status, detail: inPipelineOwner });
    }

    return input.dry_run ? { previews: results } : { created, results };
  });

  // GET /api/leads/scan-status — can the web app offer AI photo scan?
  app.get("/scan-status", async (req) => {
    requireUser(req);
    return { enabled: isLeadScanConfigured() };
  });

  // POST /api/leads/scan — multipart image → AI-extracted lead draft. The image is
  // held in memory for the OpenAI call only and never persisted.
  app.post("/scan", async (req) => {
    requireUser(req);
    const file = await req.file();
    if (!file) throw badRequest("No image provided", "no_file");
    if (!SCAN_IMAGE_TYPES.has(file.mimetype)) {
      throw badRequest(
        "Use a PNG, JPG, WEBP or GIF. iPhone HEIC photos aren't supported — take a screenshot of the photo instead.",
        "bad_type",
      );
    }
    const image = await file.toBuffer();
    if (image.byteLength === 0) throw badRequest("That image is empty", "empty_file");
    if (image.byteLength > 10 * 1024 * 1024) throw badRequest("Image must be under 10MB", "too_large");
    return scanImageToLeadDraft({ image, mimetype: file.mimetype });
  });

  // POST /api/leads — add a single lead (typed or AI photo scan). Advisors create for
  // themselves; a super admin may assign to any active advisor. Same-company duplicates
  // are rejected — the import wizard's rule, surfaced as a 409 instead of a silent skip.
  app.post("/", async (req, reply) => {
    const user = requireUser(req);
    const managerial = user.role === "super_admin";
    const input = parse(leadCreateSchema, req.body);

    let advisorId = user.id;
    if (input.advisor_id && input.advisor_id !== user.id) {
      if (!managerial) throw forbidden("Only a manager can assign a lead to someone else");
      const [ok] = await db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.id, input.advisor_id), eq(users.orgId, user.orgId), eq(users.active, true)))
        .limit(1);
      if (!ok) throw badRequest("That advisor isn't in your organization", "bad_advisor");
      advisorId = input.advisor_id;
    }

    const companyKey = normalizeCompanyKey(input.company_name);
    const existing = await db
      .select({ company: leads.companyName, advisorName: users.fullName })
      .from(leads)
      .leftJoin(users, eq(users.id, leads.assignedAdvisorId))
      .where(eq(leads.orgId, user.orgId));
    const dup = existing.find((e) => normalizeCompanyKey(e.company) === companyKey);
    if (dup) {
      throw conflict(
        `"${dup.company}" is already a lead${dup.advisorName ? ` (assigned to ${dup.advisorName})` : ""}.`,
        "duplicate_company",
      );
    }

    const now = new Date();
    const [created] = await db
      .insert(leads)
      .values({
        orgId: user.orgId,
        assignedAdvisorId: advisorId,
        status: "new",
        firstName: input.first_name ?? null,
        lastName: input.last_name ?? null,
        title: input.title ?? null,
        email: input.email ?? null,
        emailNormalized: normalizeEmail(input.email ?? null),
        department: input.department ?? null,
        linkedinUrl: input.linkedin_url ?? null,
        companyName: input.company_name,
        companyNameNormalized: normalizeCompanyName(input.company_name),
        website: input.website ?? null,
        companyAddress: input.company_address ?? null,
        companyCity: input.company_city ?? null,
        companyState: input.company_state == null ? null : (usStateCode(input.company_state) ?? input.company_state),
        corporatePhone: input.corporate_phone ?? null,
        companyPhone: input.company_phone ?? null,
        phoneE164: normalizePhoneE164(input.corporate_phone || input.company_phone || null),
        numEmployees: typeof input.num_employees === "number" ? input.num_employees : null,
        keywords: input.keywords ?? null,
        technologies: input.technologies ?? null,
        annualRevenue: input.annual_revenue ?? null,
        subsidiaryOf: input.subsidiary_of ?? null,
        notes: input.notes ?? null,
        source: input.source,
        createdBy: user.id,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    reply.code(201);
    return { lead: created };
  });

  // GET /api/leads?advisorId=&status=&q= — managerial sees all; advisors see their own.
  app.get("/", async (req) => {
    const user = requireUser(req);
    const managerial = user.role === "super_admin";
    const query = req.query as { advisorId?: string; status?: string; q?: string };

    const conds = [eq(leads.orgId, user.orgId)];
    if (!managerial) conds.push(eq(leads.assignedAdvisorId, user.id));
    else if (query.advisorId) conds.push(eq(leads.assignedAdvisorId, query.advisorId));
    if (query.status) conds.push(eq(leads.status, query.status as "new" | "claimed" | "converted" | "dismissed"));
    if (query.q && query.q.trim()) {
      const like = `%${query.q.trim()}%`;
      conds.push(
        or(
          ilike(leads.companyName, like),
          ilike(leads.firstName, like),
          ilike(leads.lastName, like),
          ilike(leads.email, like),
          ilike(leads.title, like),
          ilike(leads.companyState, like),
        )!,
      );
    }

    const rows = await db
      .select({
        lead: leads,
        advisorName: users.fullName,
      })
      .from(leads)
      .leftJoin(users, eq(users.id, leads.assignedAdvisorId))
      .where(and(...conds))
      .orderBy(desc(leads.createdAt))
      .limit(2000);

    return { leads: rows.map((r) => ({ ...r.lead, advisorName: r.advisorName })) };
  });

  /** The lead, if the caller may work with it: org-scoped; advisors only their own. */
  async function requireLeadAccess(user: { id: string; orgId: string; role: string }, leadId: string) {
    const [lead] = await db.select().from(leads).where(and(eq(leads.id, leadId), eq(leads.orgId, user.orgId))).limit(1);
    if (!lead) throw notFound("Lead not found");
    if (user.role !== "super_admin" && lead.assignedAdvisorId !== user.id) throw forbidden();
    return lead;
  }

  // GET /api/leads/:id/notes — Advisor Notes, newest first (leads.notes carries the Apollo info).
  app.get("/:id/notes", async (req) => {
    const user = requireUser(req);
    const { id } = req.params as { id: string };
    await requireLeadAccess(user, id);
    const rows = await db
      .select({
        id: leadNotes.id,
        body: leadNotes.body,
        authorId: leadNotes.authorId,
        authorName: users.fullName,
        createdAt: leadNotes.createdAt,
        updatedAt: leadNotes.updatedAt,
      })
      .from(leadNotes)
      .leftJoin(users, eq(users.id, leadNotes.authorId))
      .where(eq(leadNotes.leadId, id))
      .orderBy(desc(leadNotes.createdAt));
    return { notes: rows };
  });

  // POST /api/leads/:id/notes — add an Advisor Note.
  app.post("/:id/notes", async (req, reply) => {
    const user = requireUser(req);
    const { id } = req.params as { id: string };
    const input = parse(leadNoteSchema, req.body);
    await requireLeadAccess(user, id);
    const [created] = await db
      .insert(leadNotes)
      .values({ orgId: user.orgId, leadId: id, authorId: user.id, body: input.body })
      .returning();
    reply.code(201);
    return {
      note: {
        id: created!.id,
        body: created!.body,
        authorId: created!.authorId,
        authorName: user.fullName,
        createdAt: created!.createdAt,
        updatedAt: created!.updatedAt,
      },
    };
  });

  // PATCH /api/leads/:id/notes/:noteId — edit a note. Its author or a super admin.
  app.patch("/:id/notes/:noteId", async (req) => {
    const user = requireUser(req);
    const { id, noteId } = req.params as { id: string; noteId: string };
    const input = parse(leadNoteSchema, req.body);
    await requireLeadAccess(user, id);
    const [note] = await db
      .select()
      .from(leadNotes)
      .where(and(eq(leadNotes.id, noteId), eq(leadNotes.leadId, id), eq(leadNotes.orgId, user.orgId)))
      .limit(1);
    if (!note) throw notFound("Note not found");
    if (user.role !== "super_admin" && note.authorId !== user.id) {
      throw forbidden("You can only edit notes you wrote");
    }
    const [updated] = await db
      .update(leadNotes)
      .set({ body: input.body, updatedAt: new Date() })
      .where(eq(leadNotes.id, noteId))
      .returning();
    return {
      note: {
        id: updated!.id,
        body: updated!.body,
        authorId: updated!.authorId,
        authorName: null, // caller keeps the name it already has
        createdAt: updated!.createdAt,
        updatedAt: updated!.updatedAt,
      },
    };
  });

  // PATCH /api/leads/:id — status / notes / detail edits; managers may also reassign.
  app.patch("/:id", async (req) => {
    const user = requireUser(req);
    const managerial = user.role === "super_admin";
    const { id } = req.params as { id: string };
    const input = parse(leadUpdateSchema, req.body);

    const [lead] = await db.select().from(leads).where(and(eq(leads.id, id), eq(leads.orgId, user.orgId))).limit(1);
    if (!lead) throw notFound("Lead not found");
    if (!managerial && lead.assignedAdvisorId !== user.id) throw forbidden();

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (input.status !== undefined) patch.status = input.status;
    if (input.notes !== undefined) patch.notes = input.notes ?? null;
    if (input.company_name !== undefined) {
      patch.companyName = input.company_name;
      patch.companyNameNormalized = normalizeCompanyName(input.company_name);
    }
    if (input.first_name !== undefined) patch.firstName = input.first_name;
    if (input.last_name !== undefined) patch.lastName = input.last_name;
    if (input.title !== undefined) patch.title = input.title;
    if (input.email !== undefined) {
      patch.email = input.email;
      patch.emailNormalized = normalizeEmail(input.email);
    }
    if (input.department !== undefined) patch.department = input.department;
    if (input.linkedin_url !== undefined) patch.linkedinUrl = input.linkedin_url;
    if (input.website !== undefined) patch.website = input.website;
    if (input.company_address !== undefined) patch.companyAddress = input.company_address;
    if (input.company_city !== undefined) patch.companyCity = input.company_city;
    if (input.company_state !== undefined)
      patch.companyState = input.company_state == null ? null : (usStateCode(input.company_state) ?? input.company_state);
    if (input.corporate_phone !== undefined) patch.corporatePhone = input.corporate_phone;
    if (input.company_phone !== undefined) patch.companyPhone = input.company_phone;
    if (input.corporate_phone !== undefined || input.company_phone !== undefined) {
      // phone_e164 is derived from the best available number — recompute against the merged state.
      const corporate = input.corporate_phone !== undefined ? input.corporate_phone : lead.corporatePhone;
      const company = input.company_phone !== undefined ? input.company_phone : lead.companyPhone;
      patch.phoneE164 = normalizePhoneE164(corporate || company || null);
    }
    if (input.num_employees !== undefined) patch.numEmployees = input.num_employees;
    if (input.annual_revenue !== undefined) patch.annualRevenue = input.annual_revenue;
    if (input.subsidiary_of !== undefined) patch.subsidiaryOf = input.subsidiary_of;
    if (input.keywords !== undefined) patch.keywords = input.keywords;
    if (input.technologies !== undefined) patch.technologies = input.technologies;
    if (input.assigned_advisor_id !== undefined) {
      if (!managerial) throw forbidden("Only a manager can reassign a lead");
      const [ok] = await db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.id, input.assigned_advisor_id), eq(users.orgId, user.orgId), eq(users.active, true)))
        .limit(1);
      if (!ok) throw badRequest("That advisor isn't in your organization", "bad_advisor");
      patch.assignedAdvisorId = input.assigned_advisor_id;
    }

    const [updated] = await db.update(leads).set(patch).where(eq(leads.id, id)).returning();
    return { lead: updated };
  });

  // DELETE /api/leads/:id — managerial.
  app.delete("/:id", async (req) => {
    const user = requireManagerial(req);
    const { id } = req.params as { id: string };
    const res = await db.delete(leads).where(and(eq(leads.id, id), eq(leads.orgId, user.orgId))).returning({ id: leads.id });
    if (res.length === 0) throw notFound("Lead not found");
    return { ok: true };
  });

  // POST /api/leads/:id/convert — turn a lead into a pipeline opportunity for its advisor.
  app.post("/:id/convert", async (req) => {
    const user = requireUser(req);
    const managerial = user.role === "super_admin";
    const { id } = req.params as { id: string };
    const input = parse(leadConvertSchema, req.body);

    const [lead] = await db.select().from(leads).where(and(eq(leads.id, id), eq(leads.orgId, user.orgId))).limit(1);
    if (!lead) throw notFound("Lead not found");
    if (!managerial && lead.assignedAdvisorId !== user.id) throw forbidden();
    if (lead.convertedOpportunityId) throw badRequest("This lead has already been converted", "already_converted");

    const now = new Date();
    const initialStage = await getInitialStageKey(user.orgId);
    const stage = await getStage(user.orgId, initialStage);
    const { nextStep, nextStepDue } = computeNextStep({
      stageKey: initialStage,
      isTerminal: stage?.isTerminal ?? false,
      statusChangedAt: now,
      followUpAt: null,
    });

    const contactName = [lead.firstName, lead.lastName].filter(Boolean).join(" ") || null;
    const contactCell = lead.corporatePhone || lead.companyPhone || null;
    const state = usStateCode(lead.companyState) ?? "";

    // The lead becomes a pipeline opportunity and STOPS being a lead: its row is
    // removed in the same transaction, so the Leads page never lists it again.
    const opportunityId = await db.transaction(async (tx) => {
      const [opp] = await tx
        .insert(opportunities)
        .values({
          orgId: user.orgId,
          advisorId: lead.assignedAdvisorId,
          contractorCompanyName: lead.companyName,
          companyNameNormalized: lead.companyNameNormalized,
          companyKey: normalizeCompanyKey(lead.companyName),
          contactName,
          contactEmail: lead.email ?? null,
          contactEmailNormalized: lead.emailNormalized,
          contactCell,
          contactCellE164: lead.phoneE164,
          numTechnicians: input.num_technicians ?? null,
          product: input.product ?? null,
          opportunityValue: input.opportunity_value != null ? String(input.opportunity_value) : null,
          status: initialStage,
          statusChangedAt: now,
          state,
          address: lead.companyAddress ?? null,
          website: lead.website ?? null,
          notes: lead.keywords ? `From Apollo lead. ${lead.keywords}` : "From Apollo lead.",
          nextStep,
          nextStepDue,
          source: "lead",
          lastActivityAt: now,
        })
        .returning({ id: opportunities.id });

      await tx.delete(leads).where(eq(leads.id, id));
      await logActivity(
        {
          opportunityId: opp!.id,
          advisorId: lead.assignedAdvisorId,
          type: "system",
          subject: "Converted from Apollo lead",
        },
        tx,
      );
      return opp!.id;
    });

    return { opportunityId };
  });
}
