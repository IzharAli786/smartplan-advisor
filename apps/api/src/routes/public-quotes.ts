import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { db, quotes, quoteLineItems, opportunities, users, organizations } from "@smart-crm/db";
import { quoteSignSchema } from "@smart-crm/shared";
import { parse } from "../lib/validate.js";
import { notFound, badRequest } from "../lib/errors.js";
import { effectiveStatus } from "../services/quotes.js";
import { notify } from "../services/notify.js";
import { logActivity } from "../services/activity.js";
import { storage } from "../lib/storage.js";

/**
 * PUBLIC quote view + e-signature — NO auth hook. The unguessable token in the URL is
 * the capability. The customer reviews a branded quote, then signs (typed name + intent
 * + timestamp + IP). Viewing/signing notifies the advisor.
 */
async function loadByToken(token: string) {
  const [q] = await db.select().from(quotes).where(eq(quotes.publicToken, token)).limit(1);
  if (!q) throw notFound("This quote link is invalid or has expired");
  return q;
}

async function publicPayload(q: typeof quotes.$inferSelect) {
  const items = await db.select().from(quoteLineItems).where(eq(quoteLineItems.quoteId, q.id));
  const [opp] = await db
    .select({ company: opportunities.contractorCompanyName })
    .from(opportunities)
    .where(eq(opportunities.id, q.opportunityId))
    .limit(1);
  const [adv] = await db.select({ name: users.fullName, email: users.email, phone: users.phone }).from(users).where(eq(users.id, q.advisorId)).limit(1);
  // The customer sees the quote's ORGANIZATION logo (light preferred, dark as fallback).
  const [org] = await db.select({ light: organizations.lightLogoKey, dark: organizations.darkLogoKey }).from(organizations).where(eq(organizations.id, q.orgId)).limit(1);
  const logoKey = org?.light ?? org?.dark ?? null;
  return {
    quoteNumber: q.quoteNumber,
    title: q.title,
    company: opp?.company ?? "",
    contactName: q.contactName,
    advisor: adv ?? null,
    status: effectiveStatus(q.status, q.validUntil),
    currency: q.currency,
    subtotal: Number(q.subtotal),
    discount: Number(q.discount),
    taxRate: Number(q.taxRate),
    taxAmount: Number(q.taxAmount),
    total: Number(q.total),
    notes: q.notes,
    validUntil: q.validUntil,
    signedAt: q.signedAt,
    signerName: q.signerName,
    logoUrl: logoKey ? storage.signedUrl(logoKey, 3600) : null,
    lineItems: items
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((r) => ({ product: r.product, description: r.description, quantity: Number(r.quantity), unitPrice: Number(r.unitPrice), amount: Number(r.amount) })),
  };
}

export async function registerPublicQuoteRoutes(app: FastifyInstance) {
  // GET /api/public/quotes/:token — view (marks "viewed" on first open).
  app.get("/api/public/quotes/:token", async (req) => {
    const { token } = req.params as { token: string };
    const q = await loadByToken(token);

    if (q.status === "sent") {
      const now = new Date();
      await db.update(quotes).set({ status: "viewed", viewedAt: now, updatedAt: now }).where(eq(quotes.id, q.id));
      const [opp] = await db.select({ company: opportunities.contractorCompanyName }).from(opportunities).where(eq(opportunities.id, q.opportunityId)).limit(1);
      await notify({
        orgId: q.orgId,
        userId: q.advisorId,
        type: "quote_update",
        message: `${opp?.company ?? "A customer"} viewed quote ${q.quoteNumber}.`,
        relatedId: q.id,
      });
      await logActivity({ opportunityId: q.opportunityId, advisorId: q.advisorId, type: "quote", subject: `Quote ${q.quoteNumber} viewed by customer` });
      q.status = "viewed";
    }
    return { quote: await publicPayload(q) };
  });

  // POST /api/public/quotes/:token/sign — capture the e-signature.
  app.post("/api/public/quotes/:token/sign", async (req) => {
    const { token } = req.params as { token: string };
    const input = parse(quoteSignSchema, req.body);
    const q = await loadByToken(token);
    const eff = effectiveStatus(q.status, q.validUntil);
    if (q.status === "signed") throw badRequest("This quote has already been signed", "already_signed");
    if (q.status === "declined") throw badRequest("This quote was declined", "declined");
    if (eff === "expired") throw badRequest("This quote has expired", "expired");
    if (q.status !== "sent" && q.status !== "viewed") throw badRequest("This quote can't be signed", "bad_state");

    const now = new Date();
    await db
      .update(quotes)
      .set({ status: "signed", signedAt: now, signerName: input.signer_name, signerIp: req.ip, signature: input.signer_name, updatedAt: now })
      .where(eq(quotes.id, q.id));
    await notify({
      orgId: q.orgId,
      userId: q.advisorId,
      type: "quote_update",
      message: `🎉 ${input.signer_name} signed quote ${q.quoteNumber}!`,
      relatedId: q.id,
    });
    await logActivity({ opportunityId: q.opportunityId, advisorId: q.advisorId, type: "quote", subject: `Quote ${q.quoteNumber} signed by ${input.signer_name}` });
    q.status = "signed";
    q.signedAt = now;
    q.signerName = input.signer_name;
    return { quote: await publicPayload(q) };
  });

  // POST /api/public/quotes/:token/decline — customer declines.
  app.post("/api/public/quotes/:token/decline", async (req) => {
    const { token } = req.params as { token: string };
    const q = await loadByToken(token);
    if (q.status === "signed") throw badRequest("This quote has already been signed", "already_signed");
    const now = new Date();
    await db.update(quotes).set({ status: "declined", declinedAt: now, updatedAt: now }).where(eq(quotes.id, q.id));
    await notify({ orgId: q.orgId, userId: q.advisorId, type: "quote_update", message: `Quote ${q.quoteNumber} was declined by the customer.`, relatedId: q.id });
    await logActivity({ opportunityId: q.opportunityId, advisorId: q.advisorId, type: "quote", subject: `Quote ${q.quoteNumber} declined by customer` });
    q.status = "declined";
    return { quote: await publicPayload(q) };
  });
}
