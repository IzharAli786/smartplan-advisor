import { useState } from "react";
import { useApi } from "../hooks/useApi.ts";
import { api, ApiError } from "../api/client.ts";
import { Icon } from "./Icon.tsx";
import RichTextEditor from "./RichTextEditor.tsx";
import { EMAIL_TAGS, resolveTags, type TagContext } from "../lib/emailTags.ts";
import type { EmailAttachment, EmailTemplate } from "../api/types.ts";

/**
 * Compose an email to a prospect from a saved template. Picking a template fills the
 * fields with personalization tags resolved; the advisor can amend anything before sending.
 */
export default function EmailComposer({
  to: initialTo,
  ctx,
  opportunityId,
  contactId,
  onClose,
  onSent,
}: {
  to: string;
  ctx: TagContext;
  opportunityId?: string;
  contactId?: string;
  onClose: () => void;
  onSent?: () => void;
}) {
  const { data } = useApi<{ templates: EmailTemplate[] }>("/api/email-templates");
  const templates = (data?.templates ?? []).filter((t) => t.active);

  const [templateId, setTemplateId] = useState("");
  const [to, setTo] = useState(initialTo);
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [attachments, setAttachments] = useState<EmailAttachment[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function applyTemplate(id: string) {
    setTemplateId(id);
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    if (t.cc) setCc(resolveTags(t.cc, ctx));
    if (t.bcc) setBcc(resolveTags(t.bcc, ctx));
    setSubject(resolveTags(t.subject, ctx));
    setBody(resolveTags(t.bodyHtml, ctx));
    setAttachments(t.attachments ?? []);
  }

  async function send() {
    setSending(true);
    setError(null);
    try {
      const res = await api.post<{ ok: boolean; status: string }>("/api/emails/send", {
        to,
        cc: cc || undefined,
        bcc: bcc || undefined,
        subject,
        html: body,
        opportunity_id: opportunityId,
        contact_id: contactId,
        attachments,
      });
      if (res.status === "failed") {
        setError("The email provider rejected the send. Check the server mail settings.");
      } else {
        setDone(true);
        onSent?.();
        setTimeout(onClose, 900);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not send");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ marginBottom: ".5rem" }}>
          <h3 style={{ display: "flex", alignItems: "center", gap: ".4rem" }}>
            <Icon name="mail" size={18} /> Compose email
          </h3>
          <button className="btn small ghost" onClick={onClose}><Icon name="x" size={16} /></button>
        </div>

        {done ? (
          <div className="success-banner">Email sent ✓</div>
        ) : (
          <>
            <ErrorLine error={error} />
            <div className="field">
              <label>Start from a template</label>
              <select value={templateId} onChange={(e) => applyTemplate(e.target.value)}>
                <option value="">{templates.length ? "Choose a template…" : "No templates — create them in Settings"}</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
            <div className="field"><label>To</label><input type="email" value={to} onChange={(e) => setTo(e.target.value)} /></div>
            <div className="row" style={{ gap: ".5rem" }}>
              <div className="field" style={{ flex: 1 }}><label>CC</label><input value={cc} onChange={(e) => setCc(e.target.value)} /></div>
              <div className="field" style={{ flex: 1 }}><label>BCC</label><input value={bcc} onChange={(e) => setBcc(e.target.value)} /></div>
            </div>
            <div className="field"><label>Subject</label><input value={subject} onChange={(e) => setSubject(e.target.value)} /></div>
            <div className="field">
              <label>Body</label>
              <RichTextEditor value={body} onChange={setBody} tags={EMAIL_TAGS} minHeight={180} />
            </div>
            {attachments.length > 0 && (
              <div className="field">
                <label>Attachments</label>
                {attachments.map((a) => (
                  <div key={a.key} className="row" style={{ padding: "3px 0" }}>
                    <span style={{ fontSize: ".85rem", display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <Icon name="paperclip" size={14} /> {a.filename}
                    </span>
                    <button type="button" className="btn small ghost" onClick={() => setAttachments((as) => as.filter((x) => x.key !== a.key))}>
                      <Icon name="x" size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <button className="btn full" disabled={sending || !to || !subject} onClick={send}>
              <Icon name="send" size={16} /> {sending ? "Sending…" : "Send email"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function ErrorLine({ error }: { error: string | null }) {
  if (!error) return null;
  return <div className="error-banner" style={{ marginBottom: ".5rem" }}>{error}</div>;
}
