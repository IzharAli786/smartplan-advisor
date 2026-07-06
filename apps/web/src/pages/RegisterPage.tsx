import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext.tsx";
import { AdviseWordmark } from "../components/AdviseWordmark.tsx";
import { ApiError } from "../api/client.ts";
import { ErrorBanner, PasswordInput } from "../components/ui.tsx";
import { CURRENCIES, DATE_FORMATS, DEFAULT_CURRENCY, DEFAULT_DATE_FORMAT } from "@smart-crm/shared";

/** Public self-service registration — a new business creates its own isolated workspace. */
export default function RegisterPage() {
  const { user, register } = useAuth();
  const navigate = useNavigate();
  const [companyName, setCompanyName] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [currency, setCurrency] = useState<string>(DEFAULT_CURRENCY);
  const [dateFormat, setDateFormat] = useState<string>(DEFAULT_DATE_FORMAT);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/" replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (password.length < 10) {
      setError("Password must be at least 10 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await register({ companyName, fullName, email, password, currency, dateFormat });
      navigate("/");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create your account");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="center-screen">
      <div className="auth-card card stack">
        <div style={{ textAlign: "center" }}>
          <AdviseWordmark size={44} />
          <h1 style={{ marginTop: ".6rem", fontSize: "1.4rem" }}>Register your business</h1>
          <p className="muted" style={{ marginTop: ".3rem" }}>Create your company's own Scout workspace — it starts empty and private to you.</p>
        </div>
        <ErrorBanner message={error} />
        <form onSubmit={onSubmit}>
          <div className="field">
            <label htmlFor="company">Company name</label>
            <input id="company" value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="e.g. Acme Mechanical" required autoFocus />
          </div>
          <div className="field">
            <label htmlFor="name">Your name</label>
            <input id="name" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Full name" required />
          </div>
          <div className="field">
            <label htmlFor="email">Work email</label>
            <input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <PasswordInput id="password" autoComplete="new-password" value={password} onChange={setPassword} required />
            <div className="field-hint">At least 10 characters. You'll be the account owner (admin).</div>
          </div>
          <div className="field">
            <label htmlFor="confirm-password">Confirm password</label>
            <PasswordInput id="confirm-password" autoComplete="new-password" value={confirmPassword} onChange={setConfirmPassword} required />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: ".75rem" }}>
            <div className="field">
              <label htmlFor="currency">Currency</label>
              <select id="currency" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                {CURRENCIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="date-format">Date format</label>
              <select id="date-format" value={dateFormat} onChange={(e) => setDateFormat(e.target.value)}>
                {DATE_FORMATS.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="field-hint" style={{ marginTop: "-.35rem", marginBottom: ".75rem" }}>
            Sets how money and dates display across your workspace. You can change this later in Settings.
          </div>
          <button className="btn full" disabled={busy}>{busy ? "Creating your workspace…" : "Create account"}</button>
        </form>
        <div style={{ textAlign: "center" }}>
          <span className="muted" style={{ fontSize: ".85rem" }}>Already have an account? </span>
          <Link to="/login">Sign in</Link>
        </div>
      </div>
    </div>
  );
}
