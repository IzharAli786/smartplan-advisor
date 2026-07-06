import { useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useApi } from "../hooks/useApi.ts";
import { api, ApiError } from "../api/client.ts";
import { Card, ErrorBanner, PageHead, StatusBadge } from "../components/ui.tsx";
import { Icon } from "../components/Icon.tsx";
import { parseSpreadsheet } from "../lib/xlsx-import.ts";
import { money } from "../lib/format.ts";
import type { CurrentUser } from "../api/types.ts";

interface MappedRow {
  contractor_company_name?: string;
  contact_name?: string;
  contact_email?: string;
  contact_cell?: string;
  state?: string;
  product?: string;
  num_technicians?: number;
  opportunity_value?: number;
  notes?: string;
}
type Preview = { index: number; status: "created" | "conflict" | "duplicate" | "skipped"; ownerName?: string | null };

export default function ImportPipelinePage() {
  const navigate = useNavigate();
  const { data: usersData } = useApi<{ users: CurrentUser[] }>("/api/users");
  const advisors = (usersData?.users ?? []).filter((u) => u.role === "advisor" && u.active);

  const fileRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<"upload" | "review" | "done">("upload");
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<MappedRow[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [usedAi, setUsedAi] = useState(false);
  const [rowAdvisor, setRowAdvisor] = useState<string[]>([]);
  const [bulkAdvisor, setBulkAdvisor] = useState("");
  const [previews, setPreviews] = useState<Record<number, Preview>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState(0);

  const assignedRows = useMemo(
    () => rows.map((r, i) => ({ row: r, advisor: rowAdvisor[i] })).filter((x) => x.advisor && x.row.contractor_company_name),
    [rows, rowAdvisor],
  );

  async function onFile(file: File) {
    setBusy(true);
    setError(null);
    try {
      const { headers, rows: raw } = await parseSpreadsheet(file);
      if (headers.length === 0) throw new Error("That file has no readable columns.");
      const res = await api.post<{ mapping: Record<string, string>; usedAi: boolean; rows: MappedRow[] }>("/api/imports/pipeline/analyze", { headers, rows: raw });
      setFileName(file.name);
      setMapping(res.mapping);
      setUsedAi(res.usedAi);
      setRows(res.rows);
      setRowAdvisor(res.rows.map(() => ""));
      setPreviews({});
      setStep("review");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Could not read that file");
    } finally {
      setBusy(false);
    }
  }

  function assignAll(advisorId: string) {
    setBulkAdvisor(advisorId);
    if (advisorId) setRowAdvisor(rows.map(() => advisorId));
    setPreviews({});
  }

  function buildSent() {
    const sentIndices: number[] = [];
    const sentRows = rows
      .map((r, i) => ({ r, i }))
      .filter((x) => rowAdvisor[x.i] && x.r.contractor_company_name)
      .map((x) => {
        sentIndices.push(x.i);
        return { ...x.r, advisor_id: rowAdvisor[x.i] };
      });
    return { sentRows, sentIndices };
  }

  async function checkDuplicates() {
    const { sentRows, sentIndices } = buildSent();
    if (sentRows.length === 0) {
      setError("Assign a Smart Advisor to at least one row first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ previews: Preview[] }>("/api/imports/pipeline", { rows: sentRows, dry_run: true });
      const map: Record<number, Preview> = {};
      for (const p of res.previews) map[sentIndices[p.index]!] = p;
      setPreviews(map);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not check for duplicates");
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    const { sentRows } = buildSent();
    if (sentRows.length === 0) {
      setError("Assign a Smart Advisor to at least one row first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ created: number }>("/api/imports/pipeline", { rows: sentRows, dry_run: false });
      setCreated(res.created);
      setStep("done");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  const mappedFields = Object.keys(mapping).length;

  return (
    <div>
      <Link to="/pipeline" className="muted" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
        <Icon name="chevron-left" size={16} /> Pipeline
      </Link>
      <PageHead title="Import opportunities from Excel" subtitle="AI reads your spreadsheet, maps the columns, you assign advisors, and it flags duplicates" />
      <ErrorBanner message={error} />

      {step === "upload" && (
        <Card>
          <div className="stack" style={{ alignItems: "flex-start", gap: ".75rem" }}>
            <p className="muted" style={{ fontSize: ".9rem" }}>
              Upload an <strong>.xlsx</strong> or <strong>.csv</strong>. ChatGPT works out which column is the company, contact, product, value, etc. You review and assign each row to a Smart Advisor before anything is created.
            </p>
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }} />
            <button className="btn" disabled={busy} onClick={() => fileRef.current?.click()}>
              <Icon name="upload" size={16} /> {busy ? "Reading…" : "Choose spreadsheet"}
            </button>
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
                  {rows.length} rows · {mappedFields} fields mapped {usedAi ? "by AI" : "(header match)"}
                </div>
              </div>
              <div className="field" style={{ margin: 0, minWidth: 240 }}>
                <label style={{ fontSize: ".75rem" }}>Assign all rows to</label>
                <select value={bulkAdvisor} onChange={(e) => assignAll(e.target.value)}>
                  <option value="">Choose a Smart Advisor…</option>
                  {advisors.map((a) => (
                    <option key={a.id} value={a.id}>{a.fullName}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="muted" style={{ fontSize: ".78rem", marginTop: ".4rem" }}>
              Columns detected: {Object.entries(mapping).map(([f, h]) => `${f.replace(/_/g, " ")} ← "${h}"`).join(" · ") || "none"}
            </div>
          </Card>

          <Card>
            <div className="scroll-x">
              <table className="grid-table">
                <thead>
                  <tr>
                    <th>Company</th>
                    <th>Contact</th>
                    <th>State</th>
                    <th>Product</th>
                    <th style={{ textAlign: "right" }}>Value</th>
                    <th>Smart Advisor</th>
                    <th>Check</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => {
                    const p = previews[i];
                    return (
                      <tr key={i}>
                        <td><strong>{r.contractor_company_name}</strong></td>
                        <td className="muted">{[r.contact_name, r.contact_email, r.contact_cell].filter(Boolean).join(" · ") || "—"}</td>
                        <td>{r.state || "—"}</td>
                        <td className="muted">{r.product || "—"}</td>
                        <td style={{ textAlign: "right" }}>{r.opportunity_value != null ? money(r.opportunity_value) : "—"}</td>
                        <td>
                          <select value={rowAdvisor[i] ?? ""} onChange={(e) => { setRowAdvisor((ra) => ra.map((x, idx) => (idx === i ? e.target.value : x))); setPreviews((pv) => { const n = { ...pv }; delete n[i]; return n; }); }} style={{ minWidth: 150 }}>
                            <option value="">— unassigned —</option>
                            {advisors.map((a) => (
                              <option key={a.id} value={a.id}>{a.fullName}</option>
                            ))}
                          </select>
                        </td>
                        <td>
                          {p?.status === "conflict" ? (
                            <StatusBadge label={`Held by ${p.ownerName ?? "another advisor"}`} kind="overdue" />
                          ) : p?.status === "duplicate" ? (
                            <StatusBadge label="Already yours" kind="ai" />
                          ) : p ? (
                            <StatusBadge label="OK" kind="success" />
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
              <button className="btn" disabled={busy || assignedRows.length === 0} onClick={commit}>
                <Icon name="upload" size={15} /> {busy ? "Importing…" : `Import ${assignedRows.length} opportunit${assignedRows.length === 1 ? "y" : "ies"}`}
              </button>
            </div>
            {assignedRows.length < rows.length && (
              <div className="muted" style={{ fontSize: ".78rem", marginTop: ".5rem" }}>
                {rows.length - assignedRows.length} row(s) have no advisor assigned and will be skipped.
              </div>
            )}
          </Card>
        </>
      )}

      {step === "done" && (
        <Card>
          <div className="success-banner">Imported {created} opportunit{created === 1 ? "y" : "ies"} into the pipeline.</div>
          <div className="row" style={{ gap: ".5rem", marginTop: ".75rem", justifyContent: "flex-start" }}>
            <button className="btn" onClick={() => navigate("/pipeline")}>Go to Pipeline</button>
            <button className="btn secondary" onClick={() => { setStep("upload"); setRows([]); setPreviews({}); setBulkAdvisor(""); }}>Import another</button>
          </div>
        </Card>
      )}
    </div>
  );
}
