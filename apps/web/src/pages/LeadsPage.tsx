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
  const [busyId, setBusyId] = useState<string | null>(null);

  // Convert modal
  const [convertLead, setConvertLead] = useState<Lead | null>(null);
  const [cProduct, setCProduct] = useState("");
  const [cValue, setCValue] = useState("");
  const [cTechs, setCTechs] = useState("");

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
              {LEAD_STATUSES.map((s) => (
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
                            disabled={l.status === "converted"}
                            onChange={(e) => changeStatus(l, e.target.value)}
                          >
                            {LEAD_STATUSES.map((s) => (
                              <option key={s.value} value={s.value}>{s.label}</option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <div className="row" style={{ gap: 4, justifyContent: "flex-start" }}>
                            {l.convertedOpportunityId ? (
                              <Link className="btn small secondary" to={`/opportunity/${l.convertedOpportunityId}`}>Opportunity</Link>
                            ) : (
                              <button className="btn small" disabled={busyId === l.id} onClick={() => openConvert(l)}>
                                <Icon name="arrow-up-right" size={14} /> Convert
                              </button>
                            )}
                            {isManager && (
                              <button className="btn small secondary icon-only" aria-label="Delete" disabled={busyId === l.id} onClick={() => remove(l)}>
                                <Icon name="x" size={14} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                      {open && (
                        <tr>
                          <td colSpan={isManager ? 8 : 7} style={{ background: "var(--color-surface-2)" }}>
                            <div className="lead-detail-grid">
                              <Detail label="Email" value={l.email} />
                              <Detail label="Department" value={l.department} />
                              <Detail label="Corporate phone" value={l.corporatePhone} />
                              <Detail label="Company phone" value={l.companyPhone} />
                              <Detail label="Website" value={l.website} link />
                              <Detail label="LinkedIn" value={l.linkedinUrl} link />
                              <Detail label="Company address" value={l.companyAddress} />
                              <Detail label="Annual revenue" value={l.annualRevenue} />
                              <Detail label="Technologies" value={l.technologies} wide />
                              <Detail label="Keywords" value={l.keywords} wide />
                              {l.notes ? <Detail label="Notes" value={l.notes} wide /> : null}
                              <Detail label="Imported" value={dateShort(l.createdAt)} />
                            </div>
                          </td>
                        </tr>
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
    </div>
  );
}

function Detail({ label, value, link, wide }: { label: string; value: string | null | undefined; link?: boolean; wide?: boolean }) {
  return (
    <div style={wide ? { gridColumn: "1 / -1" } : undefined}>
      <div className="muted" style={{ fontSize: ".72rem", textTransform: "uppercase", letterSpacing: ".02em" }}>{label}</div>
      {value ? (
        link ? (
          <a href={value.startsWith("http") ? value : `https://${value}`} target="_blank" rel="noreferrer" style={{ wordBreak: "break-all" }}>{value}</a>
        ) : (
          <div style={{ fontSize: ".9rem" }}>{value}</div>
        )
      ) : (
        <div className="muted">—</div>
      )}
    </div>
  );
}
