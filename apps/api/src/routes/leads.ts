import type { FastifyInstance } from "fastify";
import { and, desc, eq, ilike, or } from "drizzle-orm";
import { db, leads, opportunities, users } from "@smart-crm/db";
import {
  importAnalyzeSchema,
  leadImportCommitSchema,
  leadUpdateSchema,
  leadConvertSchema,
  mapApolloColumns,
  APOLLO_LEAD_FIELDS,
  normalizeCompanyName,
  normalizeEmail,
  normalizePhoneE164,
  computeNextStep,
  usStateCode,
  type ApolloField,
} from "@smart-crm/shared";
import { parse } from "../lib/validate.js";
import { authenticate } from "../auth/context.js";
import { requireManagerial, requireUser } from "../auth/guards.js";
import { badRequest, notFound, forbidden } from "../lib/errors.js";
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

    // Pre-load existing lead fingerprints. Apollo rows are PEOPLE, so a "duplicate" is the
    // same person (by email, or company+name when email is missing) — NOT merely the same
    // company, since several distinct contacts can share one contractor.
    const existing = await db
      .select({ company: leads.companyNameNormalized, email: leads.emailNormalized, first: leads.firstName, last: leads.lastName })
      .from(leads)
      .where(eq(leads.orgId, user.orgId));
    const personKey = (companyNorm: string, emailNorm: string | null, first?: string | null, last?: string | null) =>
      emailNorm ? `e:${emailNorm}` : `c:${companyNorm}|${(first ?? "").toLowerCase().trim()}|${(last ?? "").toLowerCase().trim()}`;
    const seenPeople = new Set(existing.map((e) => personKey(e.company, e.email, e.first, e.last)));

    const now = new Date();
    const results: LeadPreview[] = [];
    let created = 0;

    for (let i = 0; i < input.rows.length; i++) {
      const row = input.rows[i]!;
      const companyNorm = normalizeCompanyName(row.company_name);
      const emailNorm = normalizeEmail(row.email ?? null);
      const phoneE164 = normalizePhoneE164(bestPhone(row) ?? null);
      const key = personKey(companyNorm, emailNorm, row.first_name, row.last_name);

      // Same person already imported? (skip). Otherwise note if the company is already worked.
      const dupPerson = seenPeople.has(key);
      let inPipelineOwner: string | null = null;
      if (!dupPerson) {
        const { ownMatch, conflict } = await findMatches({
          orgId: user.orgId,
          requestingAdvisorId: input.advisor_id,
          companyNameNormalized: companyNorm,
          contactEmailNormalized: emailNorm,
          contactCellE164: phoneE164,
        });
        inPipelineOwner = conflict?.ownerName ?? ownMatch?.ownerName ?? null;
      }

      const status: LeadPreview["status"] = dupPerson ? "duplicate" : inPipelineOwner ? "in_pipeline" : "created";

      if (input.dry_run) {
        results.push({ index: i, status, detail: inPipelineOwner });
        continue;
      }
      // Live run: only skip exact-person duplicates. An "in_pipeline" company is still a
      // distinct contact the admin chose to assign, so we import it (flagged in the preview).
      if (dupPerson) {
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
      // Track within this batch so a repeated person in the same file also dedupes.
      seenPeople.add(key);
      created++;
      results.push({ index: i, status, detail: inPipelineOwner });
    }

    return input.dry_run ? { previews: results } : { created, results };
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

  // PATCH /api/leads/:id — status / notes; managers may also reassign.
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

    const [opp] = await db
      .insert(opportunities)
      .values({
        orgId: user.orgId,
        advisorId: lead.assignedAdvisorId,
        contractorCompanyName: lead.companyName,
        companyNameNormalized: lead.companyNameNormalized,
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

    await db.update(leads).set({ status: "converted", convertedOpportunityId: opp!.id, updatedAt: now }).where(eq(leads.id, id));
    await logActivity({
      opportunityId: opp!.id,
      advisorId: lead.assignedAdvisorId,
      type: "system",
      subject: "Converted from Apollo lead",
    });

    return { opportunityId: opp!.id };
  });
}
