import { useState } from "react";
import { Link } from "react-router-dom";
import { useApi } from "../hooks/useApi.ts";
import { Card, ErrorBanner, PageHead, Spinner } from "../components/ui.tsx";
import { Icon } from "../components/Icon.tsx";
import { fmt, exportPdf, exportXlsx } from "../lib/export.ts";
import type { ReportData, ReportMeta } from "../api/types.ts";

const firstOfYear = () => `${new Date().getFullYear()}-01-01`;
const today = () => new Date().toISOString().slice(0, 10);

export default function ReportsPage() {
  const { data: catalog } = useApi<{ reports: ReportMeta[] }>("/api/reports/catalog");
  const reports = catalog?.reports ?? [];
  const [selected, setSelected] = useState<string>("converted");
  const [from, setFrom] = useState(firstOfYear());
  const [to, setTo] = useState(today());

  const meta = reports.find((r) => r.key === selected);
  const path = `/api/reports/run/${selected}?from=${from}&to=${to}`;
  const { data, loading, error } = useApi<{ report: ReportData }>(path, [selected, from, to]);
  const report = data?.report;

  return (
    <div>
      <PageHead title="Reports" subtitle="Sales performance — export any report to PDF or Excel" />

      <div className="reports-grid">
        {/* Report picker */}
        <div className="stack">
          {reports.map((r) => (
            <Card key={r.key} onClick={() => setSelected(r.key)} className={r.key === selected ? "report-active" : ""}>
              <strong>{r.title}</strong>
              <div className="muted" style={{ fontSize: ".78rem", marginTop: 2 }}>
                {r.description}
              </div>
            </Card>
          ))}
        </div>

        {/* Selected report */}
        <div>
          <Card>
            <div className="row" style={{ flexWrap: "wrap", gap: ".75rem" }}>
              {meta?.dateRange ? (
                <div className="row" style={{ gap: ".5rem" }}>
                  <div className="field" style={{ marginBottom: 0 }}>
                    <label>From</label>
                    <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
                  </div>
                  <div className="field" style={{ marginBottom: 0 }}>
                    <label>To</label>
                    <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
                  </div>
                </div>
              ) : (
                <div className="muted">Current snapshot</div>
              )}
              <div className="row" style={{ gap: ".5rem", marginLeft: "auto" }}>
                <button className="btn secondary" disabled={!report} onClick={() => report && exportPdf(report, { from, to })}>
                  <Icon name="download" size={16} /> PDF
                </button>
                <button className="btn" disabled={!report} onClick={() => report && exportXlsx(report)}>
                  <Icon name="download" size={16} /> Excel
                </button>
              </div>
            </div>
          </Card>

          <ErrorBanner message={error} />
          {loading || !report ? (
            <Spinner />
          ) : (
            <Card>
              <h3>{report.title}</h3>
              {report.subtitle && <p className="muted" style={{ marginBottom: ".75rem" }}>{report.subtitle}</p>}
              <div className="scroll-x">
                <table>
                  <thead>
                    <tr>
                      {report.columns.map((c) => (
                        <th key={c.key} className={c.type === "currency" || c.type === "number" || c.type === "percent" ? "num" : ""}>
                          {c.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {report.rows.map((r, i) => (
                      <tr key={i}>
                        {report.columns.map((c) => (
                          <td key={c.key} className={c.type === "currency" || c.type === "number" || c.type === "percent" ? "num" : ""}>
                            {report.key === "smartplan-transactions" && c.key === "advisorName" && r.advisorId ? (
                              <Link to={`/advisors/${String(r.advisorId)}`}>{fmt(r[c.key], c.type)}</Link>
                            ) : (
                              fmt(r[c.key], c.type)
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                    {report.rows.length === 0 && (
                      <tr>
                        <td colSpan={report.columns.length} className="muted" style={{ textAlign: "center" }}>
                          No data for this range.
                        </td>
                      </tr>
                    )}
                  </tbody>
                  {report.totals && (
                    <tfoot>
                      <tr>
                        {report.columns.map((c) => (
                          <td
                            key={c.key}
                            className={c.type === "currency" || c.type === "number" || c.type === "percent" ? "num" : ""}
                            style={{ fontWeight: 700, borderTop: "2px solid var(--color-border)" }}
                          >
                            {report.totals && c.key in report.totals ? fmt(report.totals[c.key], c.type) : ""}
                          </td>
                        ))}
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
