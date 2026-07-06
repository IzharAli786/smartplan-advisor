import { useState } from "react";
import { Link } from "react-router-dom";
import { useApi } from "../hooks/useApi.ts";
import { useAuth } from "../auth/AuthContext.tsx";
import { useStages } from "../hooks/useSettings.ts";
import { api } from "../api/client.ts";
import { AgeIndicator, Card, ErrorBanner, PageHead, Spinner, StatCard, StatGrid } from "../components/ui.tsx";
import { Icon } from "../components/Icon.tsx";
import USStateHeatmap from "../components/USStateHeatmap.tsx";
import { BarChart, HBars, Donut } from "../components/charts.tsx";

interface Analytics {
  monthly: { ym: string; label: string; wonValue: number; wonCount: number; newCount: number }[];
  pipeline: { label: string; count: number; value: number }[];
  products: { product: string; value: number }[];
}
import { money } from "../lib/format.ts";
import type { AdvisorRollup, ClaimRequest, CurrentUser, Opportunity } from "../api/types.ts";

export default function DashboardPage() {
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const { data: opps, loading: lo, error: eo, reload } = useApi<{ opportunities: Opportunity[] }>("/api/opportunities");
  const { data: usersData } = useApi<{ users: CurrentUser[] }>("/api/users");
  const { data: stagesData } = useStages();
  const { data: advisors } = useApi<{ advisors: AdvisorRollup[] }>("/api/dashboard/by-advisor");
  const { data: claims } = useApi<{ claimRequests: ClaimRequest[] }>("/api/claim-requests?status=pending");
  const { data: analytics } = useApi<Analytics>("/api/dashboard/analytics");

  const stages = (stagesData?.stages ?? []).filter((s) => s.active);
  const advisorName = new Map((usersData?.users ?? []).map((u) => [u.id, u.fullName]));
  const rollup = advisors?.advisors ?? [];

  const all = opps?.opportunities ?? [];
  const q = search.trim().toLowerCase();
  const rows = all.filter((o) => {
    if (stateFilter && (o.state || "").toUpperCase() !== stateFilter) return false;
    if (q) {
      const hay = [o.contractorCompanyName, advisorName.get(o.advisorId) ?? "", o.product ?? "", o.state, o.status].join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const totals = {
    advisors: rollup.length,
    open: rollup.reduce((s, a) => s + a.openOpps, 0),
    value: rollup.reduce((s, a) => s + a.openValue, 0),
    won: rollup.reduce((s, a) => s + a.wonCount, 0),
    pending: claims?.claimRequests.length ?? 0,
  };
  const noActivity = rollup.filter((a) => a.totalOpps === 0);

  // Opportunities by US state → heatmap.
  const stateCounts: Record<string, number> = {};
  const stateValues: Record<string, number> = {};
  for (const o of all) {
    const st = (o.state || "").toUpperCase();
    if (!st) continue;
    stateCounts[st] = (stateCounts[st] ?? 0) + 1;
    stateValues[st] = (stateValues[st] ?? 0) + (o.opportunityValue ?? 0);
  }

  // Period comparison — this month vs last month.
  const months = analytics?.monthly ?? [];
  const cur = months[months.length - 1];
  const prev = months[months.length - 2];
  const deltaPct = (a: number, b: number) => (b > 0 ? Math.round(((a - b) / b) * 100) : a > 0 ? 100 : 0);

  async function patchOpp(id: string, body: Record<string, unknown>) {
    setSavingId(id);
    setSaveError(null);
    try {
      await api.patch(`/api/opportunities/${id}`, body);
      reload();
    } catch {
      setSaveError("Couldn't save that change — try again.");
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div>
      <PageHead
        title="Dashboard"
        subtitle={`Welcome ${user?.fullName?.split(" ")[0] ?? ""}. Here's what's happening today.`}
        actions={
          <>
            <Link className="btn secondary" to="/reports">
              View Reports
            </Link>
            <Link className="btn" to="/claims">
              Review Requests
            </Link>
          </>
        }
      />

      <StatGrid>
        <StatCard label="Open Opportunities" value={totals.open} sub="Across all advisors" icon={<Icon name="pipeline" />} to="/pipeline" />
        <StatCard label="Pipeline Value" value={money(totals.value)} sub="Open, not yet won" icon={<Icon name="briefcase" />} to="/pipeline" />
        <StatCard label="Won Deals" value={totals.won} sub="Converted" icon={<Icon name="check-circle" />} to="/reports" />
        <StatCard label="Smart Advisors" value={totals.advisors} sub="Active roster" icon={<Icon name="users" />} to="/users" />
        <StatCard label="Pending Requests" value={totals.pending} sub="Awaiting review" icon={<Icon name="requests" />} to="/claims" />
      </StatGrid>

      {analytics && (
        <div className="chart-grid">
          <Card>
            <div className="row">
              <h3>Won revenue — last 12 months</h3>
              {cur && prev && <DeltaBadge cur={cur.wonValue} prev={prev.wonValue} />}
            </div>
            <div style={{ marginTop: ".6rem" }}>
              <BarChart data={months.map((m) => ({ label: m.label, value: m.wonValue, sub: `${m.wonCount} deal${m.wonCount === 1 ? "" : "s"}` }))} />
            </div>
          </Card>

          <Card>
            <h3>This month vs last month</h3>
            <div className="stack" style={{ gap: ".65rem", marginTop: ".6rem" }}>
              <CompareRow label="Won revenue" cur={cur?.wonValue ?? 0} prev={prev?.wonValue ?? 0} currency />
              <CompareRow label="Won deals" cur={cur?.wonCount ?? 0} prev={prev?.wonCount ?? 0} />
              <CompareRow label="New opportunities" cur={cur?.newCount ?? 0} prev={prev?.newCount ?? 0} />
            </div>
          </Card>

          <Card>
            <h3>Pipeline by stage</h3>
            <div style={{ marginTop: ".6rem" }}>
              <HBars data={analytics.pipeline.map((p) => ({ label: p.label, value: p.value, sub: `${p.count} · ${money(p.value)}` }))} />
            </div>
          </Card>

          <Card>
            <h3>Won by product — YTD</h3>
            <div style={{ marginTop: ".6rem" }}>
              <Donut data={analytics.products.map((p) => ({ label: p.product, value: p.value }))} />
            </div>
          </Card>
        </div>
      )}

      <Card>
        <div className="row">
          <h3 style={{ display: "flex", alignItems: "center", gap: ".4rem" }}>
            <Icon name="pipeline" size={17} /> Pipeline by State
          </h3>
          <span className="muted" style={{ fontSize: ".8rem" }}>
            {stateFilter ? `Filtering pipeline by ${stateFilter} — click again to clear` : `${Object.keys(stateCounts).length} states active · click a state to filter`}
          </span>
        </div>
        <div style={{ marginTop: ".75rem" }}>
          <USStateHeatmap
            counts={stateCounts}
            values={stateValues}
            selected={stateFilter}
            onSelect={(code) => setStateFilter((cur) => (cur === code ? null : code))}
          />
        </div>
      </Card>

      <div className="dash-grid with-aside">
        <div>
          <div className="field" style={{ position: "relative" }}>
            <input
              placeholder="Search opportunities — company, advisor, product, state or status…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ paddingLeft: "2.25rem" }}
            />
            <span style={{ position: "absolute", left: ".7rem", top: "11px", color: "var(--color-text-muted)" }}>
              <Icon name="search" size={18} />
            </span>
          </div>

          <ErrorBanner message={eo || saveError} />

          {stateFilter && (
            <div className="row" style={{ justifyContent: "flex-start", gap: ".5rem", marginBottom: ".5rem" }}>
              <span className="filter-chip">
                State: {stateFilter}
                <button type="button" onClick={() => setStateFilter(null)} aria-label={`Clear ${stateFilter} filter`}>
                  ✕
                </button>
              </span>
            </div>
          )}

          {lo ? (
            <Spinner />
          ) : rows.length === 0 ? (
            <div className="muted" style={{ padding: "1rem" }}>
              {all.length === 0
                ? "No opportunities yet."
                : stateFilter
                  ? `No opportunities in ${stateFilter}${search ? ` matching “${search}”` : ""}.`
                  : `No opportunities match “${search}”.`}
            </div>
          ) : (
            <Card>
              <div className="row" style={{ marginBottom: ".5rem" }}>
                <strong>Pipeline{stateFilter ? ` · ${stateFilter}` : ""}</strong>
                <span className="muted" style={{ fontSize: ".8rem" }}>{rows.length} shown · edit inline</span>
              </div>
              <div className="scroll-x">
                <table className="grid-table">
                  <thead>
                    <tr>
                      <th>Company</th>
                      <th>Advisor</th>
                      <th>Product</th>
                      <th style={{ textAlign: "right" }}>Deal value</th>
                      <th>Status</th>
                      <th>State</th>
                      <th>Age</th>
                      <th>Next review</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((o) => (
                      <tr key={o.id} style={{ opacity: savingId === o.id ? 0.5 : 1 }}>
                        <td>
                          <Link to={`/opportunity/${o.id}`} style={{ fontWeight: 600 }}>
                            {o.contractorCompanyName}
                          </Link>
                        </td>
                        <td className="muted">{advisorName.get(o.advisorId) ?? "—"}</td>
                        <td className="muted">{o.product ?? "—"}</td>
                        <td style={{ textAlign: "right" }}>
                          <input
                            type="number"
                            inputMode="decimal"
                            defaultValue={o.opportunityValue ?? ""}
                            style={{ width: 110, textAlign: "right" }}
                            onBlur={(e) => {
                              const v = e.target.value === "" ? null : Number(e.target.value);
                              if (v !== (o.opportunityValue ?? null)) patchOpp(o.id, { opportunity_value: v });
                            }}
                          />
                        </td>
                        <td>
                          <select value={o.status} onChange={(e) => patchOpp(o.id, { status: e.target.value })} style={{ minWidth: 130 }}>
                            {stages.map((s) => (
                              <option key={s.key} value={s.key}>
                                {s.label}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>{o.state}</td>
                        <td><AgeIndicator since={o.createdAt} suffix="" /></td>
                        <td>
                          <input
                            type="date"
                            defaultValue={o.nextReviewAt ? o.nextReviewAt.slice(0, 10) : ""}
                            style={{ width: 150 }}
                            onBlur={(e) => {
                              const cur = o.nextReviewAt ? o.nextReviewAt.slice(0, 10) : "";
                              if (e.target.value !== cur)
                                patchOpp(o.id, { next_review_at: e.target.value ? new Date(e.target.value).toISOString() : null });
                            }}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>

        {/* Insights — derived from real data (not an AI claim) */}
        <aside className="insight-panel">
          <div className="insight-head">
            <Icon name="sparkles" size={18} /> Insights
          </div>
          <div className="muted" style={{ fontSize: ".8125rem", marginTop: ".35rem" }}>
            A quick read on where attention is needed across the pipeline.
          </div>

          {totals.pending > 0 && (
            <div className="insight-card warn">
              <div className="ic-title">
                <Icon name="requests" size={15} /> Takeover requests waiting
              </div>
              <div className="ic-body">
                {totals.pending} request{totals.pending > 1 ? "s" : ""} need a decision so advisors aren't blocked.
              </div>
              <Link className="btn warn-outline small full" to="/claims">
                Review
              </Link>
            </div>
          )}

          {noActivity.length > 0 && (
            <div className="insight-card info">
              <div className="ic-title">
                <Icon name="pipeline" size={15} /> Advisors with no opportunities
              </div>
              <div className="ic-body">
                {noActivity.map((a) => a.fullName).join(", ")} {noActivity.length > 1 ? "have" : "has"} nothing in the pipeline yet.
              </div>
            </div>
          )}

          {totals.value === 0 && rollup.length > 0 && (
            <div className="insight-card alert">
              <div className="ic-title">
                <Icon name="alert-triangle" size={15} /> No open pipeline value
              </div>
              <div className="ic-body">No open opportunities carry a value yet — encourage advisors to log deal sizes.</div>
            </div>
          )}

          {totals.pending === 0 && noActivity.length === 0 && totals.value > 0 && (
            <div className="insight-card info">
              <div className="ic-title">
                <Icon name="check-circle" size={15} /> Pipeline looks healthy
              </div>
              <div className="ic-body">No blocked advisors and value is flowing. Keep it up.</div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function DeltaBadge({ cur, prev }: { cur: number; prev: number }) {
  const pct = prev > 0 ? Math.round(((cur - prev) / prev) * 100) : cur > 0 ? 100 : 0;
  const up = cur >= prev;
  return (
    <span className={`delta ${up ? "up" : "down"}`}>
      {up ? "▲" : "▼"} {Math.abs(pct)}% vs last mo
    </span>
  );
}

function CompareRow({ label, cur, prev, currency }: { label: string; cur: number; prev: number; currency?: boolean }) {
  const pct = prev > 0 ? Math.round(((cur - prev) / prev) * 100) : cur > 0 ? 100 : 0;
  const up = cur >= prev;
  const show = (n: number) => (currency ? money(n) : String(n));
  return (
    <div className="row">
      <div>
        <div className="muted" style={{ fontSize: ".75rem" }}>{label}</div>
        <strong style={{ fontSize: "1.1rem" }}>{show(cur)}</strong>
        <span className="muted" style={{ fontSize: ".72rem", marginLeft: 6 }}>from {show(prev)}</span>
      </div>
      <span className={`delta ${up ? "up" : "down"}`}>{up ? "▲" : "▼"} {Math.abs(pct)}%</span>
    </div>
  );
}
