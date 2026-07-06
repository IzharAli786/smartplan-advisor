import { useState } from "react";
import { useApi } from "../hooks/useApi.ts";
import { api, ApiError } from "../api/client.ts";
import { Card, EmptyState, ErrorBanner, PageHead, Spinner } from "../components/ui.tsx";
import { Icon } from "../components/Icon.tsx";
import { dateShort } from "../lib/format.ts";
import type { ClaimRequest } from "../api/types.ts";

export default function ClaimsPage() {
  const { data, loading, error, reload } = useApi<{ claimRequests: ClaimRequest[] }>(
    "/api/claim-requests?status=pending",
  );
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function decide(id: string, decision: "approved" | "rejected") {
    setBusyId(id);
    setActionError(null);
    try {
      await api.post(`/api/claim-requests/${id}/decide`, { decision });
      reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not decide");
    } finally {
      setBusyId(null);
    }
  }

  if (loading) return <Spinner />;

  return (
    <div>
      <PageHead title="Takeover Requests" subtitle="Approve or reject territory takeovers — one tap" />
      <ErrorBanner message={actionError ?? error} />
      {!data || data.claimRequests.length === 0 ? (
        <EmptyState icon="requests" title="No pending requests" hint="Territory takeover requests will appear here for one-tap approval." />
      ) : (
        data.claimRequests.map((c) => (
          <Card key={c.id}>
            <strong>{c.matchedCompanyName}</strong>
            <div className="muted" style={{ fontSize: ".85rem", marginTop: 4 }}>
              <strong>{c.requesterName ?? "An advisor"}</strong> wants to take over from{" "}
              <strong>{c.currentOwnerName ?? "the current owner"}</strong>.
            </div>
            <div className="muted" style={{ fontSize: ".75rem", marginTop: 2 }}>
              Requested {dateShort(c.createdAt)}
            </div>
            <div className="row" style={{ gap: ".5rem", marginTop: ".75rem", justifyContent: "flex-start" }}>
              <button className="btn success small" disabled={busyId === c.id} onClick={() => decide(c.id, "approved")}>
                <Icon name="check" size={15} /> Approve
              </button>
              <button className="btn danger small" disabled={busyId === c.id} onClick={() => decide(c.id, "rejected")}>
                <Icon name="x" size={15} /> Reject
              </button>
            </div>
          </Card>
        ))
      )}
    </div>
  );
}
