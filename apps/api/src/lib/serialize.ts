import { canSeeCommission, type Role } from "@smart-crm/shared";
import { storage } from "./storage.js";

/**
 * P0 RISK #1 (§11.1): commission figures must NEVER reach an advisor's browser.
 * Enforced HERE, server-side, by role — not hidden in the UI. Every response that
 * could carry a commission value passes through one of these serializers, so an
 * advisor-scoped response physically cannot contain the field.
 *
 * Assume advisors can read their own network traffic.
 */

export interface UserRow {
  id: string;
  role: Role;
  fullName: string;
  email: string;
  phone: string | null;
  phone2: string | null;
  address: string | null;
  startDate: string | null;
  referralLink?: string | null;
  enrolledDate?: string | null;
  referredBy?: string | null;
  notes: string | null;
  statesCovered: string[];
  avatarKey?: string | null;
  currentCommissionRate: string | null;
  monthlyQuota: string | null;
  apolloCreditAllowanceMonthly: number | null;
  active: boolean;
  passwordHash?: string | null;
  invitedAt?: Date | null;
  createdAt?: Date;
}

/** Derive the roster status (§3.2): active / invited / deactivated. */
function userStatus(row: UserRow): "active" | "invited" | "deactivated" {
  if (!row.active) return "deactivated";
  if (!row.passwordHash) return "invited";
  return "active";
}

export function serializeUser(row: UserRow, viewerRole: Role) {
  const base = {
    id: row.id,
    role: row.role,
    fullName: row.fullName,
    email: row.email,
    phone: row.phone,
    phone2: row.phone2,
    address: row.address,
    startDate: row.startDate,
    referralLink: row.referralLink ?? null,
    enrolledDate: row.enrolledDate ?? null,
    referredBy: row.referredBy ?? null,
    statesCovered: row.statesCovered,
    avatarUrl: row.avatarKey ? storage.signedUrl(row.avatarKey, 3600) : null,
    monthlyQuota: row.monthlyQuota === null ? null : Number(row.monthlyQuota),
    apolloCreditAllowanceMonthly: row.apolloCreditAllowanceMonthly,
    active: row.active,
    status: userStatus(row),
  };
  if (!canSeeCommission(viewerRole)) return base;
  // Managerial-only: commission + internal notes about the advisor.
  return {
    ...base,
    currentCommissionRate: row.currentCommissionRate === null ? null : Number(row.currentCommissionRate),
    notes: row.notes,
  };
}

export interface TransactionRow {
  id: string;
  opportunityId: string;
  advisorId: string;
  convertedAt: Date;
  dealValue: string;
  commissionRateSnapshot: string;
  commissionAmount: string;
  commissionTierLabel: string | null;
}

/** Transactions are manager-only in v1, but strip defensively in case of reuse. */
export function serializeTransaction(row: TransactionRow, viewerRole: Role) {
  const base = {
    id: row.id,
    opportunityId: row.opportunityId,
    advisorId: row.advisorId,
    convertedAt: row.convertedAt,
    dealValue: Number(row.dealValue),
  };
  if (!canSeeCommission(viewerRole)) return base;
  return {
    ...base,
    commissionRateSnapshot: Number(row.commissionRateSnapshot),
    commissionAmount: Number(row.commissionAmount),
    commissionTierLabel: row.commissionTierLabel,
  };
}
