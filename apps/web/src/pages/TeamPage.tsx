import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useApi } from "../hooks/useApi.ts";
import { useAuth } from "../auth/AuthContext.tsx";
import { api, ApiError } from "../api/client.ts";
import { Card, EmptyState, ErrorBanner, PageHead, Spinner } from "../components/ui.tsx";
import { Icon } from "../components/Icon.tsx";
import { dateShort } from "../lib/format.ts";
import type { AdvisorFeedbackEntry, TeamMember } from "../api/types.ts";

function initials(name: string): string {
  return name.split(" ").map((p) => p[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
}

/** Team page: every advisor's bio & unique capabilities, visible to the whole org.
 *  Advisors edit their own profile here and see feedback their manager wrote for them. */
export default function TeamPage() {
  const { user, isManager } = useAuth();
  const { data, loading, error, reload } = useApi<{ advisors: TeamMember[] }>("/api/team");
  const advisors = data?.advisors ?? [];
  const me = advisors.find((a) => a.id === user?.id);

  return (
    <div>
      <PageHead
        title="Advisor Network"
        subtitle="Who's who — every Smart Advisor's bio and unique capabilities"
      />
      <ErrorBanner message={error} />

      {!isManager && me && <MyProfileEditor me={me} reload={reload} />}
      {!isManager && user && <MyFeedback advisorId={user.id} />}

      {loading ? (
        <Spinner />
      ) : advisors.length === 0 ? (
        <EmptyState icon="users" title="No advisors yet" hint="Advisors appear here once they're added." />
      ) : (
        advisors.map((a) => (
          <Card key={a.id}>
            <div className="row" style={{ justifyContent: "flex-start", gap: ".75rem", alignItems: "flex-start" }}>
              {a.avatarUrl ? (
                <img className="profile-photo" src={a.avatarUrl} alt={a.fullName} />
              ) : (
                <div className="profile-photo" style={{ display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, color: "var(--color-text-muted)" }}>
                  {initials(a.fullName)}
                </div>
              )}
              <div style={{ flex: 1 }}>
                <div className="row" style={{ justifyContent: "flex-start", gap: ".5rem" }}>
                  {isManager ? (
                    <Link to={`/advisors/${a.id}`}><strong>{a.fullName}</strong></Link>
                  ) : (
                    <strong>{a.fullName}</strong>
                  )}
                  {a.id === user?.id && <span className="badge">You</span>}
                </div>
                <div className="muted" style={{ fontSize: ".8rem" }}>
                  <a href={`mailto:${a.email}`}>{a.email}</a>
                  {a.statesCovered.length > 0 && <> · {a.statesCovered.join(", ")}</>}
                </div>
                {a.bio ? (
                  <p style={{ marginTop: ".6rem", whiteSpace: "pre-wrap" }}>{a.bio}</p>
                ) : (
                  <p className="muted" style={{ marginTop: ".6rem" }}>No bio yet.</p>
                )}
                {a.capabilities && (
                  <>
                    <div className="muted" style={{ fontSize: ".78rem", marginTop: ".6rem", fontWeight: 600 }}>
                      Unique capabilities
                    </div>
                    <p style={{ marginTop: ".2rem", whiteSpace: "pre-wrap" }}>{a.capabilities}</p>
                  </>
                )}
              </div>
            </div>
          </Card>
        ))
      )}
    </div>
  );
}

/** The signed-in advisor's own bio editor (PUT /api/team/me/profile). */
function MyProfileEditor({ me, reload }: { me: TeamMember; reload: () => void }) {
  const [bio, setBio] = useState(me.bio ?? "");
  const [capabilities, setCapabilities] = useState(me.capabilities ?? "");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Refresh the form if the server copy changes (e.g. after reload on another tab).
  useEffect(() => {
    setBio(me.bio ?? "");
    setCapabilities(me.capabilities ?? "");
  }, [me.bio, me.capabilities]);

  async function save() {
    setBusy(true);
    setErr(null);
    setSaved(false);
    try {
      await api.put("/api/team/me/profile", { bio, capabilities });
      setSaved(true);
      reload();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not save your profile");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <h3>My profile</h3>
      <p className="muted" style={{ fontSize: ".78rem", marginBottom: ".6rem" }}>
        Your bio and unique capabilities are visible to every Smart Advisor on the Advisor Network page.
      </p>
      <ErrorBanner message={err} />
      <div className="field">
        <label>Bio</label>
        <textarea
          rows={4}
          maxLength={4000}
          placeholder="A short introduction — your background, focus and experience…"
          value={bio}
          onChange={(e) => { setBio(e.target.value); setSaved(false); }}
        />
      </div>
      <div className="field">
        <label>Unique capabilities</label>
        <textarea
          rows={3}
          maxLength={4000}
          placeholder="What you bring that others can lean on — industries, languages, specialties…"
          value={capabilities}
          onChange={(e) => { setCapabilities(e.target.value); setSaved(false); }}
        />
      </div>
      <button className="btn" onClick={save} disabled={busy}>
        {saved ? "Saved ✓" : busy ? "Saving…" : "Save profile"}
      </button>
    </Card>
  );
}

/** Feedback the manager wrote for this advisor (read-only for the advisor). */
function MyFeedback({ advisorId }: { advisorId: string }) {
  const { data, loading } = useApi<{ feedback: AdvisorFeedbackEntry[] }>(`/api/team/${advisorId}/feedback`);
  const entries = data?.feedback ?? [];
  if (loading || entries.length === 0) return null;
  return (
    <Card>
      <h3 style={{ display: "flex", alignItems: "center", gap: ".4rem" }}>
        <Icon name="message-square" size={17} /> Feedback from your manager
      </h3>
      {entries.map((f) => (
        <div key={f.id} style={{ marginTop: ".7rem" }}>
          <div className="muted" style={{ fontSize: ".78rem" }}>
            {f.authorName ?? "Manager"} · {dateShort(f.createdAt)}
          </div>
          <p style={{ marginTop: ".15rem", whiteSpace: "pre-wrap" }}>{f.body}</p>
        </div>
      ))}
    </Card>
  );
}
