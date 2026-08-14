import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useApi } from "../hooks/useApi.ts";
import { useProducts } from "../hooks/useSettings.ts";
import { useAuth } from "../auth/AuthContext.tsx";
import { api, ApiError } from "../api/client.ts";
import { Card, ErrorBanner, PageHead, Spinner } from "../components/ui.tsx";
import { Icon } from "../components/Icon.tsx";
import { dateShort } from "../lib/format.ts";
import { LEAD_STATUSES } from "@smart-crm/shared";
import type { CurrentUser, Lead, LeadNote } from "../api/types.ts";

const STATUS_KIND: Record<Lead["status"], string> = { new: "lead-new", claimed: "lead-working", converted: "lead-converted", dismissed: "lead-dismissed" };
// Converting DELETES the lead (it lives on as a pipeline opportunity), so
// "converted" is never a visible lead state.
const WORKFLOW_STATUSES = LEAD_STATUSES.filter((s) => s.value !== "converted");

// All fields on the Add/Edit lead form, in render order — also drives the create payload.
const LEAD_FORM_KEYS = [
  "company_name", "first_name", "last_name", "title", "email", "department",
  "linkedin_url", "website", "company_address", "company_city", "company_state",
  "corporate_phone", "company_phone", "num_employees", "annual_revenue",
  "subsidiary_of", "technologies", "keywords", "notes",
] as const;
const emptyLeadForm = () => Object.fromEntries(LEAD_FORM_KEYS.map((k) => [k, ""])) as Record<string, string>;
// Mirror of SCAN_IMAGE_TYPES in POST /api/leads/scan — the API is the authority.
const SCAN_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

