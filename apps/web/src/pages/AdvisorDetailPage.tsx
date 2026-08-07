import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useApi } from "../hooks/useApi.ts";
import { useStages, stageLabelMap, prettyKey } from "../hooks/useSettings.ts";
import { api, ApiError } from "../api/client.ts";
import { Card, EmptyState, ErrorBanner, PageHead, Spinner, StatCard, StatGrid, StatusBadge } from "../components/ui.tsx";
import { Icon } from "../components/Icon.tsx";
import PerformancePanel from "../components/PerformancePanel.tsx";
import SmartPlanTransactions from "../components/SmartPlanTransactions.tsx";
import { exportStatementPdf } from "../lib/export.ts";
import { dateShort, money, pct } from "../lib/format.ts";
import { stageTone } from "../lib/stage.ts";
import type { AdvisorFeedbackEntry, CommissionStatement, CurrentUser, Opportunity, StatusStage } from "../api/types.ts";

export default function AdvisorDetailPage() {
  const { id } = useParams();
  const [statusFilter, setStatusFilter] = useState("");
  const [stmtMonth, setStmtMonth] = useState(new Date().toISOString().slice(0, 7));
  const [stmtBusy, setStmtBusy] = useState(false);
  const [rate, setRate] = useState("");
  const [savingRate, setSavingRate] = useState(false);
  const [rateSaved, setRateSaved] = useState(false);
  const avatarRef = useRef<HTMLInputElement>(null);
  const [hfMsg, setHfMsg] = useState<string | null>(null);

  async function sendHighFive() {
    if (!id) return;
    try {
      await api.post("/api/high-fives", { to_advisor_id: id, message: `Great work, ${(userData?.user?.fullName ?? "").split(" ")[0]}! 🙌` });
      setHfMsg("High five sent! 🙌");
      setTimeout(() => setHfMsg(null), 3000);
    } catch {
      setHfMsg("Couldn't send high five.");
    }
  }

  async function uploadAvatar(file: File) {
    if (!id) return;
    const fd = new FormData();
    fd.set("file", file, file.name);
    try {
      await api.upload(`/api/users/${id}/avatar`, fd);
      reloadUser();
    } catch {
      /* ignore */
    }
  }

  async function downloadStatement() {
    if (!id) return;
    setStmtBusy(true);
    try {
      const [y, m] = stmtMonth.split("-").map(Number);
      const from = `${stmtMonth}-01`;
      const to = new Date(y!, m!, 0).toISOString().slice(0, 10); // last day of month
      const s = await api.get<CommissionStatement>(`/api/reports/commission-statement/${id}?from=${from}&to=${to}`);
      exportStatementPdf(s);
    } finally {
      setStmtBusy(false);
    }
  }
  const { data: userData, loading: lu, error: eu, reload: reloadUser } = useApi<{ user: CurrentUser }>(id ? `/api/users/${id}` : null);
  const { data: oppData, loading: lo } = useApi<{ opportunities: Opportunity[] }>(
    id ? `/api/opportunities?advisorId=${id}` : null,
    [id],
  );
  const { data: historyData, reload: reloadHistory } = useApi<{ history: { id: string; rate: number; effectiveFrom: string }[] }>(
    id ? `/api/users/${id}/commission-history` : null,
    [id],
  );
  const { data: stagesData } = useStages();

  const advisor = userData?.user;

  useEffect(() => {
    setRate(advisor?.currentCommissionRate != null ? String(advisor.currentCommissionRate) : "");
    setRateSaved(false);
  }, [advisor?.currentCommissionRate]);

  async function saveRate() {
    if (!id) return;
    setSavingRate(true);
    setRateSaved(false);
    try {
      await api.patch(`/api/users/${id}`, { current_commission_rate: rate === "" ? null : Number(rate) });
      setRateSaved(true);
      reloadUser();
      reloadHistory();
    } finally {
      setSavingRate(false);
    }
  }

  const stages = (stagesData?.stages ?? []) as StatusStage[];
  const labels = stageLabelMap(stages);
  const stageMap = new Map(stages.map((s) => [s.key, s]));
  const allOpps = oppData?.opportunities ?? [];

  // Performance summary (matches the dashboard roll-up logic, computed from this advisor's opps).
  const total = allOpps.length;
  const open = allOpps.filter((o) => !stageMap.get(o.status)?.isTerminal).length;
  const won = allOpps.filter((o) => stageMap.get(o.status)?.isConversion).length;
  const pipelineValue = allOpps
    .filter((o) => !stageMap.get(o.status)?.isTerminal)
    .reduce((s, o) => s + (o.opportunityValue ?? 0), 0);
  const conversionRate = total > 0 ? won / total : 0;

  // Count per status for the filter pills (so cancelled/paused/converted are all reachable).
  const countFor = (key: string) => allOpps.filter((o) => o.status === key).length;
  const visible = statusFilter ? allOpps.filter((o) => o.status === statusFilter) : allOpps;

  if (lu) return <Spinner />;
  if (!advisor) return <ErrorBanner message={eu ?? "Advisor not found"} />;

  return (
    <div>
      <Link to="/dashboard" className="muted" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
        <Icon name="chevron-left" size={16} /> Dashboard
      </Link>
      <PageHead
        title={advisor.fullName}
        subtitle={`Advisor · ${advisor.statesCovered.join(", ") || "no states set"}`}
        actions={
          <button className="btn" onClick={sendHighFive}>
            <Icon name="trophy" size={16} /> Send High Five 🙌
          </button>
        }
      />
      {hfMsg && <div className="success-banner">{hfMsg}</div>}

      <div className="dash-grid with-aside">
        {/* Main: performance + opportunities */}
        <div>
          <StatGrid>
            <StatCard label="Open" value={open} sub="In progress" icon={<Icon name="pipeline" />} />
            <StatCard label="Pipeline Value" value={money(pipelineValue)} sub="Open, not yet subscribed" icon={<Icon name="briefcase" />} />
            <StatCard label="Subscribed" value={won} sub="Converted" icon={<Icon name="check-circle" />} />
            <StatCard label="Conversion" value={pct(conversionRate)} sub={`${total} total`} icon={<Icon name="reports" />} />
          </StatGrid>

          <div className="section-head">
            <h2>Opportunities</h2>
          </div>

          {/* Status filter — includes terminal stages (converted, lost, cancelled, paused…) */}
          <div className="tabs">
            <button className={`tab ${statusFilter === "" ? "active" : ""}`} onClick={() => setStatusFilter("")}>
              All ({total})
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

          {lo ? (
            <Spinner />
          ) : visible.length === 0 ? (
            <EmptyState
              icon="pipeline"
              title={statusFilter ? `No ${labels[statusFilter] ?? statusFilter} opportunities` : "No opportunities yet"}
              hint={statusFilter ? "Try another status filter." : "This advisor hasn't logged any opportunities."}
            />
          ) : (
            visible.map((o) => {
              const stage = stageMap.get(o.status);
              return (
                <Link key={o.id} to={`/opportunity/${o.id}`} style={{ color: "inherit" }}>
                  <Card onClick={() => {}}>
                    <div className="row" style={{ justifyContent: "flex-start", gap: ".75rem" }}>
                      <span className="icon-tile">
                        <Icon name="building" size={20} />
                      </span>
                      <div style={{ flex: 1 }}>
                        <strong>{o.contractorCompanyName}</strong>
                        <div className="muted" style={{ fontSize: ".8rem" }}>
                          {o.product ?? "—"} · {o.state}
                        </div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <StatusBadge label={labels[o.status] ?? prettyKey(o.status)} kind={stageTone(stage)} />
                        <div className="muted" style={{ fontSize: ".82rem", marginTop: 4 }}>
                          {o.opportunityValue != null ? money(o.opportunityValue) : "—"}
                        </div>
                      </div>
                    </div>
                  </Card>
                </Link>
              );
            })
          )}
        </div>

        {/* Aside: contact + commission */}
        <aside>
          <Card>
            <h3>Contact</h3>
            <div className="row" style={{ justifyContent: "flex-start", gap: ".75rem", marginTop: ".5rem" }}>
              <input ref={avatarRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadAvatar(f); e.target.value = ""; }} />
              {advisor.avatarUrl ? (
                <img className="profile-photo" src={advisor.avatarUrl} alt={advisor.fullName} />
              ) : (
                <div className="profile-photo" style={{ display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, color: "var(--color-text-muted)" }}>
                  {advisor.fullName.split(" ").map((p) => p[0]).slice(0, 2).join("")}
                </div>
              )}
              <button className="btn small secondary" onClick={() => avatarRef.current?.click()}>
                <Icon name="upload" size={14} /> {advisor.avatarUrl ? "Change photo" : "Add photo"}
              </button>
            </div>
            <div className="row" style={{ marginTop: ".5rem" }}>
              <span className="muted">Status</span>
              <StatusBadge
                label={advisor.status}
                kind={advisor.status === "active" ? "success" : advisor.status === "deactivated" ? "overdue" : undefined}
              />
            </div>
            <div className="row" style={{ marginTop: ".5rem" }}>
              <span className="muted">Email</span>
              <span>{advisor.email ? <a href={`mailto:${advisor.email}`}>{advisor.email}</a> : "—"}</span>
            </div>
            <div className="row" style={{ marginTop: ".5rem" }}>
              <span className="muted">Phone</span>
              <span>{advisor.phone ? <a href={`tel:${advisor.phone}`}>{advisor.phone}</a> : "—"}</span>
            </div>
            <div className="row" style={{ marginTop: ".5rem" }}>
              <span className="muted">States</span>
              <span>{advisor.statesCovered.join(", ") || "—"}</span>
            </div>
            <div className="row" style={{ marginTop: ".5rem" }}>
              <span className="muted">Enrolled</span>
              <span>{advisor.enrolledDate ? dateShort(advisor.enrolledDate) : "—"}</span>
            </div>
            <div className="row" style={{ marginTop: ".5rem" }}>
              <span className="muted">Referred by</span>
              <span>{advisor.referredBy || "—"}</span>
            </div>
            <div className="row" style={{ marginTop: ".5rem" }}>
              <span className="muted">Referral link</span>
              <span style={{ maxWidth: "60%", overflow: "hidden", textOverflow: "ellipsis" }}>
                {advisor.referralLink ? <a href={advisor.referralLink} target="_blank" rel="noreferrer">{advisor.referralLink}</a> : "—"}
              </span>
            </div>
            {advisor.monthlyQuota != null && (
              <div className="row" style={{ marginTop: ".5rem" }}>
                <span className="muted">Monthly quota</span>
                <span>{money(advisor.monthlyQuota)}</span>
              </div>
            )}
          </Card>

          <Card>
            <h3>Bio &amp; capabilities</h3>
            <p className="muted" style={{ fontSize: ".78rem", marginBottom: ".6rem" }}>
              Written by the advisor; visible to the whole team on the Advisor Network page.
            </p>
            {advisor.bio ? <p style={{ whiteSpace: "pre-wrap", margin: 0 }}>{advisor.bio}</p> : <p className="muted" style={{ margin: 0 }}>No bio yet.</p>}
            {advisor.capabilities && (
              <>
                <div className="muted" style={{ fontSize: ".78rem", marginTop: ".7rem", fontWeight: 600 }}>
                  Unique capabilities
                </div>
                <p style={{ whiteSpace: "pre-wrap", margin: ".2rem 0 0" }}>{advisor.capabilities}</p>
              </>
            )}
          </Card>

          <ManagementNotesCard advisor={advisor} reload={reloadUser} />

          {id && <AdvisorFeedbackCard advisorId={id} />}

          <Card>
            <h3 style={{ display: "flex", alignItems: "center", gap: ".4rem" }}>
              <Icon name="commission" size={17} /> Commission
            </h3>
            <p className="muted" style={{ fontSize: ".78rem", marginBottom: ".6rem" }}>
              Set this advisor's rate. Changes are effective-dated — past deals keep the rate from their conversion date.
            </p>
            <div className="field" style={{ margin: 0 }}>
              <label>Current rate</label>
              <div className="row" style={{ gap: ".5rem", justifyContent: "flex-start" }}>
                <input
                  type="number"
                  step="0.01"
                  min={0}
                  value={rate}
                  onChange={(e) => {
                    setRate(e.target.value);
                    setRateSaved(false);
                  }}
                  placeholder="—"
                  style={{ width: 100 }}
                />
                <span className="muted">%</span>
                <button className="btn" onClick={saveRate} disabled={savingRate}>
                  {rateSaved ? "Saved ✓" : savingRate ? "Saving…" : "Save"}
                </button>
              </div>
            </div>

            {historyData && historyData.history.length > 0 && (
              <>
                <div className="muted" style={{ fontSize: ".78rem", marginTop: "1rem", marginBottom: ".25rem" }}>
                  Rate history
                </div>
                {historyData.history.map((h, i) => (
                  <div className="row" key={h.id} style={{ padding: "4px 0" }}>
                    <span className="muted" style={{ fontSize: ".82rem" }}>
                      {i === 0 ? "Since " : "From "}
                      {dateShort(h.effectiveFrom)}
                    </span>
                    <strong>{h.rate}%</strong>
                  </div>
                ))}
              </>
            )}
          </Card>

          <Card>
            <h3>Commission statement</h3>
            <p className="muted" style={{ fontSize: ".78rem", marginBottom: ".6rem" }}>
              Download a signed-off PDF of this advisor's commissions for a month.
            </p>
            <div className="row" style={{ gap: ".5rem" }}>
              <input type="month" value={stmtMonth} onChange={(e) => setStmtMonth(e.target.value)} />
              <button className="btn" disabled={stmtBusy} onClick={downloadStatement}>
                <Icon name="download" size={16} /> {stmtBusy ? "…" : "PDF"}
              </button>
            </div>
          </Card>
        </aside>
      </div>

      <div className="section-head" style={{ marginTop: "1.5rem" }}>
        <h2>Smart Plan Transactions</h2>
      </div>
      {id && <SmartPlanTransactions advisorId={id} />}

      <div className="section-head" style={{ marginTop: "1.5rem" }}>
        <h2>Performance</h2>
      </div>
      <PerformancePanel advisorId={id} />
    </div>
  );
}

