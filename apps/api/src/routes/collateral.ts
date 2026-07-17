import type { FastifyInstance } from "fastify";
import { and, asc, eq, ilike } from "drizzle-orm";
import { db, collateral } from "@smart-crm/db";
import { collateralSchema } from "@smart-crm/shared";
import { parse } from "../lib/validate.js";
import { authenticate } from "../auth/context.js";
import { requireUser, requireManagerial } from "../auth/guards.js";
import { notFound, badRequest } from "../lib/errors.js";
import { storage, newStorageKey } from "../lib/storage.js";

type CollateralRow = typeof collateral.$inferSelect;

/** Attach a fresh signed URL for hosted files; external links pass through (§7, §11.5). */
function present(row: CollateralRow) {
  const fileUrl = row.storageKey ? storage.signedUrl(row.storageKey) : (row.externalUrl ?? null);
  return {
    id: row.id,
    product: row.product,
    type: row.type,
    title: row.title,
    description: row.description,
    fileUrl,
    externalUrl: row.externalUrl,
    thumbnailUrl: row.thumbnailUrl,
    sortOrder: row.sortOrder,
    active: row.active,
    createdAt: row.createdAt,
  };
}

export async function registerCollateralRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);

  // GET /api/collateral?product=&q= — browse by product, search by title (§7). All users.
  app.get("/", async (req) => {
    const user = requireUser(req);
    const q = req.query as { product?: string; q?: string; includeInactive?: string };
    const conds = [eq(collateral.orgId, user.orgId)];
    if (q.product) conds.push(eq(collateral.product, q.product));
    if (q.q) conds.push(ilike(collateral.title, `%${q.q}%`));
    if (q.includeInactive !== "true") conds.push(eq(collateral.active, true));
    const rows = await db
      .select()
      .from(collateral)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(asc(collateral.sortOrder), asc(collateral.createdAt));
    return { collateral: rows.map(present) };
  });

  // GET /api/collateral/:id/share — signed shareable link to send into a deal (§7).
  app.get("/:id/share", async (req) => {
    const user = requireUser(req);
    const { id } = req.params as { id: string };
    const [row] = await db.select().from(collateral).where(and(eq(collateral.id, id), eq(collateral.orgId, user.orgId))).limit(1);
    if (!row || !row.active) throw notFound("Collateral not found");
    const url = row.storageKey ? storage.signedUrl(row.storageKey, 3600) : row.externalUrl;
    return { url, title: row.title, type: row.type };
  });

  // POST /api/collateral — create a video/link asset (no file upload). Managerial.
  app.post("/", async (req) => {
    const user = requireManagerial(req);
    const input = parse(collateralSchema, req.body);
    if (input.type === "pdf" || input.type === "slides" || input.type === "image") {
      throw badRequest("Use the upload endpoint for file-based assets", "use_upload");
    }
    const [created] = await db
      .insert(collateral)
      .values({
        orgId: user.orgId,
        product: input.product,
        type: input.type,
        title: input.title,
        description: input.description ?? null,
        externalUrl: input.external_url ?? null,
        sortOrder: input.sort_order,
        uploadedBy: user.id,
        active: true,
      })
      .returning();
    return { collateral: present(created!) };
  });

  // POST /api/collateral/upload — multipart: file + metadata fields (pdf/slides/image). Managerial.
  app.post("/upload", async (req) => {
    const user = requireManagerial(req);
    const fields: Record<string, string> = {};
    let fileBuffer: Buffer | null = null;
    let fileName = "";
    let fileMime: string | null = null;

    const parts = req.parts();
    for await (const part of parts) {
      if (part.type === "file") {
        fileName = part.filename;
        fileMime = part.mimetype;
        fileBuffer = await part.toBuffer();
      } else {
        fields[part.fieldname] = String(part.value);
      }
    }
    if (!fileBuffer) throw badRequest("No file provided", "no_file");
    if (!fields.product || !fields.title || !fields.type) {
      throw badRequest("product, title and type are required", "missing_fields");
    }

    const key = newStorageKey(fileName);
    await storage.put(key, fileBuffer, fileMime);

    const [created] = await db
      .insert(collateral)
      .values({
        orgId: user.orgId,
        product: fields.product,
        type: fields.type as CollateralRow["type"],
        title: fields.title,
        description: fields.description ?? null,
        storageKey: key,
        sortOrder: fields.sort_order ? Number(fields.sort_order) : 0,
        uploadedBy: user.id,
        active: true,
      })
      .returning();
    return { collateral: present(created!) };
  });

  // PATCH /api/collateral/:id — edit metadata / reorder / deactivate. Managerial.
  app.patch("/:id", async (req) => {
    const user = requireManagerial(req);
    const { id } = req.params as { id: string };
    const body = req.body as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    if (typeof body.title === "string") patch.title = body.title;
    if (typeof body.description === "string") patch.description = body.description;
    if (typeof body.product === "string") patch.product = body.product;
    if (typeof body.external_url === "string") patch.externalUrl = body.external_url;
    if (typeof body.sort_order === "number") patch.sortOrder = body.sort_order;
    if (typeof body.active === "boolean") patch.active = body.active;
    const [updated] = await db.update(collateral).set(patch).where(and(eq(collateral.id, id), eq(collateral.orgId, user.orgId))).returning();
    if (!updated) throw notFound("Collateral not found");
    return { collateral: present(updated) };
  });

  // DELETE /api/collateral/:id — permanently remove an asset. Managerial.
  // Hiding (PATCH active:false) is the reversible option; this is the hard delete.
  app.delete("/:id", async (req) => {
    const user = requireManagerial(req);
    const { id } = req.params as { id: string };
    const [removed] = await db
      .delete(collateral)
      .where(and(eq(collateral.id, id), eq(collateral.orgId, user.orgId)))
      .returning();
    if (!removed) throw notFound("Collateral not found");
    // Drop the backing file too, so hosted blobs don't outlive their record.
    if (removed.storageKey) await storage.delete(removed.storageKey);
    return { ok: true };
  });
}
