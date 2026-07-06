import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, asc, eq } from "drizzle-orm";
import { db, statusStages, products, journeyStages, activityTypes, badgeTiers, organizations } from "@smart-crm/db";
import { statusStageSchema, productSchema, journeyStageSchema, activityTypeSchema, badgeTierSchema, CURRENCY_CODES, DATE_FORMAT_VALUES } from "@smart-crm/shared";
import { parse } from "../lib/validate.js";
import { authenticate } from "../auth/context.js";
import { requireManagerial, requireSuperAdmin, requireUser } from "../auth/guards.js";
import { badRequest, conflict, notFound } from "../lib/errors.js";
import { storage, newStorageKey } from "../lib/storage.js";

const orgPrefsSchema = z.object({
  currency: z.enum(CURRENCY_CODES),
  date_format: z.enum(DATE_FORMAT_VALUES),
});

export async function registerSettingsRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);

  // ── Organization display preferences (currency + date format) ──
  app.get("/organization", async (req) => {
    const user = requireUser(req);
    const [org] = await db
      .select({ id: organizations.id, name: organizations.name, currency: organizations.currency, dateFormat: organizations.dateFormat })
      .from(organizations)
      .where(eq(organizations.id, user.orgId))
      .limit(1);
    if (!org) throw notFound("Organization not found");
    return { org };
  });

  app.patch("/organization", async (req) => {
    const user = requireSuperAdmin(req);
    const input = parse(orgPrefsSchema, req.body);
    const [org] = await db
      .update(organizations)
      .set({ currency: input.currency, dateFormat: input.date_format })
      .where(eq(organizations.id, user.orgId))
      .returning({ id: organizations.id, name: organizations.name, currency: organizations.currency, dateFormat: organizations.dateFormat });
    return { org };
  });

  // ── Reads: any authenticated user (advisors need these for the capture form) ──
  app.get("/status-stages", async (req) => {
    const user = requireUser(req);
    const rows = await db.select().from(statusStages).where(eq(statusStages.orgId, user.orgId)).orderBy(asc(statusStages.sortOrder));
    return { stages: rows };
  });

  app.get("/products", async (req) => {
    const user = requireUser(req);
    const rows = await db.select().from(products).where(eq(products.orgId, user.orgId)).orderBy(asc(products.sortOrder));
    return { products: rows };
  });

  app.get("/journey-stages", async (req) => {
    const user = requireUser(req);
    const rows = await db.select().from(journeyStages).where(eq(journeyStages.orgId, user.orgId)).orderBy(asc(journeyStages.sortOrder));
    return { stages: rows };
  });

  // ── Mutations: managerial only (§3.3) ──
  app.post("/status-stages", async (req) => {
    const user = requireManagerial(req);
    const input = parse(statusStageSchema, req.body);
    const [dupe] = await db.select({ id: statusStages.id }).from(statusStages).where(and(eq(statusStages.orgId, user.orgId), eq(statusStages.key, input.key))).limit(1);
    if (dupe) throw conflict("A stage with that key already exists", "key_taken");
    const [created] = await db
      .insert(statusStages)
      .values({
        orgId: user.orgId,
        key: input.key,
        label: input.label,
        sortOrder: input.sort_order,
        isConversion: input.is_conversion,
        isTerminal: input.is_terminal,
        winProbability: input.win_probability,
      })
      .returning();
    return { stage: created };
  });

  // Key is immutable (opportunities reference it) — only label/order/flags/active change.
  app.patch("/status-stages/:id", async (req) => {
    const user = requireManagerial(req);
    const { id } = req.params as { id: string };
    const body = req.body as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    if (typeof body.label === "string") patch.label = body.label;
    if (typeof body.sort_order === "number") patch.sortOrder = body.sort_order;
    if (typeof body.is_conversion === "boolean") patch.isConversion = body.is_conversion;
    if (typeof body.is_terminal === "boolean") patch.isTerminal = body.is_terminal;
    if (typeof body.win_probability === "number") patch.winProbability = Math.max(0, Math.min(100, body.win_probability));
    if (typeof body.active === "boolean") patch.active = body.active;
    const [updated] = await db.update(statusStages).set(patch).where(and(eq(statusStages.id, id), eq(statusStages.orgId, user.orgId))).returning();
    if (!updated) throw notFound("Stage not found");
    return { stage: updated };
  });

  app.post("/products", async (req) => {
    const user = requireManagerial(req);
    const input = parse(productSchema, req.body);
    const [created] = await db
      .insert(products)
      .values({ orgId: user.orgId, label: input.label, sortOrder: input.sort_order, active: input.active, defaultPrice: input.default_price != null ? String(input.default_price) : null })
      .returning();
    return { product: created };
  });

  app.patch("/products/:id", async (req) => {
    const user = requireManagerial(req);
    const { id } = req.params as { id: string };
    const body = req.body as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    if (typeof body.label === "string") patch.label = body.label;
    if (typeof body.sort_order === "number") patch.sortOrder = body.sort_order;
    if (typeof body.active === "boolean") patch.active = body.active;
    if ("default_price" in body) patch.defaultPrice = body.default_price == null ? null : String(body.default_price);
    const [updated] = await db.update(products).set(patch).where(and(eq(products.id, id), eq(products.orgId, user.orgId))).returning();
    if (!updated) throw notFound("Product not found");
    return { product: updated };
  });

  app.post("/journey-stages", async (req) => {
    const user = requireManagerial(req);
    const input = parse(journeyStageSchema, req.body);
    const [created] = await db
      .insert(journeyStages)
      .values({ orgId: user.orgId, label: input.label, sortOrder: input.sort_order ?? 0, active: input.active ?? true })
      .returning();
    return { stage: created };
  });

  app.patch("/journey-stages/:id", async (req) => {
    const user = requireManagerial(req);
    const { id } = req.params as { id: string };
    const body = req.body as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    if (typeof body.label === "string") patch.label = body.label;
    if (typeof body.sort_order === "number") patch.sortOrder = body.sort_order;
    if (typeof body.active === "boolean") patch.active = body.active;
    const [updated] = await db.update(journeyStages).set(patch).where(and(eq(journeyStages.id, id), eq(journeyStages.orgId, user.orgId))).returning();
    if (!updated) throw notFound("Stage not found");
    return { stage: updated };
  });

  // ── Activity types (sales / non-sales) ──
  app.get("/activity-types", async (req) => {
    const user = requireUser(req);
    const rows = await db.select().from(activityTypes).where(eq(activityTypes.orgId, user.orgId)).orderBy(asc(activityTypes.sortOrder));
    return { activityTypes: rows };
  });

  app.post("/activity-types", async (req) => {
    const user = requireManagerial(req);
    const input = parse(activityTypeSchema, req.body);
    const [created] = await db.insert(activityTypes).values({ orgId: user.orgId, label: input.label, category: input.category, sortOrder: input.sort_order ?? 0, active: input.active ?? true }).returning();
    return { activityType: created };
  });

  app.patch("/activity-types/:id", async (req) => {
    const user = requireManagerial(req);
    const { id } = req.params as { id: string };
    const body = req.body as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    if (typeof body.label === "string") patch.label = body.label;
    if (body.category === "sales" || body.category === "non_sales") patch.category = body.category;
    if (typeof body.sort_order === "number") patch.sortOrder = body.sort_order;
    if (typeof body.active === "boolean") patch.active = body.active;
    const [updated] = await db.update(activityTypes).set(patch).where(and(eq(activityTypes.id, id), eq(activityTypes.orgId, user.orgId))).returning();
    if (!updated) throw notFound("Activity type not found");
    return { activityType: updated };
  });

  // ── Ego badge tiers (thresholds by % of objective) ──
  app.get("/badge-tiers", async (req) => {
    const user = requireUser(req);
    const rows = await db.select().from(badgeTiers).where(eq(badgeTiers.orgId, user.orgId)).orderBy(asc(badgeTiers.sortOrder), asc(badgeTiers.minPercent));
    return { badgeTiers: rows };
  });

  app.post("/badge-tiers", async (req) => {
    const user = requireManagerial(req);
    const input = parse(badgeTierSchema, req.body);
    const [created] = await db.insert(badgeTiers).values({ orgId: user.orgId, label: input.label, minPercent: String(input.min_percent ?? 0), color: input.color ?? null, sortOrder: input.sort_order ?? 0 }).returning();
    return { badgeTier: created };
  });

  app.patch("/badge-tiers/:id", async (req) => {
    const user = requireManagerial(req);
    const { id } = req.params as { id: string };
    const body = req.body as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    if (typeof body.label === "string") patch.label = body.label;
    if (typeof body.min_percent === "number") patch.minPercent = String(body.min_percent);
    if (typeof body.color === "string") patch.color = body.color;
    if (typeof body.sort_order === "number") patch.sortOrder = body.sort_order;
    const [updated] = await db.update(badgeTiers).set(patch).where(and(eq(badgeTiers.id, id), eq(badgeTiers.orgId, user.orgId))).returning();
    if (!updated) throw notFound("Badge tier not found");
    return { badgeTier: updated };
  });

  app.delete("/badge-tiers/:id", async (req) => {
    const user = requireManagerial(req);
    const { id } = req.params as { id: string };
    await db.delete(badgeTiers).where(and(eq(badgeTiers.id, id), eq(badgeTiers.orgId, user.orgId)));
    return { ok: true };
  });

  // ── Branding: portal logo upload (managerial, §3.3 / §2) ──
  const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/svg+xml", "image/webp", "image/gif"]);

  // POST /api/settings/branding?variant=light|dark — multipart 'file' (image). Per-org.
  app.post("/branding", async (req) => {
    const user = requireManagerial(req);
    const variant = (req.query as { variant?: string }).variant === "dark" ? "dark" : "light";
    const file = await req.file();
    if (!file) throw badRequest("No file provided", "no_file");
    if (!IMAGE_TYPES.has(file.mimetype)) throw badRequest("Logo must be a PNG, JPG, SVG, WEBP or GIF", "bad_type");
    const buffer = await file.toBuffer();
    if (buffer.byteLength > 5 * 1024 * 1024) throw badRequest("Logo must be under 5MB", "too_large");

    const key = `branding/${newStorageKey(file.filename)}`;
    await storage.put(key, buffer, file.mimetype);

    const [org] = await db
      .select({ light: organizations.lightLogoKey, dark: organizations.darkLogoKey })
      .from(organizations)
      .where(eq(organizations.id, user.orgId))
      .limit(1);
    const prev = variant === "dark" ? org?.dark : org?.light;
    await db
      .update(organizations)
      .set(variant === "dark" ? { darkLogoKey: key } : { lightLogoKey: key })
      .where(eq(organizations.id, user.orgId));
    if (prev && prev !== key) await storage.delete(prev);
    return { logoUrl: storage.signedUrl(key, 3600) };
  });

  // DELETE /api/settings/branding?variant=light|dark — revert that variant to the default mark.
  app.delete("/branding", async (req) => {
    const user = requireManagerial(req);
    const variant = (req.query as { variant?: string }).variant === "dark" ? "dark" : "light";
    const [org] = await db
      .select({ light: organizations.lightLogoKey, dark: organizations.darkLogoKey })
      .from(organizations)
      .where(eq(organizations.id, user.orgId))
      .limit(1);
    const prev = variant === "dark" ? org?.dark : org?.light;
    await db
      .update(organizations)
      .set(variant === "dark" ? { darkLogoKey: null } : { lightLogoKey: null })
      .where(eq(organizations.id, user.orgId));
    if (prev) await storage.delete(prev);
    return { ok: true };
  });
}
