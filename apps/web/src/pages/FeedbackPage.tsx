import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
  const [pendingDelete, setPendingDelete] = useState<FeedbackItem | null>(null);
  const { data, loading, error, reload } = useApi<{ feedback: FeedbackItem[] }>("/api/feedback", []);
  const items = data?.feedback ?? [];

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
                  onClick={() => setPendingDelete(item)}
                >
                  <Icon name="trash" size={15} />
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
      <DeleteFeedbackDialog item={pendingDelete} onClose={() => setPendingDelete(null)} onDeleted={reload} />
    </div>
  );
}

/**
 * Confirm-before-delete dialog. Wording matches SmartPlan's My Feedback
 * AlertDialog; markup follows this app's house confirm-modal pattern
 * (Cancel focused, Escape to close, no bail-out mid-delete).
 */
function DeleteFeedbackDialog({
  item,
  onClose,
  onDeleted,
}: {
  item: FeedbackItem | null;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  function close() {
    if (busy) return;
    setErr(null);
    onClose();
  }

  useEffect(() => {
    if (!item) return;
    cancelRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [item, busy]);

  if (!item) return null;

  async function confirmDelete() {
    if (!item) return;
    setBusy(true);
    setErr(null);
    try {
      await api.delete(`/api/feedback/${item.id}`);
      onDeleted();
      setErr(null);
      onClose();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Couldn't delete feedback — please try again");
    } finally {
      setBusy(false);
    }
  }

  return createPortal(
    <div className="modal-overlay center" onClick={close}>
      <div
        className="modal confirm-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Delete this feedback?"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="confirm-head">
          <span className="icon-tile danger">
            <Icon name="alert-triangle" size={20} />
          </span>
          <div>
            <h3 style={{ margin: 0 }}>Delete this feedback?</h3>
            <p className="muted" style={{ margin: ".35rem 0 0", fontSize: ".85rem" }}>
              This permanently removes “{item.title}” from your feedback list. This can’t be undone.
            </p>
          </div>
        </div>
        <ErrorBanner message={err} />
        <div className="confirm-actions">
          <button ref={cancelRef} className="btn secondary" onClick={close} disabled={busy}>
            Cancel
          </button>
          <button className="btn danger" onClick={confirmDelete} disabled={busy}>
            {busy ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
