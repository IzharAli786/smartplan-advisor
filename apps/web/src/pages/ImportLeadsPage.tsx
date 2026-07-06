import { useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useApi } from "../hooks/useApi.ts";
import { api, ApiError } from "../api/client.ts";
import { Card, ErrorBanner, PageHead, StatusBadge } from "../components/ui.tsx";
import { Icon } from "../components/Icon.tsx";
import { parseSpreadsheet } from "../lib/xlsx-import.ts";
import { APOLLO_LEAD_FIELDS } from "@smart-crm/shared";
import type { CurrentUser } from "../api/types.ts";

interface MappedLead {
  company_name?: string;
  first_name?: string;
  last_name?: string;
  title?: string;
  email?: string;
  department?: string;
  corporate_phone?: string;
  num_employees?: number;
  keywords?: string;
  linkedin_url?: string;
  website?: string;
  company_address?: string;
  company_city?: string;
  company_state?: string;
  company_phone?: string;
  technologies?: string;
  annual_revenue?: string;
  subsidiary_of?: string;
}
type Preview = { index: number; status: "created" | "duplicate" | "in_pipeline"; detail?: string | null };

export default function ImportLeadsPage() {
  const navigate = useNavigate();
  const { data: usersData } = useApi<{ users: CurrentUser[] }>("/api/users");
  const advisors = (usersData?.users ?? []).filter((u) => u.role === "advisor" && u.active);

  const fileRef = useRef<HTMLInputElement>(null);
  const [advisorId, setAdvisorId] = useState("");
  const [step, setStep] = useState<"setup" | "review" | "done">("setup");
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<MappedLead[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [unmatched, setUnmatched] = useState<string[]>([]);
  const [previews, setPreviews] = useState<Record<number, Preview>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ created: number; skipped: number } | null>(null);

  const advisorName = advisors.find((a) => a.id === advisorId)?.fullName ?? "";
  const mappedCount = Object.keys(mapping).length;

  async function onFile(file: File) {
    if (!advisorId) {
      setError("Choose a Smart Advisor first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { headers, rows: raw } = await parseSpreadsheet(file);
      if (headers.length === 0) throw new Error("That file has no readable columns.");
      const res = await api.post<{ mapping: Record<string, string>; rows: MappedLead[]; unmatched: string[] }>(
        "/api/leads/import/analyze",
        { headers, rows: raw },
      );
      setFileName(file.name);
      setMapping(res.mapping);
      setUnmatched(res.unmatched);
      setRows(res.rows);
      setPreviews({});
      setStep("review");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Could not read that file");
    } finally {
      setBusy(false);
    }
  }

  async function checkDuplicates() {
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ previews: Preview[] }>("/api/leads/import", { advisor_id: advisorId, rows, dry_run: true });
      const map: Record<number, Preview> = {};
      for (const p of res.previews) map[p.index] = p;
      setPreviews(map);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not check for duplicates");
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ created: number; results: Preview[] }>("/api/leads/import", { advisor_id: advisorId, rows, dry_run: false });
      setResult({ created: res.created, skipped: rows.length - res.created });
      setStep("done");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  const skipCount = useMemo(() => Object.values(previews).filter((p) => p.status === "duplicate").length, [previews]);
  const pipeCount = useMemo(() => Object.values(previews).filter((p) => p.status === "in_pipeline").length, [previews]);

  return (
    <div>
      <Link to="/leads" className="muted" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
        <Icon name="chevron-left" size={16} /> Leads
      </Link>
      <PageHead
        title="Import leads from Apollo"
        subtitle="Pick a Smart Advisor, upload the Apollo export, and we'll map the columns and flag any duplicates"
      />
      <ErrorBanner message={error} />

      {step === "setup" && (
        <Card>
          <div className="stack" style={{ alignItems: "flex-start", gap: "1rem" }}>
            <div className="field" style={{ margin: 0, minWidth: 280, width: "100%", maxWidth: 420 }}>
              <label htmlFor="advisor">1 · Assign these leads to</label>
              <select id="advisor" value={advisorId} onChange={(e) => setAdvisorId(e.target.value)}>
                <option value="">Choose a Smart Advisor…</option>
                {advisors.map((a) => (
                  <option key={a.id} value={a.id}>{a.fullName}</option>
                ))}
              </select>
            </div>
            <div style={{ width: "100%" }}>
              <label className="field-label" style={{ display: "block", fontWeight: 600, marginBottom: ".35rem" }}>
                2 · Upload the Apollo file
              </label>
              <p className="muted" style={{ fontSize: ".85rem", marginTop: 0 }}>
                An <strong>.xlsx</strong> or <strong>.csv</strong> exported from Apollo. We read the standard Apollo columns
                (First/Last Name, Title, Company, Email, Corporate Phone, # Employees, Keywords, LinkedIn, Website, Company
                Address/City/State, Technologies, Annual Revenue, Subsidiary Of, …).
              </p>
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                style={{ display: "none" }}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }}
              />
              <button className="btn" disabled={busy || !advisorId} onClick={() => fileRef.current?.click()}>
                <Icon name="upload" size={16} /> {busy ? "Reading…" : "Choose Apollo export"}
              </button>
              {!advisorId && <div className="muted" style={{ fontSize: ".78rem", marginTop: ".4rem" }}>Select a Smart Advisor to enable upload.</div>}
            </div>
          </div>
        </Card>
      )}

      {step === "review" && (
        <>
          <Card>
            <div className="row">
              <div>
                <strong>{fileName}</strong>
                <div className="muted" style={{ fontSize: ".8rem" }}>
                  {rows.length} leads · {mappedCount} of {APOLLO_LEAD_FIELDS.length} Apollo fields matched · assigning to <strong>{advisorName}</strong>
                </div>
              </div>
              <button className="btn small secondary" onClick={() => { setStep("setup"); setRows([]); setPreviews({}); }}>
                Change advisor / file
              </button>
            </div>
            {unmatched.length > 0 && (
              <div className="muted" style={{ fontSize: ".78rem", marginTop: ".5rem" }}>
                Columns we didn't recognise (ignored): {unmatched.join(", ")}
              </div>
            )}
          </Card>

          <Card>
            <div className="scroll-x">
              <table className="grid-table">
                <thead>
                  <tr>
                    <th>Company</th>
                    <th>Contact</th>
                    <th>Email</th>
                    <th>Location</th>
                    <th style={{ textAlign: "right" }}>Employees</th>
                    <th>Check</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => {
                    const p = previews[i];
                    const person = [r.first_name, r.last_name].filter(Boolean).join(" ");
                    return (
                      <tr key={i}>
                        <td>
                          <strong>{r.company_name}</strong>
                          {r.subsidiary_of ? <div className="muted" style={{ fontSize: ".72rem" }}>↳ {r.subsidiary_of}</div> : null}
                        </td>
                        <td className="muted">{[person, r.title].filter(Boolean).join(" · ") || "—"}</td>
                        <td className="muted">{r.email || "—"}</td>
                        <td className="muted">{[r.company_city, r.company_state].filter(Boolean).join(", ") || "—"}</td>
                        <td style={{ textAlign: "right" }}>{r.num_employees ?? "—"}</td>
                        <td>
                          {p?.status === "in_pipeline" ? (
                            <StatusBadge label={p.detail ? `In pipeline · ${p.detail}` : "In pipeline"} kind="overdue" />
                          ) : p?.status === "duplicate" ? (
                            <StatusBadge label="Already a lead" kind="ai" />
                          ) : p ? (
                            <StatusBadge label="New" kind="success" />
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="row" style={{ gap: ".5rem", marginTop: ".75rem", justifyContent: "flex-start" }}>
              <button className="btn secondary" disabled={busy} onClick={checkDuplicates}>
                <Icon name="search" size={15} /> Check for duplicates
              </button>
              <button className="btn" disabled={busy || rows.length === 0} onClick={commit}>
                <Icon name="upload" size={15} /> {busy ? "Importing…" : `Import ${rows.length} lead${rows.length === 1 ? "" : "s"}`}
              </button>
            </div>
            {Object.keys(previews).length > 0 && (
              <div className="muted" style={{ fontSize: ".78rem", marginTop: ".5rem" }}>
                {skipCount > 0
                  ? `${skipCount} exact duplicate contact(s) already exist as leads and will be skipped. `
                  : "No duplicate contacts — every person is new. "}
                {pipeCount > 0 ? `${pipeCount} are at companies already in your pipeline (still imported, flagged above).` : ""}
              </div>
            )}
          </Card>
        </>
      )}

      {step === "done" && result && (
        <Card>
          <div className="success-banner">
            Imported {result.created} lead{result.created === 1 ? "" : "s"} for {advisorName}.
            {result.skipped > 0 ? ` ${result.skipped} duplicate(s) skipped.` : ""}
          </div>
          <div className="row" style={{ gap: ".5rem", marginTop: ".75rem", justifyContent: "flex-start" }}>
            <button className="btn" onClick={() => navigate(`/leads?advisorId=${advisorId}`)}>View leads</button>
            <button
              className="btn secondary"
              onClick={() => { setStep("setup"); setRows([]); setPreviews({}); setResult(null); setFileName(""); }}
            >
              Import another
            </button>
          </div>
        </Card>
      )}
    </div>
  );
}