/** Private notes about this advisor. Server-side these live on users.notes,
 *  which serializeUser only ever returns to managerial viewers (§11.1-style). */
function ManagementNotesCard({ advisor, reload }: { advisor: CurrentUser; reload: () => void }) {
  const [notes, setNotes] = useState(advisor.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setNotes(advisor.notes ?? "");
    setSaved(false);
  }, [advisor.notes]);

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      await api.patch(`/api/users/${advisor.id}`, { notes });
      setSaved(true);
      reload();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not save notes");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <h3 style={{ display: "flex", alignItems: "center", gap: ".4rem" }}>
        <Icon name="edit" size={17} /> Management notes
      </h3>
      <p className="muted" style={{ fontSize: ".78rem", marginBottom: ".6rem" }}>
        Only visible to super admins — the advisor never sees these.
      </p>
      <ErrorBanner message={err} />
      <div className="field" style={{ marginBottom: ".6rem" }}>
        <textarea
          rows={4}
          maxLength={2000}
          placeholder="Private notes about this advisor…"
          value={notes}
          onChange={(e) => { setNotes(e.target.value); setSaved(false); }}
        />
      </div>
      <button className="btn" onClick={save} disabled={busy}>
        {saved ? "Saved ✓" : busy ? "Saving…" : "Save notes"}
      </button>
    </Card>
  );
}

