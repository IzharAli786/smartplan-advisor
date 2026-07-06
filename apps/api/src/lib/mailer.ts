import { mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { env } from "../env.js";

/**
 * Mailer behind one interface (build plan §1). The dev driver logs to the console + an
 * outbox file; the Resend driver sends real email via the Resend HTTP API. Select with
 * MAILER_DRIVER=resend + RESEND_API_KEY. Every send returns where/how it went so callers
 * can record it in the communications log.
 */
export interface SentResult {
  provider: string;
  id: string | null;
  status: "sent" | "failed";
}

export interface EmailAttachmentContent {
  filename: string;
  content: Buffer;
}
export interface SendEmailOptions {
  to: string;
  cc?: string | null;
  bcc?: string | null;
  subject: string;
  html: string;
  attachments?: EmailAttachmentContent[];
}

export interface Mailer {
  sendInvite(to: string, name: string, link: string): Promise<SentResult>;
  sendReset(to: string, link: string): Promise<SentResult>;
  sendQuote(to: string, name: string, quoteNumber: string, link: string): Promise<SentResult>;
  sendEmail(opts: SendEmailOptions): Promise<SentResult>;
}

const splitList = (v?: string | null) =>
  (v ?? "")
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);

function quoteHtml(name: string, quoteNumber: string, link: string) {
  return `<p>Hi ${name},</p><p>Your SmartPlan quote <strong>${quoteNumber}</strong> is ready to review and sign:</p><p><a href="${link}">${link}</a></p>`;
}

class DevMailer implements Mailer {
  private outbox = join(env.storageLocalDir, "outbox.log");

  private write(subject: string, to: string, body: string): SentResult {
    const line = `\n=== ${new Date().toISOString()} ===\nTo: ${to}\nFrom: ${env.mailFrom}\nSubject: ${subject}\n${body}\n`;
    try {
      mkdirSync(env.storageLocalDir, { recursive: true });
      appendFileSync(this.outbox, line);
    } catch {
      /* best effort */
    }
    console.log(`[mailer:dev] ${subject} -> ${to}\n  ${body.split("\n").join("\n  ")}`);
    return { provider: "dev", id: null, status: "sent" };
  }

  async sendInvite(to: string, name: string, link: string) {
    return this.write("You're invited to SmartPlan Advisor CRM", to, `Hi ${name},\nSet your password to get started:\n${link}\n(Link expires in 7 days.)`);
  }
  async sendReset(to: string, link: string) {
    return this.write("Reset your SmartPlan CRM password", to, `Reset your password:\n${link}\n(Link expires in 1 hour.)`);
  }
  async sendQuote(to: string, name: string, quoteNumber: string, link: string) {
    return this.write(`Your SmartPlan quote ${quoteNumber}`, to, `Hi ${name},\nYour quote is ready to review and sign:\n${link}`);
  }
  async sendEmail(opts: SendEmailOptions) {
    const meta = [
      opts.cc ? `Cc: ${opts.cc}` : "",
      opts.bcc ? `Bcc: ${opts.bcc}` : "",
      opts.attachments?.length ? `Attachments: ${opts.attachments.map((a) => a.filename).join(", ")}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    return this.write(opts.subject, opts.to, `${meta ? meta + "\n" : ""}${opts.html}`);
  }
}

class ResendMailer implements Mailer {
  constructor(private apiKey: string) {}

  private async send(to: string, subject: string, html: string, text: string): Promise<SentResult> {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: env.mailFrom, to, subject, html, text }),
      });
      if (!res.ok) {
        console.error(`[mailer:resend] ${res.status} sending "${subject}" -> ${to}: ${await res.text()}`);
        return { provider: "resend", id: null, status: "failed" };
      }
      const data = (await res.json()) as { id?: string };
      return { provider: "resend", id: data.id ?? null, status: "sent" };
    } catch (err) {
      console.error("[mailer:resend] network error", err);
      return { provider: "resend", id: null, status: "failed" };
    }
  }

  async sendInvite(to: string, name: string, link: string) {
    return this.send(to, "You're invited to SmartPlan Advisor CRM", `<p>Hi ${name},</p><p>Set your password to get started:</p><p><a href="${link}">${link}</a></p><p>Link expires in 7 days.</p>`, `Hi ${name}, set your password: ${link} (expires in 7 days)`);
  }
  async sendReset(to: string, link: string) {
    return this.send(to, "Reset your SmartPlan CRM password", `<p>Reset your password:</p><p><a href="${link}">${link}</a></p><p>Link expires in 1 hour.</p>`, `Reset your password: ${link} (expires in 1 hour)`);
  }
  async sendQuote(to: string, name: string, quoteNumber: string, link: string) {
    return this.send(to, `Your SmartPlan quote ${quoteNumber}`, quoteHtml(name, quoteNumber, link), `Hi ${name}, your quote ${quoteNumber} is ready: ${link}`);
  }

  async sendEmail(opts: SendEmailOptions): Promise<SentResult> {
    try {
      const payload: Record<string, unknown> = { from: env.mailFrom, to: opts.to, subject: opts.subject, html: opts.html };
      const cc = splitList(opts.cc);
      const bcc = splitList(opts.bcc);
      if (cc.length) payload.cc = cc;
      if (bcc.length) payload.bcc = bcc;
      if (opts.attachments?.length) payload.attachments = opts.attachments.map((a) => ({ filename: a.filename, content: a.content.toString("base64") }));
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        console.error(`[mailer:resend] ${res.status} sending "${opts.subject}" -> ${opts.to}: ${await res.text()}`);
        return { provider: "resend", id: null, status: "failed" };
      }
      const data = (await res.json()) as { id?: string };
      return { provider: "resend", id: data.id ?? null, status: "sent" };
    } catch (err) {
      console.error("[mailer:resend] network error", err);
      return { provider: "resend", id: null, status: "failed" };
    }
  }
}

export const mailer: Mailer =
  env.mailerDriver === "resend" && env.resendApiKey ? new ResendMailer(env.resendApiKey) : new DevMailer();
