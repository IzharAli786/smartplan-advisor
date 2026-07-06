import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { db, organizations } from "@smart-crm/db";
import { resolveUser } from "../auth/context.js";
import { storage } from "../lib/storage.js";

/**
 * Branding read for the portal. Logos are PER-ORGANIZATION, so this resolves the caller's
 * org from the session cookie (optional auth — the login screen calls it before signing in).
 * Signed-out callers get the default SmartPlan mark (null → UI falls back). Returns short-lived
 * signed URLs:
 *   - lightLogoUrl: logo for light backgrounds (light mode, login)
 *   - darkLogoUrl:  logo for dark backgrounds (the navy sidebar, dark mode)
 */
export async function registerBrandingRoutes(app: FastifyInstance) {
  app.get("/api/branding", async (req) => {
    const user = await resolveUser(req);
    if (!user) return { lightLogoUrl: null, darkLogoUrl: null };

    const [org] = await db
      .select({ light: organizations.lightLogoKey, dark: organizations.darkLogoKey })
      .from(organizations)
      .where(eq(organizations.id, user.orgId))
      .limit(1);

    return {
      lightLogoUrl: org?.light ? storage.signedUrl(org.light, 3600) : null,
      darkLogoUrl: org?.dark ? storage.signedUrl(org.dark, 3600) : null,
    };
  });
}
