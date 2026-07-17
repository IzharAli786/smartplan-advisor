import Fastify from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { ZodError } from "zod";
import { env } from "./env.js";
import { HttpError } from "./lib/errors.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerBrandingRoutes } from "./routes/branding.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerUserRoutes } from "./routes/users.js";
import { registerSettingsRoutes } from "./routes/settings.js";
import { registerOpportunityRoutes } from "./routes/opportunities.js";
import { registerClaimRoutes } from "./routes/claims.js";
import { registerNotificationRoutes } from "./routes/notifications.js";
import { registerTodayRoutes } from "./routes/today.js";
import { registerDashboardRoutes } from "./routes/dashboard.js";
import { registerReportRoutes } from "./routes/reports.js";
import { registerCollateralRoutes } from "./routes/collateral.js";
import { registerFileRoutes } from "./routes/files.js";
import { registerQuoteRoutes } from "./routes/quotes.js";
import { registerContactRoutes } from "./routes/contacts.js";
import { registerEmailTemplateRoutes } from "./routes/email-templates.js";
import { registerEmailRoutes } from "./routes/emails.js";
import { registerImportRoutes } from "./routes/imports.js";
import { registerLeadRoutes } from "./routes/leads.js";
import { registerPerformanceRoutes } from "./routes/performance.js";
import { registerHighFiveRoutes } from "./routes/high-fives.js";
import { registerSmartPlanTxnRoutes } from "./routes/smartplan-transactions.js";
import { registerPublicQuoteRoutes } from "./routes/public-quotes.js";
import { registerFeedbackRoutes } from "./routes/feedback.js";

export async function buildApp() {
  const app = Fastify({
    logger: { level: env.isProd ? "info" : "warn" },
    bodyLimit: 1024 * 1024, // 1MB JSON; uploads use multipart
  });

  await app.register(cors, {
    origin: env.webOrigins,
    credentials: true, // allow the session cookie cross-origin in dev
  });
  await app.register(cookie, { secret: env.authSecret });
  await app.register(multipart, { limits: { fileSize: 200 * 1024 * 1024 } }); // 200MB collateral

  // Uniform error shape. Validation + typed HttpError + unexpected.
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof HttpError) {
      return reply.code(err.statusCode).send({ error: err.message, code: err.code });
    }
    if (err instanceof ZodError) {
      const issue = err.issues[0];
      return reply.code(400).send({ error: issue?.message ?? "Invalid input", code: "validation" });
    }
    // Honour Fastify's own client errors (415 unsupported media type, 413 too large, etc.)
    const status = (err as { statusCode?: number }).statusCode;
    if (typeof status === "number" && status >= 400 && status < 500) {
      return reply.code(status).send({ error: (err as Error).message, code: (err as { code?: string }).code ?? "request_error" });
    }
    app.log.error(err);
    return reply.code(500).send({ error: "Internal server error", code: "internal" });
  });

  await app.register(registerHealthRoutes);
  await app.register(registerBrandingRoutes);
  await app.register(registerAuthRoutes, { prefix: "/api/auth" });
  await app.register(registerUserRoutes, { prefix: "/api/users" });
  await app.register(registerSettingsRoutes, { prefix: "/api/settings" });
  await app.register(registerOpportunityRoutes, { prefix: "/api/opportunities" });
  await app.register(registerClaimRoutes, { prefix: "/api/claim-requests" });
  await app.register(registerNotificationRoutes, { prefix: "/api/notifications" });
  await app.register(registerTodayRoutes, { prefix: "/api/today" });
  await app.register(registerDashboardRoutes, { prefix: "/api/dashboard" });
  await app.register(registerReportRoutes, { prefix: "/api/reports" });
  await app.register(registerCollateralRoutes, { prefix: "/api/collateral" });
  await app.register(registerQuoteRoutes, { prefix: "/api/quotes" });
  await app.register(registerContactRoutes, { prefix: "/api/contacts" });
  await app.register(registerEmailTemplateRoutes, { prefix: "/api/email-templates" });
  await app.register(registerEmailRoutes, { prefix: "/api/emails" });
  await app.register(registerImportRoutes, { prefix: "/api/imports" });
  await app.register(registerLeadRoutes, { prefix: "/api/leads" });
  await app.register(registerPerformanceRoutes, { prefix: "/api/performance" });
  await app.register(registerHighFiveRoutes, { prefix: "/api/high-fives" });
  await app.register(registerSmartPlanTxnRoutes, { prefix: "/api/smartplan-transactions" });
  await app.register(registerFeedbackRoutes, { prefix: "/api/feedback" });
  await app.register(registerPublicQuoteRoutes); // /api/public/quotes/:token — NO auth
  await app.register(registerFileRoutes); // /files/:key

  return app;
}
