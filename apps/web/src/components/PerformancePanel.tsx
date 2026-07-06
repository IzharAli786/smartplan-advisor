import { useEffect, useState } from "react";
import { useApi } from "../hooks/useApi.ts";
import { api, ApiError } from "../api/client.ts";
import { Card, ErrorBanner, StatCard, StatGrid } from "./ui.tsx";
import { Icon } from "./Icon.tsx";
import { BadgeChip } from "./BadgeChip.tsx";
import { money } from "../lib/format.ts";
import type { ActivityEntry, ActivityTypeDef, PerformanceSummary } from "../api/types.ts";

const emptySetup = { days_to_sell: "250", hours_per_day: "6", annual_objective: "", close_rate: "", avg_sale_size: "", personal_objective: "" };

/**
 * Advisor performance: sales-plan setup, the activity-adjusted annual projection, ego
 * badges, and the activity log. Used on an advisor's own Performance page and (for a
 * manager) on the advisor's profile.
 */
export default function PerformancePanel({ advisorId }: { advisorId?: string }) {
  const qs = advisorId ? `?advisorId=${advisorId}` : "";
  const { data: summary, reload: reloadSummary } = useApi<PerformanceSummary>(`/api/performance/summary${qs}`, [advisorId]);
  const { data: actData, reload: reloadActs } = useApi<{ activities: ActivityEntry[] }>(`/api/performance/activities${qs}`, [advisorId]);
  const { data: typesData } = useApi<{ activityTypes: ActivityTypeDef[] }>("/api/settings/activity-types");
  const types = (typesData?.activityTypes ?? []).filter((t) => t.active);

  const [form, setForm] = useState(emptySetup);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [entry, setEntry] = useState({ activity_type_id: "", hours: "1", occurred_on: new Date().toISOString().slice(0, 10) });

  useEffect(() => {
    if (!summary) return;
    const s = summary.setup;
    setForm({
      days_to_sell: String(s.daysToSell),
      hours_per_day: String(s.hoursPerDay),
      annual_objective: s.annualObjective ? String(s.annualObjective) : "",
      close_rate: s.closeRate ? String(s.closeRate) : "",
      avg_sale_size: s.avgSaleSize ? String(s.avgSaleSize) : "",
      personal_objective: s.personalObjective ? String(s.personalObjective) : "",
    });
  }, [summary]);

  const totalHours = (Number(form.days_to_sell) || 0) * (Number(form.hours_per_day) || 0);
  const reqPerHour = totalHours > 0 ? (Number(form.annual_objective) || 0) / totalHours : 0;
  const personalPerHour = totalHours > 0 ? (Number(form.personal_objective) || 0) / totalHours : 0;

  async function saveSetup() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await api.put(`/api/performance/setup${qs}`, {
        days_to_sell: Number(form.days_to_sell) || 0,
        hours_per_day: Number(form.hours_per_day) || 0,
        annual_objective: Number(form.annual_objective) || 0,
        close_rate: Number(form.close_rate) || 0,
        avg_sale_size: Number(form.avg_sale_size) || 0,
        personal_objective: Number(form.personal_objective) || 0,
      });
      setSaved(true);
      reloadSummary();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save setup");
    } finally {
      setBusy(false);
    }
  }

  async function addEntry() {
    if (!entry.activity_type_id) {
      setError("Pick an activity.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/performance/activities${qs}`, {
        activity_type_id: entry.activity_type_id,
        hours: Number(entry.hours) || 0,
        occurred_on: entry.occurred_on,
      });
      setEntry({ activity_type_id: "", hours: "1", occurred_on: entry.occurred_on });
      reloadActs();
      reloadSummary();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not log activity");
    } finally {
      setBusy(false);
    }
  }

  async function delEntry(id: string) {
    await api.delete(`/api/performance/activities/${id}`);
    reloadActs();
    reloadSummary();
  }

  const d = summary?.derived;
  const field = (label: string, key: keyof typeof form, opts?: { prefix?: string; suffix?: string; step?: string }) => (
    <div className="field" style={{ margin: 0 }}>
      <label style={{ fontSize: ".75rem" }}>{label}</label>
      <div className="row" style={{ gap: 4, justifyContent: "flex-start" }}>
        {opts?.prefix && <span className="muted">{opts.prefix}</span>}
        <input type="number" step={opts?.step ?? "1"} value={form[key]} onChange={(e) => { setForm({ ...form, [key]: e.target.value }); setSaved(false); }} style={{ width: "100%" }} />
        {opts?.suffix && <span className="muted">{opts.suffix}</span>}
      </div>
    </div>
  );

  return (
    <div className="stack">
      <ErrorBanner message={error} />

      {/* Projection + badges */}
      <StatGrid>
        <StatCard label="Adjusted Annual Projection" value={money(d?.adjustedAnnual ?? 0)} sub="After non-sales time" icon={<Icon name="reports" />} />
        <StatCard label="Won YTD" value={money(d?.wonYtd ?? 0)} sub={`${Math.round(d?.attainmentYear ?? 0)}% of objective`} icon={<Icon name="check-circle" />} />
        <StatCard label="Required $/hour" value={money(d?.requiredPerHour ?? 0)} sub={`${d?.totalHours ?? 0} selling hours/yr`} icon={<Icon name="clock" />} />
        <StatCard label="Non-Sales Hours" value={d?.nonSalesHours ?? 0} sub={`Sales: ${d?.salesHours ?? 0}h`} icon={<Icon name="activity" />} />
      </StatGrid>

      <Card>
        <div className="row">
          <h3 style={{ display: "flex", alignItems: "center", gap: ".4rem" }}><Icon name="trophy" size={17} /> Ego badges</h3>
        </div>
        <div className="row" style={{ justifyContent: "flex-start", gap: "1rem", marginTop: ".5rem", flexWrap: "wrap" }}>
          <div><div className="muted" style={{ fontSize: ".75rem" }}>THIS YEAR</div><BadgeChip badge={summary?.badgeYear ?? null} sub={`${Math.round(d?.attainmentYear ?? 0)}%`} /></div>
          <div><div className="muted" style={{ fontSize: ".75rem" }}>THIS MONTH</div><BadgeChip badge={summary?.badgeMonth ?? null} sub={`${Math.round(d?.attainmentMonth ?? 0)}%`} /></div>
        </div>
      </Card>

      {/* Sales-plan setup */}
      <Card>
        <h3>Sales plan setup</h3>
        <p className="muted" style={{ fontSize: ".8rem" }}>
          {totalHours.toLocaleString()} selling hours/yr · every hour must produce {money(reqPerHour)} to hit the assigned objective
          {Number(form.personal_objective) > 0 ? ` (${money(personalPerHour)}/hr for your personal goal)` : ""}.
        </p>
        <div className="perf-grid">
          {field("Days to sell / yr", "days_to_sell")}
          {field("Avg hours / day", "hours_per_day", { step: "0.5" })}
          {field("Assigned objective", "annual_objective", { prefix: "$", step: "1000" })}
          {field("Personal objective", "personal_objective", { prefix: "$", step: "1000" })}
          {field("Close rate", "close_rate", { suffix: "%", step: "1" })}
          {field("Avg sale size", "avg_sale_size", { prefix: "$", step: "500" })}
        </div>
        <button className="btn" onClick={saveSetup} disabled={busy} style={{ marginTop: ".75rem" }}>
          {saved ? "Saved ✓" : busy ? "Saving…" : "Save setup"}
        </button>
      </Card>

      {/* Activity log */}
      <Card>
        <h3 style={{ display: "flex", alignItems: "center", gap: ".4rem" }}><Icon name="activity" size={17} /> Activity log</h3>
        <p className="muted" style={{ fontSize: ".8rem" }}>Log the hours you spend. Sales activities keep you on track; non-sales hours reduce your projection.</p>
        <div className="row" style={{ gap: ".5rem", alignItems: "flex-end", flexWrap: "wrap" }}>
          <div className="field" style={{ margin: 0, flex: 2, minWidth: 160 }}>
            <label style={{ fontSize: ".75rem" }}>Activity</label>
            <select value={entry.activity_type_id} onChange={(e) => setEntry({ ...entry, activity_type_id: e.target.value })}>
              <option value="">Choose…</option>
              <optgroup label="Sales">
                {types.filter((t) => t.category === "sales").map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </optgroup>
              <optgroup label="Non-sales">
                {types.filter((t) => t.category === "non_sales").map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </optgroup>
            </select>
          </div>
          <div className="field" style={{ margin: 0, width: 90 }}>
            <label style={{ fontSize: ".75rem" }}>Hours</label>
            <input type="number" step="0.25" min="0" value={entry.hours} onChange={(e) => setEntry({ ...entry, hours: e.target.value })} />
          </div>
          <div className="field" style={{ margin: 0, width: 160 }}>
            <label style={{ fontSize: ".75rem" }}>Date</label>
            <input type="date" value={entry.occurred_on} onChange={(e) => setEntry({ ...entry, occurred_on: e.target.value })} />
          </div>
          <button className="btn small" onClick={addEntry} disabled={busy}><Icon name="plus" size={15} /> Log</button>
        </div>

        {(actData?.activities ?? []).length > 0 && (
          <div style={{ marginTop: ".75rem" }}>
            {(actData?.activities ?? []).slice(0, 30).map((a) => (
              <div key={a.id} className="row" style={{ padding: ".4rem 0", borderTop: "1px solid var(--color-border)" }}>
                <div>
                  <span style={{ fontSize: ".88rem" }}>{a.label}</span>
                  <span className="badge" style={{ marginLeft: 6, fontSize: ".62rem", background: a.category === "sales" ? "#e7f6ec" : "#fdf3e0", color: a.category === "sales" ? "#1a7f43" : "#a66412" }}>
                    {a.category === "sales" ? "Sales" : "Non-sales"}
                  </span>
                  <div className="muted" style={{ fontSize: ".75rem" }}>{a.occurredOn}</div>
                </div>
                <div className="row" style={{ gap: ".5rem" }}>
                  <strong>{Number(a.hours)}h</strong>
                  <button className="btn small ghost" onClick={() => delEntry(a.id)}><Icon name="x" size={13} /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