export default function LeadsPage() {
  const { user, isManager } = useAuth();
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

  // Column sorting (client-side — the whole filtered list is already loaded).
  const [sortKey, setSortKey] = useState<"company" | "location" | "employees" | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  function toggleSort(key: "company" | "location" | "employees") {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("asc");
    }
  }
  const sortArrow = (key: string) => (sortKey === key ? (sortDir === "asc" ? " ▲" : " ▼") : "");
  const ariaSort = (key: string) => (sortKey === key ? (sortDir === "asc" ? "ascending" : "descending") : undefined);
  const sortedLeads = useMemo(() => {
    if (!sortKey) return leads;
    const dir = sortDir === "asc" ? 1 : -1;
    const loc = (l: Lead) => [l.companyCity, l.companyState].filter(Boolean).join(", ");
    return [...leads].sort((a, b) => {
      if (sortKey === "employees") {
        // Unknown employee counts sink to the bottom in either direction.
        if (a.numEmployees == null && b.numEmployees == null) return 0;
        if (a.numEmployees == null) return 1;
        if (b.numEmployees == null) return -1;
        return (a.numEmployees - b.numEmployees) * dir;
      }
      const av = sortKey === "company" ? a.companyName : loc(a);
      const bv = sortKey === "company" ? b.companyName : loc(b);
      return av.localeCompare(bv, undefined, { sensitivity: "base" }) * dir;
    });
  }, [leads, sortKey, sortDir]);

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

  // Add-lead modal — typed entry + AI photo scan.
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<Record<string, string>>(emptyLeadForm);
  const [createAdvisorId, setCreateAdvisorId] = useState("");
  const [aiFields, setAiFields] = useState<Set<string>>(new Set());
  const [scanEnabled, setScanEnabled] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanErr, setScanErr] = useState<string | null>(null);
  const [createBusy, setCreateBusy] = useState(false);
  const [createErr, setCreateErr] = useState<string | null>(null);
  const scanInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api
      .get<{ enabled: boolean }>("/api/leads/scan-status")
      .then((d) => setScanEnabled(d.enabled))
      .catch(() => setScanEnabled(false));
  }, []);

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

  // Same mirrors for the Add-lead modal (backend: leadCreateSchema).
  const createCompanyMissing = createOpen && !createForm.company_name?.trim();
  const createEmailInvalid =
    createOpen && !!createForm.email?.trim() && !/^\S+@\S+\.\S+$/.test(createForm.email.trim());
  const createEmployeesInvalid =
    createOpen && !!createForm.num_employees?.trim() && !/^\d+$/.test(createForm.num_employees.trim());

  function openCreate() {
    setCreateForm(emptyLeadForm());
    setAiFields(new Set());
    setCreateAdvisorId(user?.id ?? "");
    setCreateErr(null);
    setScanErr(null);
    setCreateOpen(true);
  }

  /** Set one Add-lead field; a manual edit clears that field's AI badge. */
  function setCreateField(name: string, value: string) {
    setCreateForm((f) => ({ ...f, [name]: value }));
    setAiFields((s) => {
      if (!s.has(name)) return s;
      const next = new Set(s);
      next.delete(name);
      return next;
    });
  }

  async function sendImage(file: File) {
    // Mirror of the checks in POST /api/leads/scan — the API is the authority.
    if (!SCAN_TYPES.includes(file.type)) {
      setScanErr("Use a PNG, JPG, WEBP or GIF. iPhone HEIC photos aren't supported — take a screenshot of the photo instead.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setScanErr("Image must be under 10MB");
      return;
    }
    setScanning(true);
    setScanErr(null);
    try {
      const fd = new FormData();
      fd.set("file", file, file.name || "scan.png");
      const { draft } = await api.upload<{ draft: Record<string, unknown> }>("/api/leads/scan", fd);
      const entries = Object.entries(draft).filter(
        ([k, v]) => v !== undefined && v !== null && v !== "" && (LEAD_FORM_KEYS as readonly string[]).includes(k),
      );
      setCreateForm((f) => {
        const next = { ...f };
        for (const [k, v] of entries) next[k] = String(v);
        return next;
      });
      setAiFields(new Set(entries.map(([k]) => k)));
      if (entries.length === 0) {
        setScanErr("Couldn't read any lead details from that image — fill the form manually.");
      }
    } catch (e) {
      setScanErr(e instanceof ApiError ? e.message : "Couldn't read the image");
    } finally {
      setScanning(false);
    }
  }

  async function doCreate() {
    if (createCompanyMissing || createEmailInvalid || createEmployeesInvalid) return;
    setCreateBusy(true);
    setCreateErr(null);
    try {
      const payload: Record<string, unknown> = {
        company_name: createForm.company_name!.trim(),
        source: aiFields.size > 0 ? "screenshot" : "manual",
      };
      for (const key of LEAD_FORM_KEYS) {
        if (key === "company_name") continue;
        const v = createForm[key]?.trim();
        if (v) payload[key] = v;
      }
      if (isManager && createAdvisorId) payload.advisor_id = createAdvisorId;
      await api.post("/api/leads", payload);
      setCreateOpen(false);
      setNotice(`"${createForm.company_name!.trim()}" added to leads`);
      setTimeout(() => setNotice(null), 4000);
      reload();
    } catch (e) {
      setCreateErr(e instanceof ApiError ? e.message : "Couldn't add the lead");
    } finally {
      setCreateBusy(false);
    }
  }

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
          <div className="row" style={{ gap: ".5rem" }}>
            <button className="btn" onClick={openCreate}>
              <Icon name="plus" size={16} /> Add lead
            </button>
            {isManager && (
              <Link className="btn secondary" to="/leads/import">
                <Icon name="upload" size={16} /> Import from Apollo
              </Link>
            )}
          </div>
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
            No leads yet. Add one with the “Add lead” button above
            {isManager ? (
              <>
                , or <Link to="/leads/import">import an Apollo export</Link>.
              </>
            ) : (
              " — or your manager will assign Apollo leads to you here."
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
                  <th className="th-sort" aria-sort={ariaSort("company")} onClick={() => toggleSort("company")}>
                    Company{sortArrow("company")}
                  </th>
                  <th>Contact</th>
                  <th className="th-sort" aria-sort={ariaSort("location")} onClick={() => toggleSort("location")}>
                    Location{sortArrow("location")}
                  </th>
                  <th className="th-sort" style={{ textAlign: "right" }} aria-sort={ariaSort("employees")} onClick={() => toggleSort("employees")}>
                    Employees{sortArrow("employees")}
                  </th>
                  {isManager && <th>Advisor</th>}
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {sortedLeads.map((l) => {
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
            <LeadFormFields
              form={form}
              set={(name, value) => setForm({ ...form, [name]: value })}
              companyMissing={editCompanyMissing}
              emailInvalid={editEmailInvalid}
              employeesInvalid={editEmployeesInvalid}
            />
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

      {createOpen && (
        <div className="modal-overlay" onClick={() => !createBusy && setCreateOpen(false)}>
          <div
            className="modal"
            style={{ maxWidth: 680, maxHeight: "85vh", overflowY: "auto" }}
            onClick={(e) => e.stopPropagation()}
            onPaste={(e) => {
              const item = Array.from(e.clipboardData.items).find((i) => i.type.startsWith("image/"));
              const f = item?.getAsFile();
              if (f) {
                e.preventDefault();
                void sendImage(f);
              }
            }}
          >
            <h3 style={{ marginTop: 0 }}>Add lead</h3>

            {/* AI photo scan — mirrors the voice-capture card on New Opportunity. */}
            <div className="card" style={{ borderColor: "var(--insight-border)", background: "var(--color-primary-soft)" }}>
              <div className="row" style={{ justifyContent: "flex-start", gap: ".75rem" }}>
                <span className="icon-tile" style={{ background: "#fff" }}>
                  <Icon name="sparkles" size={20} />
                </span>
                <div style={{ flex: 1 }}>
                  <strong>Scan a photo or screenshot</strong>
                  <div className="muted" style={{ fontSize: ".8rem" }}>
                    {!scanEnabled
                      ? "Add an OpenAI API key on the server to enable AI photo scan."
                      : scanning
                        ? "Reading the image with AI…"
                        : "A LinkedIn profile, business card or email signature — AI pre-fills the form for you to review. You can also paste an image here."}
                  </div>
                </div>
                <button
                  type="button"
                  className="btn"
                  disabled={!scanEnabled || scanning}
                  onClick={() => scanInputRef.current?.click()}
                >
                  <Icon name="image" size={16} /> {scanning ? "Working…" : "Scan"}
                </button>
              </div>
              {scanErr && <div className="error-banner" style={{ marginTop: ".75rem", marginBottom: 0 }}>{scanErr}</div>}
            </div>
            {/* No `capture` attribute: mobile browsers then offer BOTH camera and photo
                library, so a saved LinkedIn screenshot is as reachable as a fresh photo. */}
            <input
              ref={scanInputRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void sendImage(f);
                e.target.value = "";
              }}
            />

            <ErrorBanner message={createErr} />

            {isManager && advisors.length > 0 && (
              <div className="field">
                <label>Assign to</label>
                <select value={createAdvisorId} onChange={(e) => setCreateAdvisorId(e.target.value)}>
                  <option value={user?.id ?? ""}>Me{user?.fullName ? ` (${user.fullName})` : ""}</option>
                  {advisors
                    .filter((a) => a.id !== user?.id)
                    .map((a) => (
                      <option key={a.id} value={a.id}>{a.fullName}</option>
                    ))}
                </select>
              </div>
            )}

            <LeadFormFields
              form={createForm}
              set={setCreateField}
              aiFields={aiFields}
              companyMissing={createCompanyMissing}
              emailInvalid={createEmailInvalid}
              employeesInvalid={createEmployeesInvalid}
            />

            <div className="row" style={{ gap: ".5rem", justifyContent: "flex-end", marginTop: ".5rem" }}>
              <button className="btn secondary" disabled={createBusy} onClick={() => setCreateOpen(false)}>
                Cancel
              </button>
              <button
                className="btn"
                disabled={createBusy || scanning || createCompanyMissing || createEmailInvalid || createEmployeesInvalid}
                onClick={doCreate}
              >
                {createBusy ? "Adding…" : "Add lead"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Label with an optional "AI" badge — shown on Add-lead fields the photo scan filled. */
function FieldLabel({ ai, children }: { ai?: boolean; children: string }) {
  return (
    <label>
      {children}
      {ai && (
        <span className="badge ai" style={{ marginLeft: 6, fontSize: ".62rem", padding: "1px 6px" }}>
          <Icon name="sparkles" size={11} /> AI
        </span>
      )}
    </label>
  );
}

function EditField({
  label,
  name,
  form,
  set,
  ai,
}: {
  label: string;
  name: string;
  form: Record<string, string>;
  set: (name: string, value: string) => void;
  ai?: boolean;
}) {
  return (
    <div className="field" style={{ flex: 1 }}>
      <FieldLabel ai={ai}>{label}</FieldLabel>
      <input value={form[name] ?? ""} onChange={(e) => set(name, e.target.value)} />
    </div>
  );
}

/** The full lead field grid — shared by the Edit and Add modals. `aiFields` marks
 *  AI-prefilled fields with a badge (Add modal); `set` clears a badge on manual edit. */
function LeadFormFields({
  form,
  set,
  aiFields,
  companyMissing,
  emailInvalid,
  employeesInvalid,
}: {
  form: Record<string, string>;
  set: (name: string, value: string) => void;
  aiFields?: Set<string>;
  companyMissing: boolean;
  emailInvalid: boolean;
  employeesInvalid: boolean;
}) {
  const ai = (name: string) => aiFields?.has(name) ?? false;
  return (
    <>
      <div className="field">
        <FieldLabel ai={ai("company_name")}>Company name *</FieldLabel>
        <input value={form.company_name ?? ""} onChange={(e) => set("company_name", e.target.value)} />
        {companyMissing && <div className="field-error">Company name is required</div>}
      </div>
      <div className="row" style={{ gap: ".6rem" }}>
        <EditField label="First name" name="first_name" form={form} set={set} ai={ai("first_name")} />
        <EditField label="Last name" name="last_name" form={form} set={set} ai={ai("last_name")} />
      </div>
      <div className="row" style={{ gap: ".6rem" }}>
        <EditField label="Title" name="title" form={form} set={set} ai={ai("title")} />
        <EditField label="Department" name="department" form={form} set={set} ai={ai("department")} />
      </div>
      <div className="field">
        <FieldLabel ai={ai("email")}>Email</FieldLabel>
        <input type="email" value={form.email ?? ""} onChange={(e) => set("email", e.target.value)} />
        {emailInvalid && <div className="field-error">Enter a valid email address</div>}
      </div>
      <div className="row" style={{ gap: ".6rem" }}>
        <EditField label="Corporate phone" name="corporate_phone" form={form} set={set} ai={ai("corporate_phone")} />
        <EditField label="Company phone" name="company_phone" form={form} set={set} ai={ai("company_phone")} />
      </div>
      <div className="row" style={{ gap: ".6rem" }}>
        <EditField label="Website" name="website" form={form} set={set} ai={ai("website")} />
        <EditField label="LinkedIn" name="linkedin_url" form={form} set={set} ai={ai("linkedin_url")} />
      </div>
      <EditField label="Company address" name="company_address" form={form} set={set} ai={ai("company_address")} />
      <div className="row" style={{ gap: ".6rem" }}>
        <EditField label="City" name="company_city" form={form} set={set} ai={ai("company_city")} />
        <EditField label="State" name="company_state" form={form} set={set} ai={ai("company_state")} />
      </div>
      <div className="row" style={{ gap: ".6rem" }}>
        <div className="field" style={{ flex: 1 }}>
          <FieldLabel ai={ai("num_employees")}># Employees</FieldLabel>
          <input inputMode="numeric" value={form.num_employees ?? ""} onChange={(e) => set("num_employees", e.target.value)} />
          {employeesInvalid && <div className="field-error">Enter a whole number</div>}
        </div>
        <EditField label="Annual revenue" name="annual_revenue" form={form} set={set} ai={ai("annual_revenue")} />
      </div>
      <EditField label="Subsidiary of" name="subsidiary_of" form={form} set={set} ai={ai("subsidiary_of")} />
      <EditField label="Technologies" name="technologies" form={form} set={set} ai={ai("technologies")} />
      <EditField label="Keywords" name="keywords" form={form} set={set} ai={ai("keywords")} />
      <div className="field">
        <FieldLabel ai={ai("notes")}>Notes</FieldLabel>
        <textarea rows={3} value={form.notes ?? ""} onChange={(e) => set("notes", e.target.value)} />
      </div>
    </>
  );
}

/** Advisor Notes on a lead: dated entries advisors add over time, each editable
 *  by its author (or a super admin). Separate from the Apollo-imported Notes field. */
function AdvisorNotes({ leadId }: { leadId: string }) {
  const { user, isManager } = useAuth();
  const { data, loading, reload } = useApi<{ notes: LeadNote[] }>(`/api/leads/${leadId}/notes`, [leadId]);
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const notes = data?.notes ?? [];

  async function add() {
    if (!draft.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      await api.post(`/api/leads/${leadId}/notes`, { body: draft });
      setDraft("");
      reload();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not add the note");
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit(noteId: string) {
    if (!editDraft.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      await api.patch(`/api/leads/${leadId}/notes/${noteId}`, { body: editDraft });
      setEditingId(null);
      reload();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not save the note");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ padding: "0 1.25rem 1rem" }}>
      <div className="lead-detail-label" style={{ marginBottom: ".35rem" }}>Advisor Notes</div>
      <ErrorBanner message={err} />
      {loading ? (
        <div className="muted" style={{ fontSize: ".82rem" }}>Loading notes…</div>
      ) : notes.length === 0 ? (
        <div className="muted" style={{ fontSize: ".82rem" }}>No advisor notes yet.</div>
      ) : (
        notes.map((n) => {
          const edited = n.updatedAt !== n.createdAt;
          const canEdit = isManager || n.authorId === user?.id;
          return (
            <div key={n.id} style={{ padding: ".45rem 0", borderBottom: "1px solid var(--color-border)" }}>
              <div className="row" style={{ justifyContent: "flex-start", gap: ".5rem", flexWrap: "wrap" }}>
                <span className="muted" style={{ fontSize: ".78rem" }}>
                  {n.authorName ?? "Advisor"} · {dateShort(n.createdAt)}
                  {edited && ` · edited ${dateShort(n.updatedAt)}`}
                </span>
                {canEdit && editingId !== n.id && (
                  <button
                    className="btn small ghost"
                    onClick={() => { setEditingId(n.id); setEditDraft(n.body); setErr(null); }}
                  >
                    <Icon name="edit" size={13} /> Edit
                  </button>
                )}
              </div>
              {editingId === n.id ? (
                <div style={{ marginTop: ".35rem" }}>
                  <textarea
                    rows={3}
                    maxLength={4000}
                    value={editDraft}
                    onChange={(e) => setEditDraft(e.target.value)}
                    style={{ width: "100%" }}
                  />
                  <div className="row" style={{ justifyContent: "flex-start", gap: ".5rem", marginTop: ".35rem" }}>
                    <button className="btn small" disabled={busy || !editDraft.trim()} onClick={() => saveEdit(n.id)}>
                      {busy ? "Saving…" : "Save"}
                    </button>
                    <button className="btn small secondary" disabled={busy} onClick={() => setEditingId(null)}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{ marginTop: ".2rem", whiteSpace: "pre-wrap" }}>{n.body}</div>
              )}
            </div>
          );
        })
      )}
      <div className="row" style={{ justifyContent: "flex-start", gap: ".5rem", marginTop: ".6rem", alignItems: "flex-start" }}>
        <textarea
          rows={2}
          maxLength={4000}
          placeholder="Add a note about this lead…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          style={{ flex: 1 }}
        />
        <button className="btn small" disabled={busy || !draft.trim()} onClick={add}>
          Add note
        </button>
      </div>
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
    // The Apollo-imported notes, dated with when the lead came in.
    { label: `Notes · ${dateShort(l.createdAt)}`, value: l.notes, wide: true },
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
        <AdvisorNotes leadId={l.id} />
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
