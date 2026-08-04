import type { FastifyInstance } from "fastify";
import { and, desc, eq, sql as dsql } from "drizzle-orm";
import { db, users, leads, opportunities, quotes, transactions, smartplanTransactions } from "@smart-crm/db";
import { createUserSchema, updateUserSchema, deleteUserSchema, canEditUser, isManagerial, DEFAULT_COMMISSION_RATE, type Role } from "@smart-crm/shared";
import { parse } from "../lib/validate.js";
import { authenticate } from "../auth/context.js";
import { requireManagerial, requireSuperAdmin, requireUser } from "../auth/guards.js";
import { badRequest, conflict, forbidden, notFound, unprocessable } from "../lib/errors.js";
import { serializeUser, type UserRow } from "../lib/serialize.js";
import { storage, newStorageKey } from "../lib/storage.js";
import { generateToken, hashPassword } from "../auth/password.js";
import { userTokens } from "@smart-crm/db";
import { mailer } from "../lib/mailer.js";
import { env } from "../env.js";
import { recordRateChange, getHistory } from "../services/commission.js";

const listColumns = {
  id: users.id,
  role: users.role,
  fullName: users.fullName,
  email: users.email,
  phone: users.phone,
  phone2: users.phone2,
  address: users.address,
  startDate: users.startDate,
  referralLink: users.referralLink,
  enrolledDate: users.enrolledDate,
  referredBy: users.referredBy,
  notes: users.notes,
  bio: users.bio,
  capabilities: users.capabilities,
  statesCovered: users.statesCovered,
  avatarKey: users.avatarKey,
  currentCommissionRate: users.currentCommissionRate,
  monthlyQuota: users.monthlyQuota,
  apolloCreditAllowanceMonthly: users.apolloCreditAllowanceMonthly,
  active: users.active,
  passwordHash: users.passwordHash,
  invitedAt: users.invitedAt,
  createdAt: users.createdAt,
};

const toDateStr = (d?: Date) => (d ? d.toISOString().slice(0, 10) : null);

/** Create a 7-day set-password invite token + send the invite email.
 * Exported for the SmartPlan advisor-sync ingest, which provisions accounts. */
export async function issueInvite(userId: string, email: string, name: string) {
  const { raw, hash } = generateToken();
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await db.insert(userTokens).values({ userId, tokenHash: hash, purpose: "invite", expiresAt: expires });
  const link = `${env.webOrigins[0]}/set-password?token=${raw}`;
  await mailer.sendInvite(email, name, link);
}

