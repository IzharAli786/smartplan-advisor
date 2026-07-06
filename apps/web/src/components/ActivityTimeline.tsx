import { useState } from "react";
import { api } from "../api/client.ts";
import { useApi } from "../hooks/useApi.ts";
import { Icon, type IconName } from "./Icon.tsx";
import { Card, Spinner } from "./ui.tsx";
import { dateTimeShort } from "../lib/format.ts";
import { normalizePhoneE164 } from "@smart-crm/shared";
import type { Activity, ActivityType } from "../api/types.ts";

const ICON: Record<ActivityType, IconName> = {
  call: "phone",
  sms: "message-square",
  email: "mail",
  note: "edit",
  status_change: "pipeline",
  quote: "file-text",
  system: "info",
};

const CALL_OUTCOMES = ["Connected", "Left voicemail", "No answer", "Bad number"];

export default function ActivityTimeline({
  opportunityId,
  contactCell,
  contactEmail,
  onChange,
}: {
  opportunityId: string;
  contactCell: string | null;
  contactEmail: string | null;
  onChange?: () => void;
}) {
  const { data, loading, reload } = useApi<{ activities: Activity[] }>(`/api/opportunities/${opportunityId}/activities`, [opportunityId]);
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<ActivityType>("note");
  const [outcome, setOutcome] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  async function log(t: ActivityType, extra?: { outcome?: string; body?: string }) {
    setBusy(true);
    try {
      await api.post(`/api/opportunities/${opportunityId}/activities`, { type: t, outcome: extra?.outcome, body: extra?.body });
      reload();
      onChange?.();
    } finally {
      setBusy(false);
    }
  }

  // One-tap: open the native dialer/SMS/email AND auto-log the activity.
  function quickAction(t: "call" | "sms" | "email") {
    const tel = normalizePhoneE164(contactCell);
    if (t === "email" && contactEmail) window.open(`mailto:${contactEmail}`, "_self");
    else if (t === "call" && tel) window.open(`tel:${tel}`, "_self");
    else if (t === "sms" && tel) window.open(`sms:${tel}`, "_self");
    void log(t);
  }

  async function submitLog() {
    await log(type, { outcome: type === "call" ? outcome || undefined : undefined, body: body || undefined });
    setBody("");
    setOutcome("");
    setOpen(false);
  }

  const activities = data?.activities ?? [];

  return (
    <Card>
      <div className="row">
        <h3 style={{ display: "flex", alignItems: "center", gap: ".4rem" }}>
          <Icon name="activity" size={17} /> Activity
        </h3>
        <button className="btn small ghost" onClick={() => setOpen((v) => !v)}>
          <Icon name={open ? "x" : "plus"} size={15} /> {open ? "Cancel" : "Log"}
        </button>
      </div>

      {/* One-tap contact actions (auto-logged) */}
      <div className="row" style={{ gap: ".5rem", justifyContent: "flex-start", margin: ".5rem 0 .25rem", flexWrap: "wrap" }}>
        <button className="btn small secondary" disabled={!contactCell || busy} onClick={() => quickAction("call")}>
          <Icon name="phone" size={15} /> Call
        </button>
        <button className="btn small secondary" disabled={!contactCell || busy} onClick={() => quickAction("sms")}>
          <Icon name="message-square" size={15} /> Text
        </button>
        <button className="btn small secondary" disabled={!contactEmail || busy} onClick={() => quickAction("email")}>
          <Icon name="mail" size={15} /> Email
        </button>
      </div>

      {open && (
        <div className="stack" style={{ marginTop: ".5rem" }}>
          <div className="row" style={{ gap: ".5rem" }}>
            <div className="field" style={{ flex: 1, marginBottom: 0 }}>
              <label>Type</label>
              <select value={type} onChange={(e) => setType(e.target.value as ActivityType)}>
                <option value="note">Note</option>
                <option value="call">Call</option>
                <option value="sms">Text</option>
                <option value="email">Email</option>
              </select>
            </div>
            {type === "call" && (
              <div className="field" style={{ flex: 1, marginBottom: 0 }}>
                <label>Outcome</label>
                <select value={outcome} onChange={(e) => setOutcome(e.target.value)}>
                  <option value="">—</option>
                  {CALL_OUTCOMES.map((o) => (
                    <option key={o} value={o}>{o}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Note</label>
            <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="What happened?" />
          </div>
          <button className="btn small" disabled={busy} onClick={submitLog}>
            {busy ? "Saving…" : "Add to timeline"}
          </button>
        </div>
      )}

      <div style={{ marginTop: ".75rem" }}>
        {loading ? (
          <Spinner />
        ) : activities.length === 0 ? (
          <div className="muted" style={{ fontSize: ".85rem", padding: ".5rem 0" }}>No activity yet — call, text or email to get started.</div>
        ) : (
          <div className="timeline">
            {activities.map((a) => (
              <div className="timeline-item" key={a.id}>
                <span className="timeline-dot">
                  <Icon name={ICON[a.type]} size={14} />
                </span>
                <div className="timeline-body">
                  <div className="row">
                    <strong style={{ fontSize: ".9rem" }}>{a.subject}</strong>
                    <span className="muted" style={{ fontSize: ".72rem", whiteSpace: "nowrap" }}>{dateTimeShort(a.createdAt)}</span>
                  </div>
                  {a.outcome && <span className="badge" style={{ marginTop: 4 }}>{a.outcome}</span>}
                  {a.body && <p className="muted" style={{ fontSize: ".82rem", marginTop: 4, whiteSpace: "pre-wrap" }}>{a.body}</p>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}
