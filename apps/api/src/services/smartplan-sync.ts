import { eq } from "drizzle-orm";
import { db, users } from "@smart-crm/db";
import { env } from "../env.js";

/**
 * Mirror an Advise SUPER ADMIN into SmartPlan's Eco-Admin (admin_users table)
 * so the same email + password also works at SmartPlan's /eco-admin/login.
 *
 * Only the bcrypt HASH ever leaves this server — both apps hash with bcryptjs,
 * so the mirrored hash verifies identically over there. Transport is HTTPS,
 * guarded by the same shared secret as the SmartPlan→Advise ingest
 * (SMARTPLAN_INGEST_SECRET here === ADVISE_INGEST_SECRET on the SmartPlan box).
 *
 * Called fire-and-forget from: successful super-admin login (keeps the mirror
 * fresh and backfills admins that existed before this feature), set-password
 * (invite/reset), and managerial PATCH edits. Never throws; a failed mirror
 * only logs — Advise auth must never depend on SmartPlan being up.
 */
export async function syncSuperAdminToSmartPlan(userId: string): Promise<void> {
  try {
    if (!env.smartplanIngestSecret || !env.smartplanAppUrl) return;
    const [u] = await db
      .select({
        role: users.role,
        email: users.email,
        fullName: users.fullName,
        passwordHash: users.passwordHash,
        active: users.active,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    // Only super admins with a set password are mirrored.
    if (!u || u.role !== "super_admin" || !u.passwordHash) return;

    const res = await fetch(`${env.smartplanAppUrl}/api/eco-admin/sync-admin`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-ingest-secret": env.smartplanIngestSecret },
      body: JSON.stringify({
        email: u.email,
        name: u.fullName,
        password_hash: u.passwordHash,
        active: u.active,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`SmartPlan /api/eco-admin/sync-admin responded ${res.status}: ${text.slice(0, 200)}`);
    }
    console.log(`[smartplan-sync] eco-admin login mirrored for ${u.email}`);
  } catch (err) {
    console.error(`[smartplan-sync] eco-admin mirror failed for user ${userId}:`, err);
  }
}
