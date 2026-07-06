import type { FastifyReply, FastifyRequest } from "fastify";
import { eq } from "drizzle-orm";
import { db, users } from "@smart-crm/db";
import type { Role } from "@smart-crm/shared";
import { env, SESSION_COOKIE } from "../env.js";
import { verifySession } from "./jwt.js";
import { unauthorized } from "../lib/errors.js";

export interface CurrentUser {
  id: string;
  orgId: string;
  role: Role;
  fullName: string;
  statesCovered: string[];
}

declare module "fastify" {
  interface FastifyRequest {
    user?: CurrentUser;
  }
}

/**
 * Resolve the current user from the session cookie. Verifies the JWT, then re-checks
 * the live user row: session_version must match (revocation) and the account must be
 * active. Role is read from the DB row — never trusted from the client (§11).
 */
export async function resolveUser(req: FastifyRequest): Promise<CurrentUser | null> {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return null;
  const claims = verifySession(token);
  if (!claims) return null;

  const [row] = await db
    .select({
      id: users.id,
      orgId: users.orgId,
      role: users.role,
      fullName: users.fullName,
      statesCovered: users.statesCovered,
      sessionVersion: users.sessionVersion,
      active: users.active,
    })
    .from(users)
    .where(eq(users.id, claims.sub))
    .limit(1);

  if (!row || !row.active || row.sessionVersion !== claims.sv) return null;
  return {
    id: row.id,
    orgId: row.orgId,
    role: row.role,
    fullName: row.fullName,
    statesCovered: row.statesCovered ?? [],
  };
}

/** preHandler: require a valid session or 401. Attaches req.user. */
export async function authenticate(req: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const user = await resolveUser(req);
  if (!user) throw unauthorized();
  req.user = user;
}

export function setSessionCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.cookieSecure,
    path: "/",
    maxAge: env.sessionTtlHours * 3600,
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: "/" });
}
