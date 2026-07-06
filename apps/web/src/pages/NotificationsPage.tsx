import { useNavigate } from "react-router-dom";
import { useApi } from "../hooks/useApi.ts";
import { api } from "../api/client.ts";
import { Card, EmptyState, ErrorBanner, PageHead, Spinner } from "../components/ui.tsx";
import { dateShort } from "../lib/format.ts";
import type { NotificationItem } from "../api/types.ts";

export default function NotificationsPage() {
  const navigate = useNavigate();
  const { data, loading, error, reload } = useApi<{ notifications: NotificationItem[]; unread: number }>(
    "/api/notifications",
  );

  async function open(n: NotificationItem) {
    if (!n.read) {
      await api.post(`/api/notifications/${n.id}/read`);
      reload();
    }
    // Deep-link: claim decisions / reassignments point at an opportunity.
    if ((n.type === "claim_decision" || n.type === "account_reassigned" || n.type === "next_step" || n.type === "follow_up") && n.relatedId) {
      navigate(`/opportunity/${n.relatedId}`);
    } else if (n.type === "claim_request") {
      navigate("/claims");
    }
  }

  async function markAll() {
    await api.post("/api/notifications/read-all");
    reload();
  }

  if (loading) return <Spinner />;

  return (
    <div>
      <PageHead
        title="Notifications"
        subtitle="Takeover decisions, reassignments and reminders"
        actions={
          data && data.unread > 0 ? (
            <button className="btn small secondary" onClick={markAll}>
              Mark all read
            </button>
          ) : undefined
        }
      />
      <ErrorBanner message={error} />
      {!data || data.notifications.length === 0 ? (
        <EmptyState icon="bell" title="No notifications" hint="Takeover decisions and reminders will show up here." />
      ) : (
        data.notifications.map((n) => (
          <Card key={n.id} onClick={() => open(n)} className={n.read ? "" : "tappable"}>
            <div className="row">
              <span style={{ fontWeight: n.read ? 400 : 700 }}>{n.message}</span>
              {!n.read && <span className="badge ai">new</span>}
            </div>
            <div className="muted" style={{ fontSize: ".75rem", marginTop: 4 }}>
              {dateShort(n.createdAt)}
            </div>
          </Card>
        ))
      )}
    </div>
  );
}
