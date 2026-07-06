import type { FastifyRequest } from "fastify";
import { isManagerial, canCreateUsers, type Role } from "@smart-crm/shared";
import { forbidden, unauthorized } from "../lib/errors.js";

/** Returns the authenticated user or throws 401. Use after the `authenticate` preHandler. */
export function requireUser(req: FastifyRequest) {
  if (!req.user) throw unauthorized();
  return req.user;
}

/** Throw 403 unless the user has one of the allowed roles. */
export function requireRole(req: FastifyRequest, ...roles: Role[]) {
  const user = requireUser(req);
  if (!roles.includes(user.role)) throw forbidden();
  return user;
}

/** Manager or super_admin (full operational visibility). */
export function requireManagerial(req: FastifyRequest) {
  const user = requireUser(req);
  if (!isManagerial(user.role)) throw forbidden();
  return user;
}

/** Super admin only — account creation + manager management (§3.2, §11.4). */
export function requireSuperAdmin(req: FastifyRequest) {
  const user = requireUser(req);
  if (!canCreateUsers(user.role)) throw forbidden();
  return user;
}
