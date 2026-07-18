import { useState } from "react";
import { useApi } from "../hooks/useApi.ts";
import { api, ApiError } from "../api/client.ts";
import { Card, EmptyState, ErrorBanner, PageHead, Spinner, StatusBadge } from "../components/ui.tsx";
import { Icon } from "../components/Icon.tsx";
import { FeedbackModal, FEEDBACK_CATEGORIES, FEEDBACK_PRIORITIES } from "../components/FeedbackModal.tsx";

/** The subset of SmartPlan's feedback row the API returns for this advisor. */
interface FeedbackItem {
  id: number;
  title: string;
  description: string;
  category: string;
  priority: string;
  status: string;
  resolution: string | null;
  createdAt: string;
}

// Mirrors SmartPlan's My Feedback status set, mapped onto this app's badge kinds.
const STATUS_LABELS: Record<string, { label: string; kind?: "overdue" | "success" | "ai" }> = {
  new: { label: "New", kind: "ai" },
  in_review: { label: "In Review" },
  in_progress: { label: "In Progress" },
  completed: { label: "Completed", kind: "success" },
  rejected: { label: "Rejected", kind: "overdue" },
};

const categoryLabel = (v: string) => FEEDBACK_CATEGORIES.find((c) => c.value === v)?.label ?? v;
const priorityLabel = (v: string) => FEEDBACK_PRIORITIES.find((p) => p.value === v)?.label ?? v;

/** All users: their own submitted feedback, mirroring SmartPlan's My Feedback page. */
export default function FeedbackPage() {
  const [modalOpen, setModalOpen] = useState(false);
  const [deleteErr, setDeleteErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const { data, loading, error, reload } = useApi<{ feedback: FeedbackItem[] }>("/api/feedback", []);
  const items = data?.feedback ?? [];

  async function remove(item: FeedbackItem) {
    if (!window.confirm(`Delete "${item.title}"? This can't be undone.`)) return;
    setBusyId(item.id);
    setDeleteErr(null);
    try {
      await api.delete(`/api/feedback/${item.id}`);
      reload();
    } catch (e) {
      setDeleteErr(e instanceof ApiError ? e.message : "Could not delete this feedback");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <PageHead
        title="My Feedback"
        subtitle="Feature requests, bug reports & ideas you've sent to the SmartPlan team"
        actions={
          <button className="btn" onClick={() => setModalOpen(true)}>
            <Icon name="plus" size={16} /> New Feedback
          </button>
        }
      />
      <ErrorBanner message={error} />
      <ErrorBanner message={deleteErr} />

      {loading ? (
        <Spinner />
      ) : items.length === 0 ? (
        !error && (
          <EmptyState
            icon="message-square"
            title="No feedback yet"
            hint="Use “New Feedback” to send a feature request, bug report, or improvement idea."
          />
        )
      ) : (
        items.map((item) => {
          const status = STATUS_LABELS[item.status] ?? { label: item.status };
          return (
            <Card key={item.id}>
              <div className="row" style={{ justifyContent: "flex-start", gap: ".5rem", flexWrap: "wrap" }}>
                <strong style={{ flex: 1, minWidth: 180 }}>{item.title}</strong>
                <StatusBadge label={priorityLabel(item.priority)} kind={item.priority === "high" ? "overdue" : undefined} />
                <StatusBadge label={status.label} kind={status.kind} />
                <button
                  className="btn small ghost icon-only"
                  aria-label="Delete feedback"
                  style={{ color: "var(--color-danger)" }}
                  disabled={busyId === item.id}
                  onClick={() => remove(item)}
                >
                  <Icon name="x" size={15} />
                </button>
              </div>
              <div className="muted" style={{ fontSize: ".78rem", marginTop: 2 }}>
                {categoryLabel(item.category)} · Submitted {new Date(item.createdAt).toLocaleDateString("en-US")}
              </div>
              <p className="muted" style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>{item.description}</p>
              {item.resolution && (
                <div
                  style={{
                    marginTop: ".6rem",
                    padding: ".6rem .75rem",
                    borderRadius: 8,
                    background: "var(--success-soft)",
                    color: "var(--success-text)",
                    fontSize: ".85rem",
                  }}
                >
                  <strong>Response from the SmartPlan team:</strong>
                  <div style={{ whiteSpace: "pre-wrap", marginTop: 4 }}>{item.resolution}</div>
                </div>
              )}
            </Card>
          );
        })
      )}

      <FeedbackModal open={modalOpen} onClose={() => setModalOpen(false)} onSubmitted={reload} />
    </div>
  );
}
