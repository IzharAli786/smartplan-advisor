import { useRef, useState, type FormEvent } from "react";
import { useApi } from "../hooks/useApi.ts";
import { api, ApiError } from "../api/client.ts";
import { useAuth } from "../auth/AuthContext.tsx";
import { Card, EmptyState, ErrorBanner, PageHead, Spinner, StatusBadge } from "../components/ui.tsx";
import { Icon } from "../components/Icon.tsx";
import { PhoneInput } from "../components/PhoneInput.tsx";
import { exportContactsXlsx, parseContactsFile, pickPhoneContacts, phoneContactsSupported } from "../lib/contacts-io.ts";
import { dateShort, dateTimeShort } from "../lib/format.ts";
import type { Communication, Contact, ContactType } from "../api/types.ts";

const TYPE_TABS: { key: string; label: string }[] = [
  { key: "", label: "All" },
  { key: "customer", label: "Customers" },
  { key: "lead", label: "Leads" },
  { key: "partner", label: "Partners" },
  { key: "other", label: "Other" },
];

function typeBadge(t: ContactType): "success" | "ai" | undefined {
  return t === "customer" ? "success" : t === "lead" ? "ai" : undefined;
}

const emptyForm = { type: "lead" as ContactType, name: "", company: "", title: "", email: "", phone: "", phone2: "", address: "", notes: "", next_review_at: "", review_notes: "" };

