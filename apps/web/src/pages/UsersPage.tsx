import { useRef, useState, type FormEvent } from "react";
import { useApi } from "../hooks/useApi.ts";
import { api, ApiError } from "../api/client.ts";
import { useAuth } from "../auth/AuthContext.tsx";
import { canEditUser } from "@smart-crm/shared";
import { Card, EmptyState, ErrorBanner, PageHead, Spinner, StatusBadge } from "../components/ui.tsx";
import { Icon } from "../components/Icon.tsx";
import { PhoneInput } from "../components/PhoneInput.tsx";
import type { CurrentUser } from "../api/types.ts";

const ROLE_LABEL: Record<string, string> = { super_admin: "Super Admin", manager: "Manager", advisor: "Advisor" };

export default function UsersPage() {
  const { user: me, isSuperAdmin } = useAuth();
  const { data, loading, error, reload } = useApi<{ users: CurrentUser[] }>("/api/users");
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [createForm, setCreateForm] = useState({
    full_name: "",
    email: "",
    role: "advisor",
    phone: "",
    states_covered: "",
    current_commission_rate: "33",
  });

  async function createUser(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      const payload: Record<string, unknown> = {
        full_name: createForm.full_name,
        email: createForm.email,
        role: createForm.role,
      };
      if (createForm.phone) payload.phone = createForm.phone;
      payload.states_covered = createForm.states_covered
        ? createForm.states_covered.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean)
        : [];
      if (createForm.role === "advisor" && createForm.current_commission_rate)
        payload.current_commission_rate = Number(createForm.current_commission_rate);
      await api.post("/api/users", payload);
      setShowCreate(false);
      setCreateForm({ full_name: "", email: "", role: "advisor", phone: "", states_covered: "", current_commission_rate: "33" });
      reload();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Could not create user");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Spinner />;

  return (
    <div>
      <PageHead
        title="Smart Advisors"
        subtitle="Roster, invites and advisor management"
        actions={
          isSuperAdmin ? (
            <button className="btn" onClick={() => { setShowCreate((v) => !v); setEditingId(null); }}>
              {showCreate ? <Icon name="x" size={16} /> : <Icon name="user-plus" size={16} />}
              {showCreate ? "Cancel" : "New user"}
            </button>
          ) : undefined
        }
      />
      <ErrorBanner message={error} />

      {showCreate && isSuperAdmin && (
        <Card>
          <h3>Create user</h3>
          <ErrorBanner message={formError} />
          <form onSubmit={createUser}>
            <div className="field">
              <label>Full name</label>
              <input value={createForm.full_name} onChange={(e) => setCreateForm({ ...createForm, full_name: e.target.value })} required />
            </div>
            <div className="field">
              <label>Email</label>
              <input type="email" value={createForm.email} onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })} required />
            </div>
            <div className="field">
              <label>Role</label>
              <select value={createForm.role} onChange={(e) => setCreateForm({ ...createForm, role: e.target.value })}>
                <option value="advisor">Advisor</option>
                <option value="manager">Manager</option>
                <option value="super_admin">Super Admin</option>
              </select>
            </div>
            <div className="field">
              <label>States covered (comma-separated)</label>
              <input value={createForm.states_covered} onChange={(e) => setCreateForm({ ...createForm, states_covered: e.target.value })} placeholder="CO, TX, AZ" />
            </div>
            {createForm.role === "advisor" && (
              <div className="field">
                <label>Commission rate (%)</label>
                <input type="number" step="0.01" value={createForm.current_commission_rate} onChange={(e) => setCreateForm({ ...createForm, current_commission_rate: e.target.value })} />
              </div>
            )}
            <button className="btn full" disabled={busy}>{busy ? "Creating…" : "Create & send invite"}</button>
          </form>
        </Card>
      )}

      {!data || data.users.length === 0 ? (
        <EmptyState icon="users" title="No users yet" />
      ) : (
        data.users.map((u) =>
          editingId === u.id ? (
            <EditUserCard
              key={u.id}
              user={u}
              onClose={() => setEditingId(null)}
              onSaved={() => { setEditingId(null); reload(); }}
            />
          ) : (
            <Card key={u.id}>
              <div className="row">
                <div className="row" style={{ justifyContent: "flex-start", gap: ".75rem", flex: 1 }}>
                  {u.avatarUrl ? (
                    <img className="profile-photo" style={{ width: 44, height: 44 }} src={u.avatarUrl} alt={u.fullName} />
                  ) : (
                    <div className="profile-photo" style={{ width: 44, height: 44, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: ".85rem", color: "var(--color-text-muted)" }}>
                      {u.fullName.split(" ").map((p) => p[0]).slice(0, 2).join("")}
                    </div>
                  )}
                  <div>
                    <strong>{u.fullName}</strong>
                    <div className="muted" style={{ fontSize: ".8rem" }}>{u.email}</div>
                  </div>
                </div>
                <StatusBadge
                  label={u.status}
                  kind={u.status === "active" ? "success" : u.status === "deactivated" ? "overdue" : undefined}
                />
              </div>
              <div className="muted" style={{ fontSize: ".78rem", marginTop: 6 }}>
                {ROLE_LABEL[u.role]} · {u.statesCovered.join(", ") || "—"}
                {u.currentCommissionRate != null && u.role === "advisor" ? ` · ${u.currentCommissionRate}% comm.` : ""}
              </div>
              {me && canEditUser(me.role, u.role) && (
                <div className="row" style={{ gap: ".5rem", marginTop: ".75rem", justifyContent: "flex-start" }}>
                  <button className="btn small secondary" onClick={() => { setEditingId(u.id); setShowCreate(false); }}>
                    <Icon name="edit" size={15} /> Edit
                  </button>
                </div>
              )}
            </Card>
          ),
        )
      )}
    </div>
  );
}