export async function registerUserRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);

  // GET /api/users — roster (managerial only). Advisors never list users.
  app.get("/", async (req) => {
    const viewer = requireManagerial(req);
    const rows = await db.select(listColumns).from(users).where(eq(users.orgId, viewer.orgId)).orderBy(desc(users.createdAt));
    return { users: rows.map((r) => serializeUser(r as UserRow, viewer.role)) };
  });

  // GET /api/users/:id — single user (managerial). Used by the advisor detail page.
  app.get("/:id", async (req) => {
    const viewer = requireManagerial(req);
    const { id } = req.params as { id: string };
    const [row] = await db.select(listColumns).from(users).where(and(eq(users.id, id), eq(users.orgId, viewer.orgId))).limit(1);
    if (!row) throw notFound("User not found");
    return { user: serializeUser(row as UserRow, viewer.role) };
  });

  // POST /api/users/:id/avatar — profile photo (self or managerial). Multipart 'file'.
  const AVATAR_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
  app.post("/:id/avatar", async (req) => {
    const viewer = requireUser(req);
    const { id } = req.params as { id: string };
    if (viewer.id !== id && !isManagerial(viewer.role)) throw forbidden();
    const file = await req.file();
    if (!file) throw badRequest("No file provided", "no_file");
    if (!AVATAR_TYPES.has(file.mimetype)) throw badRequest("Photo must be a PNG, JPG, WEBP or GIF", "bad_type");
    const buffer = await file.toBuffer();
    if (buffer.byteLength > 5 * 1024 * 1024) throw badRequest("Photo must be under 5MB", "too_large");

    const key = `avatars/${newStorageKey(file.filename)}`;
    await storage.put(key, buffer, file.mimetype);
    const [prev] = await db.select({ avatarKey: users.avatarKey }).from(users).where(and(eq(users.id, id), eq(users.orgId, viewer.orgId))).limit(1);
    if (!prev) throw notFound("User not found");
    await db.update(users).set({ avatarKey: key, updatedAt: new Date() }).where(and(eq(users.id, id), eq(users.orgId, viewer.orgId)));
    if (prev.avatarKey && prev.avatarKey !== key) await storage.delete(prev.avatarKey);
    return { avatarUrl: storage.signedUrl(key, 3600) };
  });

  // POST /api/users — create any role. SUPER ADMIN ONLY (§3.2, §11.4).
  app.post("/", async (req) => {
    const viewer = requireSuperAdmin(req);
    const input = parse(createUserSchema, req.body);

    const [dupe] = await db
      .select({ id: users.id })
      .from(users)
      .where(dsql`lower(${users.email}) = lower(${input.email})`)
      .limit(1);
    if (dupe) throw conflict("A user with that email already exists", "email_taken");

    const isAdvisor = input.role === "advisor";
    // Advisors default to 33% commission when no rate is given (§10).
    const commission = isAdvisor
      ? String(input.current_commission_rate ?? DEFAULT_COMMISSION_RATE)
      : null;
    const [created] = await db
      .insert(users)
      .values({
        role: input.role,
        orgId: viewer.orgId,
        fullName: input.full_name,
        email: input.email,
        phone: input.phone ?? null,
        phone2: input.phone2 ?? null,
        address: input.address ?? null,
        startDate: toDateStr(input.start_date),
        referralLink: input.referral_link ?? null,
        enrolledDate: toDateStr(input.enrolled_date),
        referredBy: input.referred_by ?? null,
        notes: input.notes ?? null,
        statesCovered: input.states_covered,
        // Commission + quota + Apollo allowance apply to advisors only.
        currentCommissionRate: commission,
        monthlyQuota: isAdvisor && input.monthly_quota != null ? String(input.monthly_quota) : null,
        apolloCreditAllowanceMonthly: isAdvisor ? (input.apollo_credit_allowance_monthly ?? null) : null,
        active: true,
        invitedAt: new Date(),
      })
      .returning(listColumns);

    // Seed commission history for advisors (effective from their start date, else today).
    if (isAdvisor && commission != null) {
      await recordRateChange(viewer.orgId, created!.id, Number(commission), toDateStr(input.start_date) ?? undefined);
    }

    await issueInvite(created!.id, created!.email, created!.fullName);
    return { user: serializeUser(created as UserRow, viewer.role) };
  });

  // GET /api/users/:id/commission-history — rate history (managerial).
  app.get("/:id/commission-history", async (req) => {
    const viewer = requireManagerial(req);
    const { id } = req.params as { id: string };
    const [target] = await db.select({ id: users.id }).from(users).where(and(eq(users.id, id), eq(users.orgId, viewer.orgId))).limit(1);
    if (!target) throw notFound("User not found");
    return { history: await getHistory(id) };
  });

  // PATCH /api/users/:id — edit. Super admin: anyone. Manager: advisors only (§3.2).
  app.patch("/:id", async (req) => {
    const viewer = requireManagerial(req);
    const { id } = req.params as { id: string };
    const input = parse(updateUserSchema, req.body);

    const [target] = await db.select(listColumns).from(users).where(and(eq(users.id, id), eq(users.orgId, viewer.orgId))).limit(1);
    if (!target) throw notFound("User not found");
    if (!canEditUser(viewer.role, target.role as Role)) {
      throw forbidden("You can only edit advisors");
    }

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (input.full_name !== undefined) patch.fullName = input.full_name;
    if (input.phone !== undefined) patch.phone = input.phone ?? null;
    if (input.phone2 !== undefined) patch.phone2 = input.phone2 ?? null;
    if (input.address !== undefined) patch.address = input.address ?? null;
    if (input.start_date !== undefined) patch.startDate = toDateStr(input.start_date);
    if (input.referral_link !== undefined) patch.referralLink = input.referral_link ?? null;
    if (input.enrolled_date !== undefined) patch.enrolledDate = toDateStr(input.enrolled_date);
    if (input.referred_by !== undefined) patch.referredBy = input.referred_by ?? null;
    if (input.notes !== undefined) patch.notes = input.notes ?? null;
    if (input.states_covered !== undefined) patch.statesCovered = input.states_covered;
    if (input.apollo_credit_allowance_monthly !== undefined)
      patch.apolloCreditAllowanceMonthly = input.apollo_credit_allowance_monthly;
    if (input.monthly_quota !== undefined && target.role === "advisor")
      patch.monthlyQuota = input.monthly_quota != null ? String(input.monthly_quota) : null;
    // Commission only applies to advisors and is set by managerial roles only.
    // When it actually changes, also append an effective-dated history row (§10).
    let rateChangedTo: number | null = null;
    if (input.current_commission_rate !== undefined && target.role === "advisor") {
      const newRate = input.current_commission_rate;
      const prevRate = target.currentCommissionRate != null ? Number(target.currentCommissionRate) : null;
      patch.currentCommissionRate = String(newRate);
      if (prevRate === null || prevRate !== newRate) rateChangedTo = newRate;
    }

    // Email change — keep it unique.
    if (input.email !== undefined && input.email.toLowerCase() !== target.email.toLowerCase()) {
      const [dupe] = await db
        .select({ id: users.id })
        .from(users)
        .where(dsql`lower(${users.email}) = lower(${input.email})`)
        .limit(1);
      if (dupe) throw conflict("Another user already has that email", "email_taken");
      patch.email = input.email;
    }

    // Admin-set password — hash it and revoke existing sessions.
    if (input.password) {
      patch.passwordHash = await hashPassword(input.password);
      patch.sessionVersion = dsql`${users.sessionVersion} + 1`;
    }

    // Deactivate / reactivate. Deactivating revokes sessions (session_version bump).
    if (input.active !== undefined) {
      patch.active = input.active;
      if (input.active === false) patch.sessionVersion = dsql`${users.sessionVersion} + 1`;
    }

    const [updated] = await db.update(users).set(patch).where(and(eq(users.id, id), eq(users.orgId, viewer.orgId))).returning(listColumns);
    if (rateChangedTo !== null) {
      await recordRateChange(viewer.orgId, id, rateChangedTo, toDateStr(input.commission_effective_from) ?? undefined);
    }

    return { user: serializeUser(updated as UserRow, viewer.role) };
  });

  // POST /api/users/:id/send-password-reset — email a set-password link (managerial; same edit rules).
  app.post("/:id/send-password-reset", async (req) => {
    const viewer = requireManagerial(req);
    const { id } = req.params as { id: string };
    const [target] = await db
      .select({ id: users.id, email: users.email, fullName: users.fullName, role: users.role, active: users.active })
      .from(users)
      .where(and(eq(users.id, id), eq(users.orgId, viewer.orgId)))
      .limit(1);
    if (!target) throw notFound("User not found");
    if (!canEditUser(viewer.role, target.role as Role)) throw forbidden("You can only manage advisors");
    if (!target.active) throw badRequest("User is deactivated", "inactive");

    const { raw, hash } = generateToken();
    const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    await db.insert(userTokens).values({ userId: target.id, tokenHash: hash, purpose: "reset", expiresAt: expires });
    await mailer.sendReset(target.email, `${env.webOrigins[0]}/set-password?token=${raw}`);
    return { ok: true };
  });

  // DELETE /api/users/:id — permanently remove a FORMER advisor. SUPER ADMIN ONLY.
  // Gates, in order: the target must be an advisor and already deactivated (that is
  // what "no longer a Smart Advisor" means in the roster); anything that must
  // outlive them keeps the row alive — pipeline accounts, quotes and commission /
  // SmartPlan revenue records block the delete outright (reassign the pipeline
  // first; advisors with sales history stay deactivated forever). Leads they still
  // hold are moved to body.reassign_to (an ACTIVE advisor) in the same transaction.
  app.delete("/:id", async (req) => {
    const viewer = requireSuperAdmin(req);
    const { id } = req.params as { id: string };
    const input = parse(deleteUserSchema, req.body ?? {});

    const [target] = await db
      .select({ id: users.id, role: users.role, active: users.active, avatarKey: users.avatarKey })
      .from(users)
      .where(and(eq(users.id, id), eq(users.orgId, viewer.orgId)))
      .limit(1);
    if (!target) throw notFound("User not found");
    if (target.role !== "advisor") throw forbidden("Only advisors can be deleted");
    if (target.active) {
      throw unprocessable("Deactivate this advisor first — only former Smart Advisors can be deleted", "still_active");
    }

    const countRows = { n: dsql<number>`count(*)::int` };
    const first = (rows: { n: number }[]) => rows[0]?.n ?? 0;
    const [inPipeline, quoteCount, saleCount, revenueCount, leadCount] = await Promise.all([
      db.select(countRows).from(opportunities).where(eq(opportunities.advisorId, id)).then(first),
      db.select(countRows).from(quotes).where(eq(quotes.advisorId, id)).then(first),
      db.select(countRows).from(transactions).where(eq(transactions.advisorId, id)).then(first),
      db.select(countRows).from(smartplanTransactions).where(eq(smartplanTransactions.advisorId, id)).then(first),
      db.select(countRows).from(leads).where(eq(leads.assignedAdvisorId, id)).then(first),
    ]);

    const blockers = [
      inPipeline ? `${inPipeline} pipeline account(s)` : null,
      quoteCount ? `${quoteCount} quote(s)` : null,
      saleCount ? `${saleCount} commission record(s)` : null,
      revenueCount ? `${revenueCount} SmartPlan revenue record(s)` : null,
    ].filter(Boolean);
    if (blockers.length > 0) {
      throw conflict(
        `This advisor still has ${blockers.join(", ")}. Reassign their pipeline first — advisors with sales history should stay deactivated instead of being deleted.`,
        "has_records",
      );
    }

    let reassignTo: string | null = null;
    if (leadCount > 0) {
      if (!input.reassign_to) {
        throw unprocessable(
          `This advisor still holds ${leadCount} lead(s) — choose an active Smart Advisor to take them over`,
          "reassign_required",
        );
      }
      if (input.reassign_to === id) throw badRequest("Leads can't go to the advisor being deleted", "bad_advisor");
      const [ok] = await db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.id, input.reassign_to), eq(users.orgId, viewer.orgId), eq(users.role, "advisor"), eq(users.active, true)))
        .limit(1);
      if (!ok) throw badRequest("Choose an active Smart Advisor to take over the leads", "bad_advisor");
      reassignTo = input.reassign_to;
    }

    await db.transaction(async (tx) => {
      if (reassignTo) {
        await tx
          .update(leads)
          .set({ assignedAdvisorId: reassignTo, updatedAt: new Date() })
          .where(and(eq(leads.assignedAdvisorId, id), eq(leads.orgId, viewer.orgId)));
      } else {
        // leads have no FK to users — re-check inside the transaction so a lead
        // assigned between the count above and here can't be orphaned silently.
        const still = first(await tx.select(countRows).from(leads).where(eq(leads.assignedAdvisorId, id)));
        if (still > 0) {
          throw unprocessable(
            `This advisor just received ${still} lead(s) — choose an active Smart Advisor to take them over`,
            "reassign_required",
          );
        }
      }
      await tx.delete(users).where(and(eq(users.id, id), eq(users.orgId, viewer.orgId)));
    });

    // Row is gone; the avatar blob is app-managed storage, so clean it up too.
    if (target.avatarKey) await storage.delete(target.avatarKey);
    return { ok: true, reassignedLeads: leadCount };
  });

  // POST /api/users/:id/resend-invite — super admin only.
  app.post("/:id/resend-invite", async (req) => {
    const viewer = requireSuperAdmin(req);
    const { id } = req.params as { id: string };
    const [target] = await db
      .select({ id: users.id, email: users.email, fullName: users.fullName, passwordHash: users.passwordHash })
      .from(users)
      .where(and(eq(users.id, id), eq(users.orgId, viewer.orgId)))
      .limit(1);
    if (!target) throw notFound("User not found");
    if (target.passwordHash) throw badRequest("User has already set a password", "already_active");
    await issueInvite(target.id, target.email, target.fullName);
    return { ok: true };
  });
}
