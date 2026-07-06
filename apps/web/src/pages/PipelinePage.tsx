import { useState } from "react";
import { Link } from "react-router-dom";
import { useApi } from "../hooks/useApi.ts";
import { useStages, stageLabelMap, prettyKey } from "../hooks/useSettings.ts";
import { AgeIndicator, Card, EmptyState, ErrorBanner, PageHead, Progress, Spinner, StatCard, StatGrid, StatusBadge } from "../components/ui.tsx";
import { Icon } from "../components/Icon.tsx";
import { money } from "../lib/format.ts";
import { useAuth } from "../auth/AuthContext.tsx";
import type { Opportunity, StatusStage } from "../api/types.ts";

/** Rough completion % from stage order, so cards mirror the reference "Recent Proposals". */
function completion(status: string, stages: StatusStage[]): number {
  const active = stages.filter((s) => s.active).sort((a, b) => a.sortOrder - b.sortOrder);
  const idx = active.findIndex((s) => s.key === status);
  const stage = active[idx];
  if (stage?.isConversion) return 100;
  if (stage?.isTerminal) return 0;
  if (idx < 0 || active.length <= 1) return 0;
  return Math.round((idx / (active.length - 1)) * 100);
}

export default function PipelinePage() {
  const { isManager } = useAuth();
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const { data: stagesData } = useStages();
  const { data, loading, error } = useApi<{ opportunities: Opportunity[] }>("/api/opportunities");
  const labels = stageLabelMap(stagesData?.stages);
  const stages = (stagesData?.stages ?? []).filter((s) => s.active);
  const stageMap = new Map((stagesData?.stages ?? []).map((s) => [s.key, s]));

  const all = data?.opportunities ?? [];
  // Date filter is applied to the logged (created) date; drives both summary + list.
  const dateFiltered = all.filter((o) => {
    const day = o.createdAt.slice(0, 10);
    return (!fromDate || day >= fromDate) && (!toDate || day <= toDate);
  });
  const visible = statusFilter ? dateFiltered.filter((o) => o.status === statusFilter) : dateFiltered;

  const num = (v: number | null | undefined) => (v == null ? 0 : v);
  const summary = {
    total: dateFiltered.length,
    open: dateFiltered.filter((o) => !stageMap.get(o.status)?.isTerminal).length,
    openValue: dateFiltered.filter((o) => !stageMap.get(o.status)?.isTerminal).reduce((s, o) => s + num(o.opportunityValue), 0),
    won: dateFiltered.filter((o) => stageMap.get(o.status)?.isConversion).length,
    totalValue: dateFiltered.reduce((s, o) => s + num(o.opportunityValue), 0),
  };
  const countFor = (key: string) => dateFiltered.filter((o) => o.status === key).length;

  return (
    <div>
      <PageHead
        title={isManager ? "All Opportunities" : "My Pipeline"}
        subtitle={isManager ? "Every advisor's opportunities" : "Your opportunities by stage"}
        actions={
          isManager ? (
            <Link className="btn secondary" to="/pipeline/import">
              <Icon name="upload" size={16} /> Import from Excel (AI)
            </Link>
          ) : (
            <Link className="btn" to="/new">
              + New Opportunity
            </Link>
          )
        }
      />
      <ErrorBanner message={error} />

      {/* Summary panels — reflect the selected date range */}
      <StatGrid>
        <StatCard label="Opportunities" value={summary.total} sub={fromDate || toDate ? "In date range" : "All time"} icon={<Icon name="pipeline" />} />
        <StatCard label="Open" value={summary.open} sub="In progress" icon={<Icon name="clock" />} />
        <StatCard label="Open Pipeline Value" value={money(summary.openValue)} sub="Open, not yet won" icon={<Icon name="briefcase" />} />
        <StatCard label="Won" value={summary.won} sub="Converted" icon={<Icon name="check-circle" />} />
        <StatCard label="Total Value" value={money(summary.totalValue)} sub="All stages" icon={<Icon name="reports" />} />
      </StatGrid>

      {/* Date filter (logged date) */}
      <Card>
        <div className="row" style={{ gap: ".5rem", justifyContent: "flex-start", flexWrap: "wrap", alignItems: "flex-end" }}>
          <div className="field" style={{ margin: 0 }}>
            <label style={{ fontSize: ".75rem" }}>From</label>
            <input type="date" value={fromDate} max={toDate || undefined} onChange={(e) => setFromDate(e.target.value)} />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label style={{ fontSize: ".75rem" }}>To</label>
            <input type="date" value={toDate} min={fromDate || undefined} onChange={(e) => setToDate(e.target.value)} />
          </div>
          {(fromDate || toDate) && (
            <button className="btn small ghost" onClick={() => { setFromDate(""); setToDate(""); }}>
              <Icon name="x" size={14} /> Clear
            </button>
          )}
          <span className="muted" style={{ fontSize: ".8rem", marginLeft: "auto" }}>{visible.length} shown</span>
        </div>
      </Card>

      <div className="tabs">
        <button className={`tab ${statusFilter === "" ? "active" : ""}`} onClick={() => setStatusFilter("")}>
          All ({dateFiltered.length})
        </button>
        {stages.map((s) => (
          <button
            key={s.key}
            className={`tab ${statusFilter === s.key ? "active" : ""}`}
            onClick={() => setStatusFilter(s.key)}
          >
            {s.label} ({countFor(s.key)})
          </button>
        ))}
      </div>

      {loading ? (
        <Spinner />
      ) : all.length === 0 ? (
        <EmptyState
          icon="pipeline"
          title="No opportunities yet"
          hint="Log your first opportunity to start building your pipeline."
          actionLabel="Log your first opportunity"
          actionTo="/new"
        />
      ) : visible.length === 0 ? (
        <EmptyState icon="pipeline" title="No opportunities match these filters" hint="Try a wider date range or a different stage." />
      ) : (
        visible.map((o) => {
          const c = completion(o.status, stagesData?.stages ?? []);
          return (
            <Link key={o.id} to={`/opportunity/${o.id}`} style={{ color: "inherit" }}>
              <Card onClick={() => {}}>
                <div className="row">
                  <div className="row" style={{ gap: ".75rem", justifyContent: "flex-start" }}>
                    <span className="icon-tile">
                      <Icon name="building" size={20} />
                    </span>
                    <div>
                      <strong>{o.contractorCompanyName}</strong>
                      <div className="muted" style={{ fontSize: ".82rem" }}>
                        {o.product ?? "—"} · {o.state}
                      </div>
                    </div>
                  </div>
                  <StatusBadge label={labels[o.status] ?? prettyKey(o.status)} />
                </div>
                <div style={{ marginTop: ".75rem" }}>
                  <div className="row">
                    <span className="muted" style={{ fontSize: ".78rem" }}>
                      Completion
                    </span>
                    <span className="muted" style={{ fontSize: ".78rem" }}>
                      {c}%
                    </span>
                  </div>
                  <Progress value={c} />
                  <div className="row">
                    <span className="row" style={{ gap: ".5rem", justifyContent: "flex-start" }}>
                      <span className="muted" style={{ fontSize: ".82rem" }}>
                        {o.opportunityValue != null ? money(o.opportunityValue) : "Value TBD"}
                      </span>
                      <AgeIndicator since={o.createdAt} suffix="" />
                    </span>
                    <span className="muted" style={{ display: "inline-flex" }}>
                      <Icon name="arrow-up-right" size={16} />
                    </span>
                  </div>
                </div>
              </Card>
            </Link>
          );
        })
      )}
    </div>
  );
}
