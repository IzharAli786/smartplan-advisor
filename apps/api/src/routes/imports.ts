import type { FastifyInstance } from "fastify";
import { and, eq, inArray } from "drizzle-orm";
import { db, opportunities, users, products } from "@smart-crm/db";
import {
  importAnalyzeSchema,
  importCommitSchema,
  normalizeCompanyName,
  normalizeEmail,
  normalizePhoneE164,
  computeNextStep,
} from "@smart-crm/shared";
import { parse } from "../lib/validate.js";
import { authenticate } from "../auth/context.js";
import { requireManagerial } from "../auth/guards.js";
import { badRequest } from "../lib/errors.js";
import { findMatches } from "../services/dedupe.js";
import { getStage, getInitialStageKey } from "../services/stages.js";
import { logActivity } from "../services/activity.js";
import { mapColumns, IMPORT_FIELDS, type ImportField } from "../services/import-ai.js";

/** Coerce a spreadsheet cell to number, tolerating "$1,200", "12 techs", etc. */
function toNumber(v: unknown): number | undefined {
  if (v == null || v === "") return undefined;
  const n = Number(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : undefined;
}

export async function registerImportRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);

  // POST /api/imports/pipeline/analyze — AI maps the spreadsheet columns to our fields.
  app.post("/pipeline/analyze", async (req) => {
    const user = requireManagerial(req);
    const input = parse(importAnalyzeSchema, req.body);
    if (input.headers.length === 0) throw badRequest("The spreadsheet has no columns", "no_headers");

    const productRows = await db.select({ label: products.label }).from(products).where(and(eq(products.orgId, user.orgId), eq(products.active, true)));
    const { mapping, usedAi } = await mapColumns(input.headers, input.rows as Record<string, unknown>[], productRows.map((p) => p.label));

    // Apply the mapping to every row → normalized field objects.
    const mapped = (input.rows as Record<string, unknown>[]).map((row) => {
      const out: Record<string, unknown> = {};
      for (const field of IMPORT_FIELDS) {
        const header = mapping[field as ImportField];
        if (!header) continue;
        const raw = row[header];
        if (field === "num_technicians" || field === "opportunity_value") out[field] = toNumber(raw);
        else if (field === "state") out[field] = raw != null ? String(raw).trim().toUpperCase().slice(0, 2) : undefined;
        else out[field] = raw != null && raw !== "" ? String(raw).trim() : undefined;
      }
      return out;
    }).filter((r) => r.contractor_company_name); // must have a company to be an opportunity

    return { mapping, usedAi, rows: mapped };
  });

  // POST /api/imports/pipeline — dry_run=true flags duplicates/conflicts; else creates.
  app.post("/pipeline", async (req) => {
    const user = requireManagerial(req);
    const input = parse(importCommitSchema, req.body);

    // Only advisors in THIS org may be assigned.
    const advisorRows = await db.select({ id: users.id }).from(users).where(and(eq(users.orgId, user.orgId), eq(users.active, true)));
    const validAdvisors = new Set(advisorRows.map((r) => r.id));

    const now = new Date();
    const initialStage = await getInitialStageKey(user.orgId);
    const stage = await getStage(user.orgId, initialStage);

    const results: { index: number; status: "created" | "conflict" | "duplicate" | "skipped"; ownerName?: string | null }[] = [];
    let created = 0;

    for (let i = 0; i < input.rows.length; i++) {
      const row = input.rows[i]!;
      if (!validAdvisors.has(row.advisor_id)) {
        results.push({ index: i, status: "skipped" });
        continue;
      }
      const companyNorm = normalizeCompanyName(row.contractor_company_name);
      const emailNorm = normalizeEmail(row.contact_email);
      const cellE164 = normalizePhoneE164(row.contact_cell);
      const { ownMatch, conflict } = await findMatches({
        orgId: user.orgId,
        requestingAdvisorId: row.advisor_id,
        companyNameNormalized: companyNorm,
        contactEmailNormalized: emailNorm,
        contactCellE164: cellE164,
      });

      const flag = conflict ? "conflict" : ownMatch ? "duplicate" : null;
      const ownerName = conflict?.ownerName ?? ownMatch?.ownerName ?? null;

      if (input.dry_run) {
        results.push({ index: i, status: flag ?? "created", ownerName });
        continue;
      }

      // Live import: create the opportunity assigned to the chosen advisor.
      const { nextStep, nextStepDue } = computeNextStep({
        stageKey: initialStage,
        isTerminal: stage?.isTerminal ?? false,
        statusChangedAt: now,
        followUpAt: null,
      });
      const [createdRow] = await db
        .insert(opportunities)
        .values({
          orgId: user.orgId,
          advisorId: row.advisor_id,
          contractorCompanyName: row.contractor_company_name,
          companyNameNormalized: companyNorm,
          contactName: row.contact_name ?? null,
          contactEmail: row.contact_email ?? null,
          contactEmailNormalized: emailNorm,
          contactCell: row.contact_cell ?? null,
          contactCellE164: cellE164,
          numTechnicians: row.num_technicians ?? null,
          product: row.product ?? null,
          opportunityValue: row.opportunity_value != null ? String(row.opportunity_value) : null,
          status: initialStage,
          statusChangedAt: now,
          state: row.state ?? "",
          notes: row.notes ?? null,
          nextStep,
          nextStepDue,
          source: "typed",
          lastActivityAt: now,
        })
        .returning({ id: opportunities.id });
      await logActivity({
        opportunityId: createdRow!.id,
        advisorId: row.advisor_id,
        type: "system",
        subject: flag === "conflict" ? "Imported from spreadsheet (flagged — also held by another advisor)" : "Imported from spreadsheet",
      });
      created++;
      results.push({ index: i, status: flag ?? "created", ownerName });
    }

    return input.dry_run ? { previews: results } : { created, results };
  });
}
