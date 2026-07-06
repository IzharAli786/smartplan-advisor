import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, ApiError } from "../api/client.ts";
import { ErrorBanner, PasswordInput } from "../components/ui.tsx";
import { AdviseWordmark } from "../components/AdviseWordmark.tsx";

export default function SetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (password !== confirm) return setError("Passwords don't match");
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/auth/set-password", { token, password });
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not set password");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="center-screen">
      <div className="auth-card card stack">
        <div style={{ textAlign: "center" }}>
          <AdviseWordmark size={40} />
        </div>
        <h1>Set your password</h1>
        {!token && <ErrorBanner message="This link is missing its token. Please use the link from your invite email." />}
        {done ? (
          <>
            <div className="success-banner">Password set. You can sign in now.</div>
            <Link className="btn full" to="/login">
              Go to sign in
            </Link>
          </>
        ) : (
          <>
            <ErrorBanner message={error} />
            <form onSubmit={onSubmit}>
              <div className="field">
                <label htmlFor="pw">New password</label>
                <PasswordInput id="pw" value={password} onChange={setPassword} autoComplete="new-password" required minLength={10} />
                <div className="field-hint">At least 10 characters.</div>
              </div>
              <div className="field">
                <label htmlFor="cf">Confirm password</label>
                <PasswordInput id="cf" value={confirm} onChange={setConfirm} autoComplete="new-password" required />
              </div>
              <button className="btn full" disabled={busy || !token}>
                {busy ? "Saving…" : "Set password"}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
