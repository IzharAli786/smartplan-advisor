import type { FastifyInstance } from "fastify";
import { and, desc, eq, ilike, or } from "drizzle-orm";
import { db, contacts, users } from "@smart-crm/db";
import { contactSchema, contactImportSchema, isManagerial } from "@smart-crm/shared";
import { parse } from "../lib/validate.js";
import { authenticate } from "../auth/context.js";
import { requireUser } from "../auth/guards.js";
import { forbidden, notFound } from "../lib/errors.js";
import { listCommunications } from "../services/communications.js";

const cols = {
  id: contacts.id,
  ownerId: contacts.ownerId,
  type: contacts.type,
  name: contacts.name,
  company: contacts.company,
  title: contacts.title,
  email: contacts.email,
  phone: contacts.phone,
  phone2: contacts.phone2,
  address: contacts.address,
  notes: contacts.notes,
  nextReviewAt: contacts.nextReviewAt,
  reviewNotes: contacts.reviewNotes,
  createdAt: contacts.createdAt,
  updatedAt: contacts.updatedAt,
};

export async function registerContactRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);

  // GET /api/contacts?q=&type= — advisors see own; managers see everyone's (with owner name).
  app.get("/", async (req) => {
    const user = requireUser(req);
    const q = req.query as { q?: string; type?: string };
    const conds = [eq(contacts.orgId, user.orgId)];
    if (!isManagerial(user.role)) conds.push(eq(contacts.ownerId, user.id));
    if (q.type) conds.push(eq(contacts.type, q.type as "customer" | "lead" | "partner" | "other"));
    if (q.q) {
      const like = `%${q.q}%`;
      const m = or(ilike(contacts.name, like), ilike(contacts.company, like), ilike(contacts.email, like));
      if (m) conds.push(m);
    }
    const rows = await db
      .select({ ...cols, ownerName: users.fullName })
      .from(contacts)
      .leftJoin(users, eq(users.id, contacts.ownerId))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(contacts.updatedAt));
    return { contacts: rows };
  });

  // POST /api/contacts — add a contact (owned by the current user).
  app.post("/", async (req) => {
    const user = requireUser(req);
    const input = parse(contactSchema, req.body);
    const [created] = await db
      .insert(contacts)
      .values({
        orgId: user.orgId,
        ownerId: user.id,
        type: input.type,
        name: input.name,
        company: input.company ?? null,
        title: input.title ?? null,
        email: input.email ?? null,
        phone: input.phone ?? null,
        phone2: input.phone2 ?? null,
        address: input.address ?? null,
        notes: input.notes ?? null,
        nextReviewAt: input.next_review_at ?? null,
        reviewNotes: input.review_notes ?? null,
      })
      .returning(cols);
    return { contact: created };
  });

  async function loadOwned(id: string, userId: string, orgId: string, managerial: boolean) {
    const [c] = await db.select(cols).from(contacts).where(and(eq(contacts.id, id), eq(contacts.orgId, orgId))).limit(1);
    if (!c) throw notFound("Contact not found");
    if (!managerial && c.ownerId !== userId) throw forbidden();
    return c;
  }

  app.patch("/:id", async (req) => {
    const user = requireUser(req);
    const { id } = req.params as { id: string };
    await loadOwned(id, user.id, user.orgId, isManagerial(user.role));
    const input = parse(contactSchema, req.body);
    const [updated] = await db
      .update(contacts)
      .set({
        type: input.type,
        name: input.name,
        company: input.company ?? null,
        title: input.title ?? null,
        email: input.email ?? null,
        phone: input.phone ?? null,
        phone2: input.phone2 ?? null,
        address: input.address ?? null,
        notes: input.notes ?? null,
        nextReviewAt: input.next_review_at ?? null,
        reviewNotes: input.review_notes ?? null,
        updatedAt: new Date(),
      })
      .where(and(eq(contacts.id, id), eq(contacts.orgId, user.orgId)))
      .returning(cols);
    return { contact: updated };
  });

  // GET /api/contacts/:id/communications — the dated log of quotes/emails sent to this contact.
  app.get("/:id/communications", async (req) => {
    const user = requireUser(req);
    const { id } = req.params as { id: string };
    const c = await loadOwned(id, user.id, user.orgId, isManagerial(user.role));
    const comms = await listCommunications({
      orgId: user.orgId,
      ...(c.email ? { email: c.email } : { contactId: id }),
      advisorId: isManagerial(user.role) ? undefined : user.id,
    });
    return { communications: comms };
  });

  app.delete("/:id", async (req) => {
    const user = requireUser(req);
    const { id } = req.params as { id: string };
    await loadOwned(id, user.id, user.orgId, isManagerial(user.role));
    await db.delete(contacts).where(and(eq(contacts.id, id), eq(contacts.orgId, user.orgId)));
    return { ok: true };
  });

  // POST /api/contacts/import — bulk add (from Excel or phone). Owned by the current user.
  app.post("/import", async (req) => {
    const user = requireUser(req);
    const input = parse(contactImportSchema, req.body);
    const rows = input.contacts.filter((c) => c.name?.trim());
    if (rows.length === 0) return { imported: 0 };
    await db.insert(contacts).values(
      rows.map((c) => ({
        orgId: user.orgId,
        ownerId: user.id,
        type: (c.type ?? "lead") as "customer" | "lead" | "partner" | "other",
        name: c.name,
        company: c.company ?? null,
        title: c.title ?? null,
        email: c.email ?? null,
        phone: c.phone ?? null,
        phone2: c.phone2 ?? null,
        address: c.address ?? null,
        notes: c.notes ?? null,
      })),
    );
    return { imported: rows.length };
  });
}
