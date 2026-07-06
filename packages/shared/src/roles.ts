import { z } from "zod";

/** The three roles (§3). Account creation is super_admin-only — enforced server-side. */
export const ROLES = ["super_admin", "manager", "advisor"] as const;
export const roleSchema = z.enum(ROLES);
export type Role = (typeof ROLES)[number];

/** Roles with full operational visibility (commission, all advisors, reports). */
export function isManagerial(role: Role): boolean {
  return role === "super_admin" || role === "manager";
}

/** Only super_admin may create accounts or manage managers/super admins (§3.2, §11.4). */
export function canCreateUsers(role: Role): boolean {
  return role === "super_admin";
}

/** Who a given role is allowed to edit/deactivate. */
export function canEditUser(actor: Role, target: Role): boolean {
  if (actor === "super_admin") return true;
  // Managers may edit advisors only — never managers or super admins (§3.2).
  if (actor === "manager") return target === "advisor";
  return false;
}

/** Commission figures must never reach an advisor (§11.1). */
export function canSeeCommission(role: Role): boolean {
  return isManagerial(role);
}
