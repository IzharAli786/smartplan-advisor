import { useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useApi } from "../hooks/useApi.ts";
import { api, ApiError } from "../api/client.ts";
import { Card, EmptyState, ErrorBanner, PageHead, Spinner } from "../components/ui.tsx";
import { Icon } from "../components/Icon.tsx";
import RichTextEditor from "../components/RichTextEditor.tsx";
import { EMAIL_TAGS } from "../lib/emailTags.ts";
import type { EmailAttachment, EmailTemplate } from "../api/types.ts";

const emptyForm = { name: "", subject: "", cc: "", bcc: "", body_html: "", attachments: [] as EmailAttachment[], active: true };

export default function EmailTemplatesPage() {
  const { data, loading, error, reload } = useApi<{ templates: EmailTemplate[] }>("/api/email-templates");
  const templates = data?.templates ?? [];
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function openNew() {
    setForm(emptyForm);
    setEditing("new");
    setFormError(null);
  }
  function openEdit(t: EmailTemplate) {
    setForm({ name: t.name, subject: t.subject, cc: t.cc ?? "", bcc: t.bcc ?? "", body_html: t.bodyHtml, attachments: t.attachments ?? [], active: t.active });
    setEditing(t.id);
    setFormError(null);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      if (editing === "new") await api.post("/api/email-templates", { ...form, sort_order: templates.length + 1 });
      else await api.patch(`/api/email-templates/${editing}`, form);
      setEditing(null);
      reload();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  async function remove(t: EmailTemplate) {
    if (!window.confirm(`Delete template “${t.name}”?`)) return;
    await api.delete(`/api/email-templates/${t.id}`);
    if (editing === t.id) setEditing(null);
    reload();
  }

  async function onAttach(file: File) {
    setBusy(true);
    setFormError(null);
    try {
      const fd = new FormData();
      fd.set("file", file, file.name);
      const res = await api.upload<{ attachment: EmailAttachment }>("/api/email-templates/attachment", fd);
      setForm((f) => ({ ...f, attachments: [...f.attachments, res.attachment] }));
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <Link to="/settings" className="muted" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
        <Icon name="chevron-left" size={16} /> Settings
      </Link>
      <PageHead
        title="Email Templates"
        subtitle="Reusable emails your advisors can send to a prospect — with personalization tags, CC/BCC and attachments"
        actions={
          <button className="btn" onClick={openNew}>
            <Icon name="plus" size={16} /> New template
          </button>
        }
      />

      {editing && (
        <Card>
          <div className="row">
            <h3>{editing === "new" ? "New template" : "Edit template"}</h3>
            <button className="btn small ghost" onClick={() => setEditing(null)}><Icon name="x" size={15} /> Cancel</button>
          </div>
          <ErrorBanner message={formError} />
          <form onSubmit={save}>
            <div className="row" style={{ gap: ".5rem" }}>
              <div className="field" style={{ flex: 2 }}>
                <label>Template name *</label>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required placeholder="e.g. Intro email" />
              </div>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 400, alignSelf: "flex-end", height: 40 }}>
                <input type="checkbox" style={{ width: "auto" }} checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
                Active
              </label>
            </div>
            <div className="field">
              <label>Subject</label>
              <input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} placeholder="Hi {{first_name}} — a quick note about {{company}}" />
            </div>
            <div className="row" style={{ gap: ".5rem" }}>
              <div className="field" style={{ flex: 1 }}><label>CC (default)</label><input value={form.cc} onChange={(e) => setForm({ ...form, cc: e.target.value })} placeholder="comma-separated" /></div>
              <div className="field" style={{ flex: 1 }}><label>BCC (default)</label><input value={form.bcc} onChange={(e) => setForm({ ...form, bcc: e.target.value })} placeholder="comma-separated" /></div>
            </div>
            <div className="field">
              <label>Body</label>
              <RichTextEditor value={form.body_html} onChange={(html) => setForm((f) => ({ ...f, body_html: html }))} tags={EMAIL_TAGS} />
            </div>

            <div className="field">
              <label>Attachments</label>
              <input ref={fileRef} type="file" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) onAttach(f); e.target.value = ""; }} />
              {form.attachments.length > 0 && (
                <div style={{ marginBottom: ".5rem" }}>
                  {form.attachments.map((a) => (
                    <div key={a.key} className="row" style={{ padding: "3px 0" }}>
                      <span style={{ fontSize: ".85rem", display: "inline-flex", alignItems: "center", gap: 6 }}>
                        <Icon name="paperclip" size={14} /> {a.filename}
                      </span>
                      <button type="button" className="btn small ghost" onClick={() => setForm((f) => ({ ...f, attachments: f.attachments.filter((x) => x.key !== a.key) }))}>
                        <Icon name="x" size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <button type="button" className="btn small secondary" disabled={busy} onClick={() => fileRef.current?.click()}>
                <Icon name="upload" size={15} /> Add attachment
              </button>
            </div>

            <button className="btn full" disabled={busy}>{busy ? "Saving…" : "Save template"}</button>
          </form>
        </Card>
      )}

      <ErrorBanner message={error} />
      {loading ? (
        <Spinner />
      ) : templates.length === 0 ? (
        <EmptyState icon="mail" title="No email templates yet" hint="Create one so advisors can send polished emails in seconds." />
      ) : (
        templates.map((t) => (
          <Card key={t.id}>
            <div className="row" style={{ justifyContent: "flex-start", gap: ".75rem" }}>
              <span className="icon-tile"><Icon name="mail" size={20} /></span>
              <div style={{ flex: 1 }}>
                <strong>{t.name}{!t.active && <span className="muted" style={{ fontWeight: 400 }}> · hidden</span>}</strong>
                <div className="muted" style={{ fontSize: ".8rem" }}>{t.subject || "(no subject)"}</div>
                {t.attachments?.length > 0 && (
                  <div className="muted" style={{ fontSize: ".75rem", marginTop: 2 }}>
                    <Icon name="paperclip" size={12} /> {t.attachments.length} attachment{t.attachments.length > 1 ? "s" : ""}
                  </div>
                )}
              </div>
              <div className="row" style={{ gap: ".4rem" }}>
                <button className="btn small secondary" onClick={() => openEdit(t)}><Icon name="edit" size={15} /></button>
                <button className="btn small ghost" onClick={() => remove(t)}><Icon name="x" size={15} /></button>
              </div>
            </div>
          </Card>
        ))
      )}
    </div>
  );
}
