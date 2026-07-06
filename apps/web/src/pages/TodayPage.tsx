import { Link } from "react-router-dom";
import { useApi } from "../hooks/useApi.ts";
import { useAuth } from "../auth/AuthContext.tsx";
import { Card, EmptyState, ErrorBanner, PageHead, Spinner, StatCard, StatGrid, StatusBadge } from "../components/ui.tsx";
import { Icon } from "../components/Icon.tsx";
import { relativeDue } from "../lib/format.ts";
import type { PendingClaim, TodayItem } from "../api/types.ts";

interface TodayResponse {
  items: TodayItem[];
  overdueCount: number;
  pendingClaims: PendingClaim[];
}

export default function TodayPage() {
  const { user } = useAuth();
  const { data, loading, error } = useApi<TodayResponse>("/api/today");

  if (loading) return <Spinner />;

  const dueToday = data ? data.items.length - data.overdueCount : 0;

  return (
    <div>
      <PageHead
        title="Today"
        subtitle={`Welcome ${user?.fullName?.split(" ")[0] ?? ""}. Here's what's happening today.`}
        hex
        actions={
          <Link className="btn" to="/new">
            + New Opportunity
          </Link>
        }
      />

      <StatGrid>
        <StatCard label="Due Today" value={dueToday} sub="Next steps & follow-ups" icon={<Icon name="calendar" />} />
        <StatCard label="Overdue" value={data?.overdueCount ?? 0} sub="Needs attention" icon={<Icon name="clock" />} />
        <StatCard label="Pending Requests" value={data?.pendingClaims.length ?? 0} sub="Awaiting manager" icon={<Icon name="requests" />} />
      </StatGrid>

      <ErrorBanner message={error} />

      {data?.pendingClaims?.length ? (
        <div className="warn-banner">
          {data.pendingClaims.length} takeover request{data.pendingClaims.length > 1 ? "s" : ""} pending manager review:{" "}
          {data.pendingClaims.map((c) => c.matchedCompanyName).join(", ")}.
        </div>
      ) : null}

      <div className="section-head">
        <h2>
          Next steps {data?.overdueCount ? <StatusBadge label={`${data.overdueCount} overdue`} kind="overdue" /> : null}
        </h2>
      </div>

      {!data || data.items.length === 0 ? (
        <EmptyState
          icon="check-circle"
          title="You're all caught up"
          hint="No follow-ups or next steps due today."
          actionLabel="Log a new opportunity"
          actionTo="/new"
        />
      ) : (
        data.items.map((it) => (
          <Link key={it.id} to={`/opportunity/${it.id}`} style={{ color: "inherit" }}>
            <Card onClick={() => {}}>
              <div className="row">
                <div className="row" style={{ gap: ".75rem", justifyContent: "flex-start" }}>
                  <span className="icon-tile">
                    <Icon name="building" size={20} />
                  </span>
                  <div>
                    <strong>{it.contractorCompanyName}</strong>
                    <div className="muted" style={{ fontSize: ".82rem" }}>
                      {it.nextStep ?? "Follow up"}
                    </div>
                  </div>
                </div>
                <StatusBadge
                  label={relativeDue(it.nextStepDue ?? it.followUpAt)}
                  kind={it.overdue ? "overdue" : undefined}
                />
              </div>
              <div className="muted" style={{ fontSize: ".78rem", marginTop: 8 }}>
                {it.product ?? "—"} · {it.state}
              </div>
            </Card>
          </Link>
        ))
      )}
    </div>
  );
}