/** Feedback written FOR this advisor — the advisor sees it on their Team page. */
function AdvisorFeedbackCard({ advisorId }: { advisorId: string }) {
  const { data, loading, reload } = useApi<{ feedback: AdvisorFeedbackEntry[] }>(`/api/team/${advisorId}/feedback`, [advisorId]);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const entries = data?.feedback ?? [];

  async function add() {
    if (!body.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      await api.post(`/api/team/${advisorId}/feedback`, { body });
      setBody("");
      reload();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not add feedback");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    try {
      await api.delete(`/api/team/${advisorId}/feedback/${id}`);
      reload();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not delete feedback");
    }
  }

  return (
    <Card>
      <h3 style={{ display: "flex", alignItems: "center", gap: ".4rem" }}>
        <Icon name="message-square" size={17} /> Feedback
      </h3>
      <p className="muted" style={{ fontSize: ".78rem", marginBottom: ".6rem" }}>
        Shared with the advisor — they see this under “Feedback from your manager”.
      </p>
      <ErrorBanner message={err} />
      <div className="field" style={{ marginBottom: ".6rem" }}>
        <textarea
          rows={3}
          maxLength={4000}
          placeholder="Write feedback for this advisor…"
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
      </div>
      <button className="btn" onClick={add} disabled={busy || !body.trim()}>
        {busy ? "Adding…" : "Add feedback"}
      </button>

      {loading ? null : entries.length === 0 ? (
        <p className="muted" style={{ fontSize: ".82rem", marginTop: ".8rem" }}>No feedback yet.</p>
      ) : (
        entries.map((f) => (
          <div key={f.id} style={{ marginTop: ".8rem", borderTop: "1px solid var(--color-border)", paddingTop: ".6rem" }}>
            <div className="row">
              <span className="muted" style={{ fontSize: ".78rem" }}>
                {f.authorName ?? "Manager"} · {dateShort(f.createdAt)}
              </span>
              <button className="btn small ghost icon-only" aria-label="Delete feedback" onClick={() => remove(f.id)}>
                <Icon name="trash" size={14} />
              </button>
            </div>
            <p style={{ margin: ".15rem 0 0", whiteSpace: "pre-wrap" }}>{f.body}</p>
          </div>
        ))
      )}
    </Card>
  );
}
