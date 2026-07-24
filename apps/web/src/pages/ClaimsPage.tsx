import { useState } from "react";
import { useApi } from "../hooks/useApi.ts";
import { api, ApiError } from "../api/client.ts";
import { AgeIndicator, Card, EmptyState, ErrorBanner, PageHead, Spinner, StatusBadge } from "../components/ui.tsx";
import { Icon } from "../components/Icon.tsx";
import { dateShort, money } from "../lib/format.ts";
import type { ClaimRequest } from "../api/types.ts";

const MATCH_LABEL: Record<string, string> = {
  company: "Blocked on: company name",
  email: "Blocked on: contact email",
  phone: "Blocked on: contact phone",
};

/** One label/value line. Values fall back to an em dash so rows stay aligned. */
function Field({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div className="row" style={{ justifyContent: "space-between", gap: ".75rem", padding: "2px 0" }}>
      <span className="muted" style={{ fontSize: ".75rem" }}>
        {label}
      </span>
      <span style={{ fontSize: ".8rem", textAlign: "right" }}>{value === null || value === undefined || value === "" ? "—" : value}</span>
    </div>
  );
}

export default function ClaimsPage() {
  const { data, loading, error, reload } = useApi<{ claimRequests: ClaimRequest[] }>(
    "/api/claim-requests?status=pending",
  );
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  async function decide(c: ClaimRequest, decision: "approved" | "rejected") {
    // Approval moves an account between advisors and can't be undone from this screen —
    // worth one confirm, unlike a rejection which leaves everything as it was.
    if (decision === "approved") {
      const name = c.currentCompanyName ?? c.matchedCompanyName;
      const ok = window.confirm(
        `Transfer ${name} from ${c.currentOwnerName ?? "its current owner"} to ${c.requesterName ?? "the requesting advisor"}?\n\n` +
          `The account keeps its existing name, contact details, stage and history. The requester's captured details are added to the end of the notes.`,
      );
      if (!ok) return;
    }
    setBusyId(c.id);
    setActionError(null);
    try {
      const note = notes[c.id]?.trim();
      await api.post(`/api/claim-requests/${c.id}/decide`, { decision, decision_note: note || undefined });
      setNotes((n) => ({ ...n, [c.id]: "" }));
      reload();
    } catch (err) {
      // stale_request / owner_changed both close the request server-side, so reload to
      // drop it from the queue rather than leaving a row that can't be acted on.
      setActionError(err instanceof ApiError ? err.message : "Could not decide");
      reload();
    } finally {
      setBusyId(null);
    }
  }

  if (loading) return <Spinner />;

  return (
    <div>
      <PageHead title="Takeover Requests" subtitle="Compare what each advisor holds, then approve or decline" />
      <ErrorBanner message={actionError ?? error} />
      {!data || data.claimRequests.length === 0 ? (
        <EmptyState icon="requests" title="No pending requests" hint="Territory takeover requests will appear here for review." />
      ) : (
        data.claimRequests.map((c) => {
          const liveName = c.currentCompanyName ?? c.matchedCompanyName;
          const typedName = c.draft.contractor_company_name;
          // Under exact matching these usually differ only in case or punctuation — but
          // when they differ at all the manager should see it, because approval keeps the
          // EXISTING name and the old behaviour overwrote it.
          const nameDiffers = !!typedName && typedName !== liveName;
          return (
            <Card key={c.id}>
              <div className="row" style={{ justifyContent: "space-between", gap: ".5rem", flexWrap: "wrap" }}>
                <strong>{liveName}</strong>
                {c.matchedOn && <StatusBadge label={MATCH_LABEL[c.matchedOn] ?? c.matchedOn} />}
              </div>
              <div className="muted" style={{ fontSize: ".85rem", marginTop: 4 }}>
                <strong>{c.requesterName ?? "An advisor"}</strong> wants to take over from{" "}
                <strong>{c.currentOwnerName ?? "the current owner"}</strong> · requested {dateShort(c.createdAt)}
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
                  gap: "1rem",
                  marginTop: ".75rem",
                }}
              >
                <div>
                  <div className="row" style={{ gap: ".4rem", marginBottom: ".25rem" }}>
                    <strong style={{ fontSize: ".8rem" }}>What they hold today</strong>
                    {c.opportunitySource === "referral" && <StatusBadge label="referral" kind="ai" />}
                  </div>
                  <Field label="Owner" value={c.currentOwnerName} />
                  <Field label="Stage" value={c.ownerStageLabel} />
                  <Field label="Deal value" value={c.dealValue == null ? null : money(c.dealValue)} />
                  <Field label="Activities logged" value={c.activityCount} />
                  <Field label="Quotes" value={c.quoteCount} />
                  <div className="row" style={{ justifyContent: "space-between", gap: ".75rem", padding: "2px 0" }}>
                    <span className="muted" style={{ fontSize: ".75rem" }}>
                      Account age
                    </span>
                    <AgeIndicator since={c.opportunityCreatedAt} />
                  </div>
                  {/* The fairest single signal: an account nobody has touched in months is
                      a much weaker claim than one worked last week. */}
                  <div className="row" style={{ justifyContent: "space-between", gap: ".75rem", padding: "2px 0" }}>
                    <span className="muted" style={{ fontSize: ".75rem" }}>
                      Last activity
                    </span>
                    {c.lastActivityAt ? <AgeIndicator since={c.lastActivityAt} suffix="ago" /> : <span style={{ fontSize: ".8rem" }}>—</span>}
                  </div>
                </div>

                <div>
                  <strong style={{ fontSize: ".8rem" }}>What the requester typed</strong>
                  <div style={{ marginTop: ".25rem" }}>
                    <Field label="Contact" value={c.draft.contact_name} />
                    <Field label="Email" value={c.draft.contact_email} />
                    <Field label="Phone" value={c.draft.contact_cell} />
                    <Field label="Product" value={c.draft.product} />
                    <Field label="Technicians" value={c.draft.num_technicians} />
                    <Field label="Value" value={c.draft.opportunity_value == null ? null : money(c.draft.opportunity_value)} />
                    <Field label="State" value={c.draft.state} />
                  </div>
                  {c.draft.notes && (
                    <div className="muted" style={{ fontSize: ".75rem", marginTop: ".4rem", whiteSpace: "pre-wrap" }}>
                      {c.draft.notes}
                    </div>
                  )}
                </div>
              </div>

              {nameDiffers && (
                <div className="muted" style={{ fontSize: ".75rem", marginTop: ".6rem" }}>
                  They typed <strong>{typedName}</strong>. Approving keeps the existing name{" "}
                  <strong>{liveName}</strong> and appends their captured details to the account notes — nothing on the
                  record is overwritten.
                </div>
              )}

              <textarea
                style={{ marginTop: ".75rem", minHeight: 60 }}
                placeholder="Decision note (optional) — shown to both advisors"
                value={notes[c.id] ?? ""}
                onChange={(e) => setNotes((n) => ({ ...n, [c.id]: e.target.value }))}
              />

              <div className="row" style={{ gap: ".5rem", marginTop: ".75rem", justifyContent: "flex-start" }}>
                <button className="btn success small" disabled={busyId === c.id} onClick={() => decide(c, "approved")}>
                  <Icon name="check" size={15} /> Approve
                </button>
                <button className="btn danger small" disabled={busyId === c.id} onClick={() => decide(c, "rejected")}>
                  <Icon name="x" size={15} /> Reject
                </button>
              </div>
            </Card>
          );
        })
      )}
    </div>
  );
}
