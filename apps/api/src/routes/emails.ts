import type { FastifyInstance } from "fastify";
import { emailSendSchema } from "@smart-crm/shared";
import { parse } from "../lib/validate.js";
import { authenticate } from "../auth/context.js";
import { requireUser } from "../auth/guards.js";
import { mailer, type EmailAttachmentContent } from "../lib/mailer.js";
import { storage } from "../lib/storage.js";
import { recordCommunication } from "../services/communications.js";

export async function registerEmailRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);

  // POST /api/emails/send — send an email composed (from a template) to a prospect.
  app.post("/send", async (req) => {
    const user = requireUser(req);
    const input = parse(emailSendSchema, req.body);

    // Load attachment bytes from storage (skip any that can't be read rather than fail the send).
    const attachments: EmailAttachmentContent[] = [];
    for (const a of input.attachments ?? []) {
      const blob = await storage.get(a.key);
      if (blob) attachments.push({ filename: a.filename, content: blob.data });
    }

    const sent = await mailer.sendEmail({
      to: input.to,
      cc: input.cc ?? null,
      bcc: input.bcc ?? null,
      subject: input.subject,
      html: input.html ?? "",
      attachments,
    });

    await recordCommunication({
      orgId: user.orgId,
      toEmail: input.to,
      subject: input.subject,
      kind: "email",
      opportunityId: input.opportunity_id ?? null,
      advisorId: user.id,
      provider: sent.provider,
      providerMessageId: sent.id,
      status: sent.status,
    });

    return { ok: sent.status === "sent", provider: sent.provider, status: sent.status };
  });
}
