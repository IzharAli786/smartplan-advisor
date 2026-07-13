import type { FastifyInstance } from "fastify";
import { and, eq, gt, isNull, sql as dsql } from "drizzle-orm";
import { db, users, userTokens, organizations } from "@smart-crm/db";
import { loginSchema, setPasswordSchema, forgotPasswordSchema, registerSchema } from "@smart-crm/shared";
import { parse } from "../lib/validate.js";
import { unauthorized, badRequest, conflict } from "../lib/errors.js";
import { provisionOrg } from "../services/provision.js";
import { verifyPassword, hashPassword, hashToken, generateToken } from "../auth/password.js";
import { signSession } from "../auth/jwt.js";
import { authenticate, setSessionCookie, clearSessionCookie } from "../auth/context.js";
import { serializeUser, type UserRow } from "../lib/serialize.js";
import { mailer } from "../lib/mailer.js";
import { syncSuperAdminToSmartPlan } from "../services/smartplan-sync.js";
import { env } from "../env.js";

const selfColumns = {
  id: users.id,
  orgId: users.orgId,
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
  statesCovered: users.statesCovered,
  avatarKey: users.avatarKey,
  currentCommissionRate: users.currentCommissionRate,
  monthlyQuota: users.monthlyQuota,
  apolloCreditAllowanceMonthly: users.apolloCreditAllowanceMonthly,
  active: users.active,
  passwordHash: users.passwordHash,
  sessionVersion: users.sessionVersion,
};

/** The org's display preferences (currency + date format) — sent to the client so
 *  money and dates render in the format chosen at registration. */
async function orgPrefs(orgId: string) {
  const [org] = await db
    .select({ id: organizations.id, name: organizations.name, currency: organizations.currency, dateFormat: organizations.dateFormat })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);
  return org ? { id: org.id, name: org.name, currency: org.currency, dateFormat: org.dateFormat } : null;
}

export async function registerAuthRoutes(app: FastifyInstance) {
  // POST /api/auth/register — a new business signs up: creates an isolated organization,
  // its first admin (super_admin), seeds default pipeline/products/stages, and logs in.
  app.post("/register", async (req, reply) => {
    const input = parse(registerSchema, req.body);

    const [dupe] = await db
      .select({ id: users.id })
      .from(users)
      .where(dsql`lower(${users.email}) = lower(${input.email})`)
      .limit(1);
    if (dupe) throw conflict("An account with that email already exists — try signing in", "email_taken");

    const [org] = await db
      .insert(organizations)
      .values({ name: input.company_name, currency: input.currency, dateFormat: input.date_format })
      .returning({ id: organizations.id });
    await provisionOrg(org!.id);

    const passwordHash = await hashPassword(input.password);
    const [created] = await db
      .insert(users)
      .values({
        orgId: org!.id,
        role: "super_admin",
        fullName: input.full_name,
        email: input.email,
        passwordHash,
        active: true,
      })
      .returning(selfColumns);

    const token = signSession({ sub: created!.id, role: created!.role, sv: created!.sessionVersion });
    setSessionCookie(reply, token);
    return { user: serializeUser(created as UserRow, created!.role), org: await orgPrefs(org!.id) };
  });

  // POST /api/auth/login — one screen for all roles (§3.1).
  app.post("/login", async (req, reply) => {
    const { email, password } = parse(loginSchema, req.body);
    const [row] = await db
      .select(selfColumns)
      .from(users)
      .where(dsql`lower(${users.email}) = lower(${email})`)
      .limit(1);

    if (!row || !row.active || !row.passwordHash) throw unauthorized("Invalid email or password");
    const ok = await verifyPassword(password, row.passwordHash);
    if (!ok) throw unauthorized("Invalid email or password");

    const token = signSession({ sub: row.id, role: row.role, sv: row.sessionVersion });
    setSessionCookie(reply, token);

    // Keep the SmartPlan Eco-Admin mirror of this super admin fresh (and
    // backfill admins that predate the mirror). Fire-and-forget.
    if (row.role === "super_admin") void syncSuperAdminToSmartPlan(row.id);

    return { user: serializeUser(row as UserRow, row.role), org: await orgPrefs(row.orgId) };
  });

  // POST /api/auth/logout
  app.post("/logout", async (_req, reply) => {
    clearSessionCookie(reply);
    return { ok: true };
  });

  // GET /api/auth/me — current session's user.
  app.get("/me", { preHandler: authenticate }, async (req) => {
    const [row] = await db.select(selfColumns).from(users).where(eq(users.id, req.user!.id)).limit(1);
    if (!row) throw unauthorized();
    return { user: serializeUser(row as UserRow, row.role), org: await orgPrefs(row.orgId) };
  });

  // POST /api/auth/set-password — first-use invite + reset flows (§3.1).
  app.post("/set-password", async (req) => {
    const { token, password } = parse(setPasswordSchema, req.body);
    const tokenHash = hashToken(token);
    const [tok] = await db
      .select()
      .from(userTokens)
      .where(and(eq(userTokens.tokenHash, tokenHash), isNull(userTokens.usedAt), gt(userTokens.expiresAt, new Date())))
      .limit(1);
    if (!tok) throw badRequest("This link is invalid or has expired", "bad_token");

    const passwordHash = await hashPassword(password);
    await db.transaction(async (tx) => {
      // Bump session_version to revoke any existing sessions on password change.
      await tx
        .update(users)
        .set({ passwordHash, sessionVersion: dsql`${users.sessionVersion} + 1`, updatedAt: new Date() })
        .where(eq(users.id, tok.userId));
      await tx.update(userTokens).set({ usedAt: new Date() }).where(eq(userTokens.id, tok.id));
    });

    // If this user is a super admin, mirror the new credentials into the
    // SmartPlan Eco-Admin so the same login works there. Fire-and-forget;
    // the service itself checks the role.
    void syncSuperAdminToSmartPlan(tok.userId);

    return { ok: true };
  });

  // POST /api/auth/forgot-password — always returns ok (no account enumeration).
  app.post("/forgot-password", async (req) => {
    const { email } = parse(forgotPasswordSchema, req.body);
    const [row] = await db
      .select({ id: users.id, fullName: users.fullName, active: users.active })
      .from(users)
      .where(dsql`lower(${users.email}) = lower(${email})`)
      .limit(1);

    if (row && row.active) {
      const { raw, hash } = generateToken();
      const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
      await db.insert(userTokens).values({ userId: row.id, tokenHash: hash, purpose: "reset", expiresAt: expires });
      const link = `${env.webOrigins[0]}/set-password?token=${raw}`;
      await mailer.sendReset(email, link);
    }
    return { ok: true };
  });
}