export default function AddressBookPage() {
  const { isManager } = useAuth();
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const query = new URLSearchParams();
  if (q) query.set("q", q);
  if (type) query.set("type", type);
  const { data, loading, error, reload } = useApi<{ contacts: Contact[] }>(`/api/contacts?${query.toString()}`, [q, type]);
  const contacts = data?.contacts ?? [];

  const [editing, setEditing] = useState<string | null>(null); // contact id or "new"
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function openNew() {
    setForm(emptyForm);
    setEditing("new");
    setFormError(null);
  }
  function openEdit(c: Contact) {
    setForm({
      type: c.type,
      name: c.name,
      company: c.company ?? "",
      title: c.title ?? "",
      email: c.email ?? "",
      phone: c.phone ?? "",
      phone2: c.phone2 ?? "",
      address: c.address ?? "",
      notes: c.notes ?? "",
      next_review_at: c.nextReviewAt ? c.nextReviewAt.slice(0, 10) : "",
      review_notes: c.reviewNotes ?? "",
    });
    setEditing(c.id);
    setFormError(null);
  }

  function payloadFromForm() {
    return {
      ...form,
      next_review_at: form.next_review_at ? new Date(form.next_review_at).toISOString() : null,
    };
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      if (editing === "new") await api.post("/api/contacts", payloadFromForm());
      else await api.patch(`/api/contacts/${editing}`, payloadFromForm());
      setEditing(null);
      reload();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  async function remove(c: Contact) {
    if (!window.confirm(`Delete ${c.name}?`)) return;
    await api.delete(`/api/contacts/${c.id}`);
    reload();
  }

  async function importRows(rows: { name: string }[], source: string) {
    if (rows.length === 0) {
      setMsg(`No contacts found in the ${source}.`);
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const res = await api.post<{ imported: number }>("/api/contacts/import", { contacts: rows });
      setMsg(`Imported ${res.imported} contact${res.imported === 1 ? "" : "s"} from ${source}.`);
      reload();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  async function onFile(file: File) {
    try {
      const rows = await parseContactsFile(file);
      await importRows(rows, "spreadsheet");
    } catch {
      setFormError("Couldn't read that file. Use an .xlsx or .csv with a Name column.");
    }
  }

  async function importPhone() {
    try {
      const rows = await pickPhoneContacts();
      await importRows(rows, "phone");
    } catch {
      setFormError("Phone contact import was cancelled or isn't available on this device.");
    }
  }

  return (
    <div>
      <PageHead
        title="Address Book"
        subtitle={isManager ? "All advisors' customers, leads and partners" : "Your customers, leads and partners"}
        actions={
          <button className="btn" onClick={openNew}>
            <Icon name="plus" size={16} /> Add contact
          </button>
        }
      />

      {/* Toolbar */}
      <Card>
        <div className="field" style={{ position: "relative", marginBottom: ".75rem" }}>
          <input placeholder="Search by name, company or email…" value={q} onChange={(e) => setQ(e.target.value)} style={{ paddingLeft: "2.25rem" }} />
          <span style={{ position: "absolute", left: ".7rem", top: "11px", color: "var(--color-text-muted)" }}>
            <Icon name="search" size={18} />
          </span>
        </div>
        <div className="tabs" style={{ marginBottom: ".75rem" }}>
          {TYPE_TABS.map((t) => (
            <button key={t.key} className={`tab ${type === t.key ? "active" : ""}`} onClick={() => setType(t.key)}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="row" style={{ gap: ".5rem", justifyContent: "flex-start", flexWrap: "wrap" }}>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }} />
          <button className="btn secondary small" disabled={busy} onClick={() => fileRef.current?.click()}>
            <Icon name="upload" size={15} /> Import Excel
          </button>
          {phoneContactsSupported() && (
            <button className="btn secondary small" disabled={busy} onClick={importPhone}>
              <Icon name="phone" size={15} /> Import phone contacts
            </button>
          )}
          <button className="btn secondary small" disabled={!contacts.length} onClick={() => exportContactsXlsx(contacts)}>
            <Icon name="download" size={15} /> Export
          </button>
        </div>
        {msg && <div className="success-banner" style={{ marginTop: ".75rem", marginBottom: 0 }}>{msg}</div>}
      </Card>

      {editing && (
        <Card>
          <div className="row">
            <h3>{editing === "new" ? "Add contact" : "Edit contact"}</h3>
            <button className="btn small ghost" onClick={() => setEditing(null)}><Icon name="x" size={15} /> Cancel</button>
          </div>
          <ErrorBanner message={formError} />
          <form onSubmit={save}>
            <div className="row" style={{ gap: ".5rem" }}>
              <div className="field" style={{ flex: 2 }}>
                <label>Name *</label>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
              </div>
              <div className="field" style={{ flex: 1 }}>
                <label>Type</label>
                <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as ContactType })}>
                  <option value="customer">Customer</option>
                  <option value="lead">Lead</option>
                  <option value="partner">Partner</option>
                  <option value="other">Other</option>
                </select>
              </div>
            </div>
            <div className="row" style={{ gap: ".5rem" }}>
              <div className="field" style={{ flex: 1 }}><label>Company</label><input value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} /></div>
              <div className="field" style={{ flex: 1 }}><label>Title</label><input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
            </div>
            <div className="field"><label>Email</label><input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
            <div className="row" style={{ gap: ".5rem" }}>
              <div className="field" style={{ flex: 1 }}><label>Cell</label><PhoneInput value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} /></div>
              <div className="field" style={{ flex: 1 }}><label>2nd cell</label><PhoneInput value={form.phone2} onChange={(v) => setForm({ ...form, phone2: v })} /></div>
            </div>
            <div className="field"><label>Address</label><input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
            <div className="field"><label>Next review date</label><input type="date" value={form.next_review_at} onChange={(e) => setForm({ ...form, next_review_at: e.target.value })} /></div>
            <div className="field"><label>Review notes</label><textarea value={form.review_notes} onChange={(e) => setForm({ ...form, review_notes: e.target.value })} placeholder="What to check at the next review" /></div>
            <div className="field"><label>Notes</label><textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
            <button className="btn full" disabled={busy}>{busy ? "Saving…" : "Save contact"}</button>
          </form>
        </Card>
      )}

      <ErrorBanner message={error} />
      {loading ? (
        <Spinner />
      ) : contacts.length === 0 ? (
        <EmptyState icon="contact" title={q || type ? "No matching contacts" : "Your address book is empty"} hint="Add a contact, import a spreadsheet, or pull in your phone contacts." />
      ) : (
        contacts.map((c) => (
          <Card key={c.id}>
            <div className="row" style={{ justifyContent: "flex-start", gap: ".75rem" }}>
              <span className="icon-tile"><Icon name="contact" size={20} /></span>
              <div style={{ flex: 1 }}>
                <div className="row" style={{ justifyContent: "flex-start", gap: ".5rem" }}>
                  <strong>{c.name}</strong>
                  <StatusBadge label={c.type} kind={typeBadge(c.type)} />
                </div>
                <div className="muted" style={{ fontSize: ".8rem" }}>
                  {[c.title, c.company].filter(Boolean).join(" · ") || "—"}
                  {isManager && c.ownerName ? ` · owner: ${c.ownerName}` : ""}
                </div>
                <div className="muted" style={{ fontSize: ".8rem", marginTop: 2 }}>
                  {c.email ? <a href={`mailto:${c.email}`}>{c.email}</a> : null}
                  {c.email && c.phone ? " · " : ""}
                  {c.phone ? <a href={`tel:${c.phone}`}>{c.phone}</a> : null}
                </div>
                {c.nextReviewAt && (
                  <div style={{ fontSize: ".78rem", marginTop: 4, color: new Date(c.nextReviewAt) < new Date() ? "var(--color-danger)" : "var(--color-text-muted)" }}>
                    <Icon name="calendar" size={13} /> Next review {dateShort(c.nextReviewAt)}
                  </div>
                )}
                <ContactComms contactId={c.id} />
              </div>
              <div className="row" style={{ gap: ".4rem" }}>
                <button className="btn small secondary" onClick={() => openEdit(c)}><Icon name="edit" size={15} /></button>
                <button className="btn small ghost" onClick={() => remove(c)}><Icon name="x" size={15} /></button>
              </div>
            </div>
          </Card>
        ))
      )}
    </div>
  );
}

/** Lazy per-contact communications log (quotes/emails sent, by date & time). */
function ContactComms({ contactId }: { contactId: string }) {
  const [open, setOpen] = useState(false);
  const { data } = useApi<{ communications: Communication[] }>(open ? `/api/contacts/${contactId}/communications` : null, [open]);
  const comms = data?.communications ?? [];
  return (
    <details style={{ marginTop: 4 }} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary className="muted" style={{ fontSize: ".78rem", cursor: "pointer" }}>Communications</summary>
      {open && comms.length === 0 && <div className="muted" style={{ fontSize: ".78rem", marginTop: 4 }}>Nothing sent yet.</div>}
      {comms.map((m) => (
        <div key={m.id} className="muted" style={{ fontSize: ".76rem", marginTop: 4 }}>
          {dateTimeShort(m.createdAt)} — {m.subject} {m.status === "failed" ? "(failed)" : ""}
        </div>
      ))}
    </details>
  );
}
