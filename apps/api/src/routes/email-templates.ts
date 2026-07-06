import type { FastifyInstance } from "fastify";
import { and, asc, eq } from "drizzle-orm";
import { db, emailTemplates } from "@smart-crm/db";
import { emailTemplateSchema, isManagerial } from "@smart-crm/shared";
import { parse } from "../lib/validate.js";
import { authenticate } from "../auth/context.js";
import { requireUser, requireManagerial } from "../auth/guards.js";
import { badRequest, notFound } from "../lib/errors.js";
import { storage, newStorageKey } from "../lib/storage.js";

const ATTACH_TYPES_MAX = 10 * 1024 * 1024;

export async function registerEmailTemplateRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);

  // GET /api/email-templates — advisors see active templates to use; managers see all.
  app.get("/", async (req) => {
    const user = requireUser(req);
    const rows = await db.select().from(emailTemplates).where(eq(emailTemplates.orgId, user.orgId)).orderBy(asc(emailTemplates.sortOrder), asc(emailTemplates.name));
    const visible = isManagerial(user.role) ? rows : rows.filter((r) => r.active);
    return { templates: visible };
  });

  app.post("/", async (req) => {
    const user = requireManagerial(req);
    const input = parse(emailTemplateSchema, req.body);
    const [created] = await db
      .insert(emailTemplates)
      .values({
        orgId: user.orgId,
        name: input.name,
        subject: input.subject ?? "",
        cc: input.cc ?? null,
        bcc: input.bcc ?? null,
        bodyHtml: input.body_html ?? "",
        attachments: input.attachments ?? [],
        active: input.active ?? true,
        sortOrder: input.sort_order ?? 0,
        createdBy: user.id,
      })
      .returning();
    return { template: created };
  });

  app.patch("/:id", async (req) => {
    const user = requireManagerial(req);
    const { id } = req.params as { id: string };
    const input = parse(emailTemplateSchema, req.body);
    const [updated] = await db
      .update(emailTemplates)
      .set({
        name: input.name,
        subject: input.subject ?? "",
        cc: input.cc ?? null,
        bcc: input.bcc ?? null,
        bodyHtml: input.body_html ?? "",
        attachments: input.attachments ?? [],
        active: input.active ?? true,
        sortOrder: input.sort_order ?? 0,
        updatedAt: new Date(),
      })
      .where(and(eq(emailTemplates.id, id), eq(emailTemplates.orgId, user.orgId)))
      .returning();
    if (!updated) throw notFound("Template not found");
    return { template: updated };
  });

  app.delete("/:id", async (req) => {
    const user = requireManagerial(req);
    const { id } = req.params as { id: string };
    await db.delete(emailTemplates).where(and(eq(emailTemplates.id, id), eq(emailTemplates.orgId, user.orgId)));
    return { ok: true };
  });

  // POST /api/email-templates/attachment — upload a file, return a storage reference.
  app.post("/attachment", async (req) => {
    requireManagerial(req);
    const file = await req.file();
    if (!file) throw badRequest("No file provided", "no_file");
    const buffer = await file.toBuffer();
    if (buffer.byteLength > ATTACH_TYPES_MAX) throw badRequest("Attachment must be under 10MB", "too_large");
    const key = `email-attachments/${newStorageKey(file.filename)}`;
    await storage.put(key, buffer);
    return { attachment: { key, filename: file.filename || "attachment", size: buffer.byteLength } };
  });
}
