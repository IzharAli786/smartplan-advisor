import { Fragment, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useApi } from "../hooks/useApi.ts";
import { useProducts } from "../hooks/useSettings.ts";
import { useAuth } from "../auth/AuthContext.tsx";
import { api, ApiError } from "../api/client.ts";
import { Card, ErrorBanner, PageHead, Spinner } from "../components/ui.tsx";
import { Icon } from "../components/Icon.tsx";
import { dateShort } from "../lib/format.ts";
import { LEAD_STATUSES } from "@smart-crm/shared";
import type { CurrentUser, Lead } from "../api/types.ts";

const STATUS_KIND: Record<Lead["status"], string> = { new: "lead-new", claimed: "lead-working", converted: "lead-converted", dismissed: "lead-dismissed" };
// Converting DELETES the lead (it lives on as a pipeline opportunity), so
// "converted" is never a visible lead state.
const WORKFLOW_STATUSES = LEAD_STATUSES.filter((s) => s.value !== "converted");

export default function LeadsPage() {
  const { isManager } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const advisorFilter = params.get("advisorId") ?? "";
  const statusFilter = params.get("status") ?? "";
  const [q, setQ] = useState("");

  const { data: usersData } = useApi<{ users: CurrentUser[] }>(isManager ? "/api/users" : null);
  const advisors = (usersData?.users ?? []).filter((u) => u.role === "advisor" && u.active);
  const { data: productsData } = useProducts();
  const products = (productsData?.products ?? []).filter((p) => p.active);

  const qs = useMemo(() => {
    const sp = new URLSearchParams();
    if (advisorFilter) sp.set("advisorId", advisorFilter);
    if (statusFilter) sp.set("status", statusFilter);
    if (q.trim()) sp.set("q", q.trim());
    const s = sp.toString();
    return s ? `?${s}` : "";
  }, [advisorFilter, statusFilter, q]);

  const { data, loading, error, reload } = useApi<{ leads: Lead[] }>(`/api/leads${qs}`, [qs]);
  const leads = data?.leads ?? [];

  const [expanded, setExpanded] = useState<string | null>(null);
  const [actErr, setActErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Convert modal
  const [convertLead, setConvertLead] = useState<Lead | null>(null);
  const [cProduct, setCProduct] = useState("");
  const [cValue, setCValue] = useState("");
  const [cTechs, setCTechs] = useState("");

  // Edit modal
  const [editLead, setEditLead] = useState<Lead | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});

  function setFilter(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  }

  async function changeStatus(lead: Lead, status: string) {
    setBusyId(lead.id);
    setActErr(null);
    try {
      await api.patch(`/api/leads/${lead.id}`, { status });
      reload();
    } catch (e) {
      setActErr(e instanceof ApiError ? e.message : "Couldn't update the lead");
    } finally {
      setBusyId(null);
    }
  }

  async function reassign(lead: Lead, advisorId: string) {
    setBusyId(lead.id);
    setActErr(null);
    try {
      await api.patch(`/api/leads/${lead.id}`, { assigned_advisor_id: advisorId });
      const name = advisors.find((a) => a.id === advisorId)?.fullName ?? "advisor";
      setNotice(`"${lead.companyName}" reassigned to ${name}`);
      setTimeout(() => setNotice(null), 4000);
      reload();
    } catch (e) {
      setActErr(e instanceof ApiError ? e.message : "Couldn't reassign the lead");
    } finally {
      setBusyId(null);
    }
  }

  async function remove(lead: Lead) {
    if (!confirm(`Delete lead "${lead.companyName}"? This can't be undone.`)) return;
    setBusyId(lead.id);
    setActErr(null);
    try {
      await api.delete(`/api/leads/${lead.id}`);
      reload();
    } catch (e) {
      setActErr(e instanceof ApiError ? e.message : "Couldn't delete the lead");
    } finally {
      setBusyId(null);
    }
  }

  function openConvert(lead: Lead) {
    setConvertLead(lead);
    setCProduct("");
    setCValue("");
    setCTechs("");
    setActErr(null);
  }

  function openEdit(lead: Lead) {
    setEditLead(lead);
    setForm({
      company_name: lead.companyName,
      first_name: lead.firstName ?? "",
      last_name: lead.lastName ?? "",
      title: lead.title ?? "",
      email: lead.email ?? "",
      department: lead.department ?? "",
      linkedin_url: lead.linkedinUrl ?? "",
      website: lead.website ?? "",
      company_address: lead.companyAddress ?? "",
      company_city: lead.companyCity ?? "",
      company_state: lead.companyState ?? "",
      corporate_phone: lead.corporatePhone ?? "",
      company_phone: lead.companyPhone ?? "",
      num_employees: lead.numEmployees == null ? "" : String(lead.numEmployees),
      annual_revenue: lead.annualRevenue ?? "",
      subsidiary_of: lead.subsidiaryOf ?? "",
      technologies: lead.technologies ?? "",
      keywords: lead.keywords ?? "",
      notes: lead.notes ?? "",
    });
    setActErr(null);
  }

  // Mirror of the backend rules in leadUpdateSchema — the API is the authority, this is UX.
  const editCompanyMissing = editLead != null && !form.company_name?.trim();
  const editEmailInvalid = editLead != null && !!form.email?.trim() && !/^\S+@\S+\.\S+$/.test(form.email.trim());
  const editEmployeesInvalid =
    editLead != null && !!form.num_employees?.trim() && !/^\d+$/.test(form.num_employees.trim());

  async function doSaveEdit() {
    if (!editLead || editCompanyMissing || editEmailInvalid || editEmployeesInvalid) return;
    setBusyId(editLead.id);
    setActErr(null);
    try {
      await api.patch(`/api/leads/${editLead.id}`, {
        company_name: form.company_name!.trim(),
        first_name: form.first_name!.trim(),
        last_name: form.last_name!.trim(),
        title: form.title!.trim(),
        email: form.email!.trim(),
        department: form.department!.trim(),
        linkedin_url: form.linkedin_url!.trim(),
        website: form.website!.trim(),
        company_address: form.company_address!.trim(),
        company_city: form.company_city!.trim(),
        company_state: form.company_state!.trim(),
        corporate_phone: form.corporate_phone!.trim(),
        company_phone: form.company_phone!.trim(),
        num_employees: form.num_employees!.trim(),
        annual_revenue: form.annual_revenue!.trim(),
        subsidiary_of: form.subsidiary_of!.trim(),
        technologies: form.technologies!.trim(),
        keywords: form.keywords!.trim(),
        notes: form.notes!.trim(),
      });
      setEditLead(null);
      reload();
    } catch (e) {
      setActErr(e instanceof ApiError ? e.message : "Couldn't save the lead");
    } finally {
      setBusyId(null);
    }
  }

  async function doConvert() {
    if (!convertLead) return;
    setBusyId(convertLead.id);
    setActErr(null);
    try {
      const res = await api.post<{ opportunityId: string }>(`/api/leads/${convertLead.id}/convert`, {
        product: cProduct || undefined,
        opportunity_value: cValue ? Number(cValue) : undefined,
        num_technicians: cTechs ? Number(cTechs) : undefined,
      });
      setConvertLead(null);
      navigate(`/opportunity/${res.opportunityId}`);
    } catch (e) {
      setActErr(e instanceof ApiError ? e.message : "Couldn't convert the lead");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <PageHead
        title="Leads"
        subtitle={isManager ? "Apollo leads fed to your Smart Advisors" : "Leads assigned to you — work them into opportunities"}
        actions={
          isManager ? (
            <Link className="btn" to="/leads/import">
              <Icon name="upload" size={16} /> Import from Apollo
            </Link>
          ) : undefined
        }
      />
      <ErrorBanner message={error || actErr} />
      {notice && <div className="success-banner">{notice}</div>}

      <Card>
        <div className="row" style={{ gap: ".6rem", flexWrap: "wrap", justifyContent: "flex-start" }}>
          {isManager && (
            <div className="field" style={{ margin: 0, minWidth: 200 }}>
              <label style={{ fontSize: ".72rem" }}>Smart Advisor</label>
              <select value={advisorFilter} onChange={(e) => setFilter("advisorId", e.target.value)}>
                <option value="">All advisors</option>
                {advisors.map((a) => (
                  <option key={a.id} value={a.id}>{a.fullName}</option>
                ))}
              </select>
            </div>
          )}
          <div className="field" style={{ margin: 0, minWidth: 160 }}>
            <label style={{ fontSize: ".72rem" }}>Status</label>
            <select value={statusFilter} onChange={(e) => setFilter("status", e.target.value)}>
              <option value="">All statuses</option>
              {WORKFLOW_STATUSES.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>
          <div className="field" style={{ margin: 0, flex: "1 1 220px", position: "relative" }}>
            <label style={{ fontSize: ".72rem" }}>Search</label>
            <input placeholder="Company, contact, email, title, state…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
      </Card>

      {loading ? (
        <Spinner />
      ) : leads.length === 0 ? (
        <Card>
          <div className="muted" style={{ padding: "1rem", textAlign: "center" }}>
            No leads yet.{" "}
            {isManager ? (
              <Link to="/leads/import">Import an Apollo export</Link>
            ) : (
              "Your manager will assign Apollo leads to you here."
            )}
          </div>
        </Card>
      ) : (
        <Card>
          <div className="row" style={{ marginBottom: ".5rem" }}>
            <strong>{leads.length} lead{leads.length === 1 ? "" : "s"}</strong>
          </div>
          <div className="scroll-x">
            <table className="grid-table">
              <thead>
                <tr>
                  <th></th>
                  <th>Company</th>
                  <th>Contact</th>
                  <th>Location</th>
                  <th style={{ textAlign: "right" }}>Employees</th>
                  {isManager && <th>Advisor</th>}
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((l) => {
                  const person = [l.firstName, l.lastName].filter(Boolean).join(" ");
                  const open = expanded === l.id;
                  return (
                    <Fragment key={l.id}>
                      <tr style={{ opacity: busyId === l.id ? 0.5 : 1 }}>
                        <td>
                          <button className="btn small secondary icon-only" aria-label="Details" onClick={() => setExpanded(open ? null : l.id)}>
                            <Icon name={open ? "eye-off" : "eye"} size={15} />
                          </button>
                        </td>
                        <td>
                          <strong>{l.companyName}</strong>
                          {l.subsidiaryOf ? <div className="muted" style={{ fontSize: ".72rem" }}>↳ {l.subsidiaryOf}</div> : null}
                        </td>
                        <td className="muted">{[person, l.title].filter(Boolean).join(" · ") || "—"}</td>
                        <td className="muted">{[l.companyCity, l.companyState].filter(Boolean).join(", ") || "—"}</td>
                        <td style={{ textAlign: "right" }}>{l.numEmployees ?? "—"}</td>
                        {isManager && <td className="muted">{l.advisorName ?? "—"}</td>}
                        <td>
                          <select
                            className={`lead-status-select ${STATUS_KIND[l.status]}`}
                            value={l.status}
                            onChange={(e) => changeStatus(l, e.target.value)}
                          >
                            {WORKFLOW_STATUSES.map((s) => (
                              <option key={s.value} value={s.value}>{s.label}</option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <div className="row" style={{ gap: 4, justifyContent: "flex-start" }}>
                            <button className="btn small" disabled={busyId === l.id} onClick={() => openConvert(l)}>
                              <Icon name="arrow-up-right" size={14} /> Convert
                            </button>
                            <button className="btn small secondary icon-only" aria-label="Edit" disabled={busyId === l.id} onClick={() => openEdit(l)}>
                              <Icon name="edit" size={14} />
                            </button>
                            {isManager && (
                              <button className="btn small secondary icon-only" aria-label="Delete" disabled={busyId === l.id} onClick={() => remove(l)}>
                                <Icon name="x" size={14} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                      {open && (
                        <LeadDetailRow
                          lead={l}
                          colSpan={isManager ? 8 : 7}
                          advisors={isManager ? advisors : undefined}
                          busy={busyId === l.id}
                          onReassign={(advisorId) => reassign(l, advisorId)}
                        />
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {convertLead && (
        <div className="modal-overlay" onClick={() => setConvertLead(null)}>
          <div className="modal" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>Convert lead to opportunity</h3>
            <p className="muted" style={{ fontSize: ".85rem", marginTop: 0 }}>
              Creates a pipeline opportunity for <strong>{convertLead.companyName}</strong>
              {convertLead.advisorName ? <> assigned to <strong>{convertLead.advisorName}</strong></> : null}. You can fill in the rest afterwards.
            </p>
            <ErrorBanner message={actErr} />
            <div className="field">
              <label>Product (optional)</label>
              <select value={cProduct} onChange={(e) => setCProduct(e.target.value)}>
                <option value="">— choose later —</option>
                {products.map((p) => (
                  <option key={p.id} value={p.label}>{p.label}</option>
                ))}
              </select>
            </div>
            <div className="row" style={{ gap: ".6rem" }}>
              <div className="field" style={{ flex: 1 }}>
                <label>Deal value (optional)</label>
                <input type="number" min="0" value={cValue} onChange={(e) => setCValue(e.target.value)} placeholder="0" />
              </div>
              <div className="field" style={{ flex: 1 }}>
                <label># Technicians (optional)</label>
                <input type="number" min="0" value={cTechs} onChange={(e) => setCTechs(e.target.value)} placeholder="0" />
              </div>
            </div>
            <div className="row" style={{ gap: ".5rem", justifyContent: "flex-end", marginTop: ".5rem" }}>
              <button className="btn secondary" onClick={() => setConvertLead(null)}>Cancel</button>
              <button className="btn" disabled={busyId === convertLead.id} onClick={doConvert}>
                {busyId === convertLead.id ? "Converting…" : "Create opportunity"}
              </button>
            </div>
          </div>
        </div>
      )}

      {editLead && (
        <div className="modal-overlay" onClick={() => setEditLead(null)}>
          <div className="modal" style={{ maxWidth: 680, maxHeight: "85vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>Edit lead</h3>
            <ErrorBanner message={actErr} />
            <div className="field">
              <label>Company name *</label>
              <input value={form.company_name ?? ""} onChange={(e) => setForm({ ...form, company_name: e.target.value })} />
              {editCompanyMissing && <div className="field-error">Company name is required</div>}
            </div>
            <div className="row" style={{ gap: ".6rem" }}>
              <EditField label="First name" name="first_name" form={form} setForm={setForm} />
              <EditField label="Last name" name="last_name" form={form} setForm={setForm} />
            </div>
            <div className="row" style={{ gap: ".6rem" }}>
              <EditField label="Title" name="title" form={form} setForm={setForm} />
              <EditField label="Department" name="department" form={form} setForm={setForm} />
            </div>
            <div className="field">
              <label>Email</label>
              <input type="email" value={form.email ?? ""} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              {editEmailInvalid && <div className="field-error">Enter a valid email address</div>}
            </div>
            <div className="row" style={{ gap: ".6rem" }}>
              <EditField label="Corporate phone" name="corporate_phone" form={form} setForm={setForm} />
              <EditField label="Company phone" name="company_phone" form={form} setForm={setForm} />
            </div>
            <div className="row" style={{ gap: ".6rem" }}>
              <EditField label="Website" name="website" form={form} setForm={setForm} />
              <EditField label="LinkedIn" name="linkedin_url" form={form} setForm={setForm} />
            </div>
            <EditField label="Company address" name="company_address" form={form} setForm={setForm} />
            <div className="row" style={{ gap: ".6rem" }}>
              <EditField label="City" name="company_city" form={form} setForm={setForm} />
              <EditField label="State" name="company_state" form={form} setForm={setForm} />
            </div>
            <div className="row" style={{ gap: ".6rem" }}>
              <div className="field" style={{ flex: 1 }}>
                <label># Employees</label>
                <input inputMode="numeric" value={form.num_employees ?? ""} onChange={(e) => setForm({ ...form, num_employees: e.target.value })} />
                {editEmployeesInvalid && <div className="field-error">Enter a whole number</div>}
              </div>
              <EditField label="Annual revenue" name="annual_revenue" form={form} setForm={setForm} />
            </div>
            <EditField label="Subsidiary of" name="subsidiary_of" form={form} setForm={setForm} />
            <EditField label="Technologies" name="technologies" form={form} setForm={setForm} />
            <EditField label="Keywords" name="keywords" form={form} setForm={setForm} />
            <div className="field">
              <label>Notes</label>
              <textarea rows={3} value={form.notes ?? ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
            <div className="row" style={{ gap: ".5rem", justifyContent: "flex-end", marginTop: ".5rem" }}>
              <button className="btn secondary" onClick={() => setEditLead(null)}>Cancel</button>
              <button
                className="btn"
                disabled={busyId === editLead.id || editCompanyMissing || editEmailInvalid || editEmployeesInvalid}
                onClick={doSaveEdit}
              >
                {busyId === editLead.id ? "Saving…" : "Save changes"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function EditField({
  label,
  name,
  form,
  setForm,
}: {
  label: string;
  name: string;
  form: Record<string, string>;
  setForm: (f: Record<string, string>) => void;
}) {
  return (
    <div className="field" style={{ flex: 1 }}>
      <label>{label}</label>
      <input value={form[name] ?? ""} onChange={(e) => setForm({ ...form, [name]: e.target.value })} />
    </div>
  );
}

/** Expanded details: only the fields that actually have a value, in a tidy grid.
 *  Managers also get a "Reassign to" control (advisors + onReassign are only
 *  passed for managers — the API enforces the same rule). */
function LeadDetailRow({
  lead: l,
  colSpan,
  advisors,
  busy,
  onReassign,
}: {
  lead: Lead;
  colSpan: number;
  advisors?: CurrentUser[];
  busy?: boolean;
  onReassign?: (advisorId: string) => void;
}) {
  // Current owner may be missing from the list (e.g. deactivated) — start unselected then.
  const [advisorId, setAdvisorId] = useState(() =>
    advisors?.some((a) => a.id === l.assignedAdvisorId) ? l.assignedAdvisorId : ""
  );
  const fields: { label: string; value: string | null | undefined; link?: boolean; wide?: boolean }[] = [
    { label: "Email", value: l.email },
    { label: "Department", value: l.department },
    { label: "Corporate phone", value: l.corporatePhone },
    { label: "Company phone", value: l.companyPhone },
    { label: "Website", value: l.website, link: true },
    { label: "LinkedIn", value: l.linkedinUrl, link: true },
    { label: "Company address", value: l.companyAddress },
    { label: "Annual revenue", value: l.annualRevenue },
    { label: "Imported", value: dateShort(l.createdAt) },
    { label: "Technologies", value: l.technologies, wide: true },
    { label: "Keywords", value: l.keywords, wide: true },
    { label: "Notes", value: l.notes, wide: true },
  ].filter((f) => f.value);

  return (
    <tr>
      <td colSpan={colSpan} style={{ background: "var(--color-surface-2)", padding: 0 }}>
        <div className="lead-detail-grid">
          {fields.map((f) => (
            <div key={f.label} className="lead-detail-item" style={f.wide ? { gridColumn: "1 / -1" } : undefined}>
              <div className="lead-detail-label">{f.label}</div>
              {f.link && f.value ? (
                <a href={f.value.startsWith("http") ? f.value : `https://${f.value}`} target="_blank" rel="noreferrer" style={{ wordBreak: "break-all" }}>{f.value}</a>
              ) : (
                <div className="lead-detail-value">{f.value}</div>
              )}
            </div>
          ))}
          {fields.length === 0 && <div className="muted">No additional details on this lead.</div>}
        </div>
        {advisors && onReassign && (
          <div
            className="row"
            style={{ justifyContent: "flex-start", alignItems: "flex-end", gap: ".6rem", padding: "0 1.25rem 1rem", flexWrap: "wrap" }}
          >
            {advisors.length === 0 ? (
              <span className="muted" style={{ fontSize: ".85rem" }}>No active advisors to reassign to.</span>
            ) : (
              <>
                <div className="field" style={{ margin: 0, minWidth: 220 }}>
                  <label style={{ fontSize: ".72rem" }}>Reassign to</label>
                  <select value={advisorId} onChange={(e) => setAdvisorId(e.target.value)}>
                    {advisorId === "" && <option value="">— choose advisor —</option>}
                    {advisors.map((a) => (
                      <option key={a.id} value={a.id}>{a.fullName}</option>
                    ))}
                  </select>
                </div>
                <button
                  className="btn small"
                  disabled={busy || !advisorId || advisorId === l.assignedAdvisorId}
                  onClick={() => onReassign(advisorId)}
                >
                  {busy ? "Reassigning…" : "Reassign"}
                </button>
              </>
            )}
          </div>
        )}
      </td>
    </tr>
  );
}