function EditUserCard({ user, onClose, onSaved }: { user: CurrentUser; onClose: () => void; onSaved: () => void }) {
  const isAdvisor = user.role === "advisor";
  const [f, setF] = useState({
    full_name: user.fullName,
    email: user.email,
    phone: user.phone ?? "",
    phone2: user.phone2 ?? "",
    address: user.address ?? "",
    current_commission_rate: user.currentCommissionRate != null ? String(user.currentCommissionRate) : "33",
    monthly_quota: user.monthlyQuota != null ? String(user.monthlyQuota) : "",
    commission_effective_from: "",
    start_date: user.startDate ?? "",
    referral_link: user.referralLink ?? "",
    enrolled_date: user.enrolledDate ?? "",
    referred_by: user.referredBy ?? "",
    active: user.active,
    notes: user.notes ?? "",
    states_covered: user.statesCovered.join(", "),
    password: "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const avatarRef = useRef<HTMLInputElement>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(user.avatarUrl ?? null);

  function upd<K extends keyof typeof f>(k: K, v: (typeof f)[K]) {
    setF((s) => ({ ...s, [k]: v }));
  }

  async function uploadAvatar(file: File) {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const fd = new FormData();
      fd.set("file", file, file.name);
      const res = await api.upload<{ avatarUrl: string }>(`/api/users/${user.id}/avatar`, fd);
      setAvatarUrl(res.avatarUrl);
      setMsg("Profile photo updated.");
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : "Could not upload photo");
    } finally {
      setBusy(false);
    }
  }

  const initials = user.fullName.split(" ").map((p) => p[0]).slice(0, 2).join("");

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const payload: Record<string, unknown> = {
        full_name: f.full_name,
        email: f.email,
        phone: f.phone,
        phone2: f.phone2,
        address: f.address,
        active: f.active,
        notes: f.notes,
        referral_link: f.referral_link,
        referred_by: f.referred_by,
        states_covered: f.states_covered.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean),
      };
      if (f.start_date) payload.start_date = f.start_date;
      if (f.enrolled_date) payload.enrolled_date = f.enrolled_date;
      if (isAdvisor && f.current_commission_rate) payload.current_commission_rate = Number(f.current_commission_rate);
      if (isAdvisor && f.commission_effective_from) payload.commission_effective_from = f.commission_effective_from;
      if (isAdvisor && f.monthly_quota !== "") payload.monthly_quota = Number(f.monthly_quota);
      if (f.password) payload.password = f.password;
      await api.patch(`/api/users/${user.id}`, payload);
      onSaved();
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  async function sendReset() {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      await api.post(`/api/users/${user.id}/send-password-reset`);
      setMsg("Password-reset link sent to the advisor's email.");
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : "Could not send reset");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="">
      <div className="row">
        <h3>Edit {user.fullName}</h3>
        <button className="btn small ghost" onClick={onClose}><Icon name="x" size={15} /> Close</button>
      </div>
      <ErrorBanner message={err} />
      {msg && <div className="success-banner">{msg}</div>}

      <div className="row" style={{ justifyContent: "flex-start", gap: ".75rem", marginBottom: ".75rem" }}>
        <input ref={avatarRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => { const file = e.target.files?.[0]; if (file) uploadAvatar(file); e.target.value = ""; }} />
        {avatarUrl ? (
          <img className="profile-photo" src={avatarUrl} alt={user.fullName} />
        ) : (
          <div className="profile-photo" style={{ display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, color: "var(--color-text-muted)" }}>{initials}</div>
        )}
        <button type="button" className="btn small secondary" disabled={busy} onClick={() => avatarRef.current?.click()}>
          <Icon name="upload" size={14} /> {avatarUrl ? "Change photo" : "Add profile photo"}
        </button>
      </div>

      <form onSubmit={save}>
        <div className="field">
          <label>Full name</label>
          <input value={f.full_name} onChange={(e) => upd("full_name", e.target.value)} required />
        </div>
        <div className="field">
          <label>Email</label>
          <input type="email" value={f.email} onChange={(e) => upd("email", e.target.value)} required />
        </div>
        <div className="row" style={{ gap: ".5rem" }}>
          <div className="field" style={{ flex: 1 }}>
            <label>Cell number</label>
            <PhoneInput value={f.phone} onChange={(v) => upd("phone", v)} />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>2nd cell number</label>
            <PhoneInput value={f.phone2} onChange={(v) => upd("phone2", v)} />
          </div>
        </div>
        <div className="field">
          <label>Physical address</label>
          <input value={f.address} onChange={(e) => upd("address", e.target.value)} />
        </div>
        <div className="field">
          <label>Referral link</label>
          <input type="url" value={f.referral_link} onChange={(e) => upd("referral_link", e.target.value)} placeholder="https://…" />
        </div>
        <div className="row" style={{ gap: ".5rem" }}>
          <div className="field" style={{ flex: 1 }}>
            <label>Enrolled date</label>
            <input type="date" value={f.enrolled_date} onChange={(e) => upd("enrolled_date", e.target.value)} />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>Referred by</label>
            <input value={f.referred_by} onChange={(e) => upd("referred_by", e.target.value)} placeholder="Name of referrer" />
          </div>
        </div>
        <div className="row" style={{ gap: ".5rem" }}>
          <div className="field" style={{ flex: 1 }}>
            <label>Start date</label>
            <input type="date" value={f.start_date} onChange={(e) => upd("start_date", e.target.value)} />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>Status</label>
            <select value={f.active ? "active" : "inactive"} onChange={(e) => upd("active", e.target.value === "active")}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
        </div>
        {isAdvisor && (
          <div className="row" style={{ gap: ".5rem" }}>
            <div className="field" style={{ flex: 1 }}>
              <label>Commission level (%)</label>
              <input type="number" step="0.01" value={f.current_commission_rate} onChange={(e) => upd("current_commission_rate", e.target.value)} />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label>Rate effective from</label>
              <input type="date" value={f.commission_effective_from} onChange={(e) => upd("commission_effective_from", e.target.value)} />
              <div className="field-hint">When a new rate takes effect (defaults to today). Past deals keep their rate.</div>
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label>Monthly quota ($)</label>
              <input type="number" step="100" value={f.monthly_quota} onChange={(e) => upd("monthly_quota", e.target.value)} placeholder="e.g. 25000" />
            </div>
          </div>
        )}
        <div className="field">
          <label>States covered (comma-separated)</label>
          <input value={f.states_covered} onChange={(e) => upd("states_covered", e.target.value)} placeholder="CO, TX, AZ" />
        </div>
        <div className="field">
          <label>Notes</label>
          <textarea value={f.notes} onChange={(e) => upd("notes", e.target.value)} placeholder="Internal notes (not shown to the advisor)" />
        </div>
        <div className="field">
          <label>Set new password</label>
          <input type="password" value={f.password} onChange={(e) => upd("password", e.target.value)} autoComplete="new-password" placeholder="Leave blank to keep current" minLength={10} />
          <div className="field-hint">Sets the password directly and signs the advisor out of other sessions.</div>
        </div>
        <div className="row" style={{ gap: ".5rem", justifyContent: "flex-start" }}>
          <button className="btn" disabled={busy}>{busy ? "Saving…" : "Save changes"}</button>
          <button type="button" className="btn secondary" disabled={busy} onClick={sendReset}>
            <Icon name="mail" size={15} /> Send password reminder
          </button>
        </div>
      </form>
    </Card>
  );
}
