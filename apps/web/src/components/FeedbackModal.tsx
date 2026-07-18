import { useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { api, ApiError } from "../api/client.ts";
import { ErrorBanner } from "./ui.tsx";
import { Icon } from "./Icon.tsx";

// Same fields and values as SmartPlan's in-app feedback dialog — the API
// forwards the submission to SmartPlan's central eco-admin feedback inbox,
// where it lands tagged source="advisor".
export const FEEDBACK_CATEGORIES = [
  { value: "feature", label: "Feature Request" },
  { value: "bug", label: "Bug Report" },
  { value: "improvement", label: "Improvement" },
];
export const FEEDBACK_PRIORITIES = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

/**
 * Controlled feedback dialog: submit a feature request / bug report /
 * improvement to the SmartPlan team. Portaled to <body> so it can be opened
 * from anywhere (incl. CSS-transformed containers) without stacking issues.
 */
export function FeedbackModal({
  open,
  onClose,
  onSubmitted,
}: {
  open: boolean;
  onClose: () => void;
  onSubmitted?: () => void;
}) {
  const [sent, setSent] = useState(false);
  const [form, setForm] = useState({ title: "", description: "", category: "feature", priority: "medium" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function close() {
    setSent(false);
    setErr(null);
    onClose();
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!form.title.trim() || !form.description.trim()) {
      setErr("Please fill in the title and description");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await api.post("/api/feedback", {
        title: form.title.trim(),
        description: form.description.trim(),
        category: form.category,
        priority: form.priority,
      });
      setForm({ title: "", description: "", category: "feature", priority: "medium" });
      setSent(true);
      onSubmitted?.();
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : "Could not send feedback — please try again");
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return createPortal(
    <div className="modal-overlay" onClick={close}>
      <div className="modal" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ marginBottom: ".5rem" }}>
          <h3 style={{ margin: 0 }}>Send feedback</h3>
          <button className="btn small ghost icon-only" aria-label="Close" onClick={close}>
            <Icon name="x" size={16} />
          </button>
        </div>
        {sent ? (
          <div>
            <p>Thanks — your feedback has been sent to the SmartPlan team.</p>
            <button className="btn full" onClick={close}>Done</button>
          </div>
        ) : (
          <>
            <p className="muted" style={{ marginTop: 0, fontSize: ".85rem" }}>
              Share a feature request, bug report, or improvement idea with the SmartPlan team.
            </p>
            <ErrorBanner message={err} />
            <form onSubmit={submit}>
              <div className="field">
                <label>Title *</label>
                <input
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="Brief summary of your feedback"
                  maxLength={200}
                  required
                />
              </div>
              <div className="field">
                <label>Description *</label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="Describe your feedback in detail…"
                  rows={4}
                  maxLength={5000}
                  required
                />
              </div>
              <div className="field">
                <label>Category</label>
                <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                  {FEEDBACK_CATEGORIES.map((c) => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Priority</label>
                <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
                  {FEEDBACK_PRIORITIES.map((p) => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                </select>
              </div>
              <button className="btn full" disabled={busy || !form.title.trim() || !form.description.trim()}>
                {busy ? "Sending…" : "Send feedback"}
              </button>
            </form>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
