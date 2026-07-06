import type { FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";
import { and, desc, eq, sql as dsql } from "drizzle-orm";
import { db, quotes, quoteLineItems, opportunities, users } from "@smart-crm/db";
import { quoteInputSchema, quoteUpdateSchema, isManagerial } from "@smart-crm/shared";
import { parse } from "../lib/validate.js";
import { authenticate } from "../auth/context.js";
import { requireUser } from "../auth/guards.js";
import { forbidden, notFound, badRequest } from "../lib/errors.js";
import { computeTotals, effectiveStatus, type LineInput } from "../services/quotes.js";

/** Normalize parsed line items (zod defaults can be optional in the inferred type). */
function toLineInputs(items: { product?: string; description?: string; quantity?: number; unit_price?: number }[]): LineInput[] {
  return items.map((l) => ({
    product: l.product ?? null,
    description: l.description ?? null,
    quantity: Number(l.quantity ?? 1),
    unitPrice: Number(l.unit_price ?? 0),
  }));
}
import { mailer } from "../lib/mailer.js";
import { logActivity } from "../services/activity.js";
import { recordCommunication } from "../services/communications.js";
import { env } from "../env.js";

function mapQuote(q: typeof quotes.$inferSelect) {
  return {
    id: q.id,
    opportunityId: q.opportunityId,
    advisorId: q.advisorId,
    quoteNumber: q.quoteNumber,
    title: q.title,
    contactName: q.contactName,
    contactEmail: q.contactEmail,
    status: q.status,
    effectiveStatus: effectiveStatus(q.status, q.validUntil),
    currency: q.currency,
    subtotal: Number(q.subtotal),
    discount: Number(q.discount),
    taxRate: Number(q.taxRate),
    taxAmount: Number(q.taxAmount),
    total: Number(q.total),
    notes: q.notes,
    validUntil: q.validUntil,
    publicToken: q.publicToken,
    sentAt: q.sentAt,
    viewedAt: q.viewedAt,
    signedAt: q.signedAt,
    declinedAt: q.declinedAt,
    signerName: q.signerName,
    createdAt: q.createdAt,
    updatedAt: q.updatedAt,
  };
}

function mapItems(rows: (typeof quoteLineItems.$inferSelect)[]) {
  return rows
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((r) => ({
      id: r.id,
      product: r.product,
      description: r.description,
      quantity: Number(r.quantity),
      unitPrice: Number(r.unitPrice),
      amount: Number(r.amount),
    }));
}

async function loadQuoteForUser(id: string, userId: string, orgId: string, managerial: boolean) {
  const [q] = await db.select().from(quotes).where(and(eq(quotes.id, id), eq(quotes.orgId, orgId))).limit(1);
  if (!q) throw notFound("Quote not found");
  if (!managerial && q.advisorId !== userId) throw forbidden();
  return q;
}

export async function registerQuoteRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);

  // GET /api/quotes?opportunityId=&status= — advisors see own; managerial see all.
  app.get("/", async (req) => {
    const user = requireUser(req);
    const q = req.query as { opportunityId?: string; status?: string };
    const conds = [eq(quotes.orgId, user.orgId)];
    if (!isManagerial(user.role)) conds.push(eq(quotes.advisorId, user.id));
    if (q.opportunityId) conds.push(eq(quotes.opportunityId, q.opportunityId));
    const rows = await db
      .select()
      .from(quotes)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(quotes.createdAt));
    return { quotes: rows.map(mapQuote) };
  });

  // POST /api/quotes — create a draft quote with line items.
  app.post("/", async (req) => {
    const user = requireUser(req);
    const input = parse(quoteInputSchema, req.body);

    const [opp] = await db.select().from(opportunities).where(and(eq(opportunities.id, input.opportunity_id), eq(opportunities.orgId, user.orgId))).limit(1);
    if (!opp) throw notFound("Opportunity not found");
    if (!isManagerial(user.role) && opp.advisorId !== user.id) throw forbidden();

    const discount = input.discount ?? 0;
    const taxRate = input.tax_rate ?? 0;
    const { lines, subtotal, taxAmount, total } = computeTotals(toLineInputs(input.line_items), discount, taxRate);

    const seq = await db.execute<{ n: string }>(dsql`SELECT nextval('quote_number_seq') AS n`);
    const quoteNumber = `Q-${String(seq[0]?.n ?? "0").padStart(4, "0")}`;

    const created = await db.transaction(async (tx) => {
      const [qrow] = await tx
        .insert(quotes)
        .values({
          orgId: user.orgId,
          opportunityId: opp.id,
          advisorId: opp.advisorId,
          quoteNumber,
          title: input.title,
          contactName: input.contact_name ?? opp.contactName ?? null,
          contactEmail: input.contact_email ?? opp.contactEmail ?? null,
          notes: input.notes ?? null,
          validUntil: input.valid_until ? input.valid_until.toISOString().slice(0, 10) : null,
          discount: String(discount),
          taxRate: String(taxRate),
          subtotal: String(subtotal),
          taxAmount: String(taxAmount),
          total: String(total),
          status: "draft",
        })
        .returning();
      await tx.insert(quoteLineItems).values(
        lines.map((l) => ({
          quoteId: qrow!.id,
          product: l.product,
          description: l.description,
          quantity: String(l.quantity),
          unitPrice: String(l.unitPrice),
          amount: String(l.amount),
          sortOrder: l.sortOrder,
        })),
      );
      return qrow!;
    });

    return { quote: mapQuote(created) };
  });

  // GET /api/quotes/:id — detail (quote + line items + context).
  app.get("/:id", async (req) => {
    const user = requireUser(req);
    const { id } = req.params as { id: string };
    const q = await loadQuoteForUser(id, user.id, user.orgId, isManagerial(user.role));
    const items = await db.select().from(quoteLineItems).where(eq(quoteLineItems.quoteId, id));
    const [opp] = await db
      .select({ company: opportunities.contractorCompanyName, state: opportunities.state })
      .from(opportunities)
      .where(eq(opportunities.id, q.opportunityId))
      .limit(1);
    const [adv] = await db.select({ name: users.fullName, email: users.email, phone: users.phone }).from(users).where(eq(users.id, q.advisorId)).limit(1);
    return {
      quote: mapQuote(q),
      lineItems: mapItems(items),
      company: opp?.company ?? "",
      state: opp?.state ?? "",
      advisor: adv ?? null,
      publicUrl: q.publicToken ? `${env.webOrigins[0]}/q/${q.publicToken}` : null,
    };
  });

  // PATCH /api/quotes/:id — edit a DRAFT quote (replaces line items, recomputes totals).
  app.patch("/:id", async (req) => {
    const user = requireUser(req);
    const { id } = req.params as { id: string };
    const q = await loadQuoteForUser(id, user.id, user.orgId, isManagerial(user.role));
    if (q.status !== "draft") throw badRequest("Only draft quotes can be edited", "not_draft");
    const input = parse(quoteUpdateSchema, req.body);

    const discount = input.discount ?? 0;
    const taxRate = input.tax_rate ?? 0;
    const { lines, subtotal, taxAmount, total } = computeTotals(toLineInputs(input.line_items), discount, taxRate);

    const updated = await db.transaction(async (tx) => {
      const [qrow] = await tx
        .update(quotes)
        .set({
          title: input.title,
          contactName: input.contact_name ?? null,
          contactEmail: input.contact_email ?? null,
          notes: input.notes ?? null,
          validUntil: input.valid_until ? input.valid_until.toISOString().slice(0, 10) : null,
          discount: String(discount),
          taxRate: String(taxRate),
          subtotal: String(subtotal),
          taxAmount: String(taxAmount),
          total: String(total),
          updatedAt: new Date(),
        })
        .where(eq(quotes.id, id))
        .returning();
      await tx.delete(quoteLineItems).where(eq(quoteLineItems.quoteId, id));
      await tx.insert(quoteLineItems).values(
        lines.map((l) => ({
          quoteId: id,
          product: l.product,
          description: l.description,
          quantity: String(l.quantity),
          unitPrice: String(l.unitPrice),
          amount: String(l.amount),
          sortOrder: l.sortOrder,
        })),
      );
      return qrow!;
    });
    return { quote: mapQuote(updated) };
  });

  // POST /api/quotes/:id/send — issue the customer link, mark sent, email it.
  app.post("/:id/send", async (req) => {
    const user = requireUser(req);
    const { id } = req.params as { id: string };
    const q = await loadQuoteForUser(id, user.id, user.orgId, isManagerial(user.role));
    if (q.status === "signed") throw badRequest("This quote is already signed", "already_signed");
    if (!q.contactEmail) throw badRequest("Add a contact email before sending", "no_email");

    const token = q.publicToken ?? randomBytes(24).toString("hex");
    const now = new Date();
    const [updated] = await db
      .update(quotes)
      .set({ status: "sent", publicToken: token, sentAt: now, updatedAt: now })
      .where(eq(quotes.id, id))
      .returning();

    const link = `${env.webOrigins[0]}/q/${token}`;
    const sent = await mailer.sendQuote(q.contactEmail, q.contactName ?? "there", q.quoteNumber, link);
    const subject = `Quote ${q.quoteNumber} sent to ${q.contactEmail}`;
    await recordCommunication({
      orgId: user.orgId,
      toEmail: q.contactEmail,
      subject: `Your SmartPlan quote ${q.quoteNumber}`,
      kind: "quote",
      opportunityId: q.opportunityId,
      advisorId: q.advisorId,
      provider: sent.provider,
      providerMessageId: sent.id,
      status: sent.status,
    });
    await logActivity({ opportunityId: q.opportunityId, advisorId: q.advisorId, type: "quote", subject });
    return { quote: mapQuote(updated!), publicUrl: link };
  });

  // DELETE /api/quotes/:id — remove a draft quote.
  app.delete("/:id", async (req) => {
    const user = requireUser(req);
    const { id } = req.params as { id: string };
    const q = await loadQuoteForUser(id, user.id, user.orgId, isManagerial(user.role));
    if (q.status !== "draft") throw badRequest("Only draft quotes can be deleted", "not_draft");
    await db.delete(quotes).where(eq(quotes.id, id));
    return { ok: true };
  });
}
