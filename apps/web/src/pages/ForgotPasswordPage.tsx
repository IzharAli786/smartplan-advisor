import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client.ts";
import { AdviseWordmark } from "../components/AdviseWordmark.tsx";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post("/api/auth/forgot-password", { email });
    } finally {
      setBusy(false);
      setSent(true); // Always succeed-looking — no account enumeration.
    }
  }

  return (
    <div className="center-screen">
      <div className="auth-card card stack">
        <div style={{ textAlign: "center" }}>
          <AdviseWordmark size={40} />
        </div>
        <h1>Reset password</h1>
        {sent ? (
          <>
            <div className="success-banner">If that email is registered, a reset link is on its way.</div>
            <Link className="btn full" to="/login">
              Back to sign in
            </Link>
          </>
        ) : (
          <form onSubmit={onSubmit}>
            <div className="field">
              <label htmlFor="email">Email</label>
              <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <button className="btn full" disabled={busy}>
              {busy ? "Sending…" : "Send reset link"}
            </button>
            <div style={{ textAlign: "center", marginTop: ".75rem" }}>
              <Link to="/login" className="muted">
                Back to sign in
              </Link>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
