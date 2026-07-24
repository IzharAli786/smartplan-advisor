import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext.tsx";
import { useApi } from "../hooks/useApi.ts";
import { api } from "../api/client.ts";
import { Card, EmptyState, ErrorBanner, PageHead, Spinner } from "../components/ui.tsx";
import { dateShort } from "../lib/format.ts";
import type { NotificationItem } from "../api/types.ts";

export default function NotificationsPage() {
  const navigate = useNavigate();
  const { isManager } = useAuth();
  const { data, loading, error, reload } = useApi<{ notifications: NotificationItem[]; unread: number }>(
    "/api/notifications",
  );

  async function open(n: NotificationItem) {
    if (!n.read) {
      await api.post(`/api/notifications/${n.id}/read`);
      reload();
    }
    // Deep-link. relatedId is deliberately NULL on notifications whose recipient can't
    // read the record — an advisor who just lost an account, or one whose takeover was
    // declined, 403s on its detail route. Guarding on relatedId is what keeps them on
    // this page instead of dropping them into an error screen.
    const opensOpportunity =
      n.type === "claim_decision" ||
      n.type === "account_reassigned" ||
      n.type === "takeover_requested" ||
      n.type === "next_step" ||
      n.type === "follow_up";
    if (opensOpportunity && n.relatedId) {
      navigate(`/opportunity/${n.relatedId}`);
    } else if (n.type === "claim_request" && isManager) {
      // /claims is manager-only; the requesting advisor gets this type too as their own
      // acknowledgement, and sending them there would land on a blocked page.
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
