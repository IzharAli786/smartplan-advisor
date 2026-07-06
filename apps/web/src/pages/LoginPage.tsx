import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext.tsx";
import { useBranding } from "../branding/BrandingContext.tsx";
import { useTheme } from "../theme/ThemeContext.tsx";
import { AdviseWordmark } from "../components/AdviseWordmark.tsx";
import { ApiError } from "../api/client.ts";
import { ErrorBanner, PasswordInput } from "../components/ui.tsx";

export default function LoginPage() {
  const { user, login } = useAuth();
  const { lightLogoUrl, darkLogoUrl } = useBranding();
  const { mode } = useTheme();
  const logoUrl = mode === "dark" ? (darkLogoUrl ?? lightLogoUrl) : (lightLogoUrl ?? darkLogoUrl);
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/" replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
      navigate("/");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="center-screen">
      <div className="auth-card card stack">
        <div style={{ textAlign: "center" }}>
          {logoUrl ? (
            <img src={logoUrl} alt="Portal logo" style={{ maxHeight: 80, maxWidth: 280, objectFit: "contain" }} />
          ) : (
            <AdviseWordmark size={52} />
          )}
          <p className="muted" style={{ marginTop: ".4rem" }}>Advisor CRM · sign in to your account</p>
        </div>
        <ErrorBanner message={error} />
        <form onSubmit={onSubmit}>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <PasswordInput
              id="password"
              autoComplete="current-password"
              value={password}
              onChange={setPassword}
              required
            />
          </div>
          <button className="btn full" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
        <div style={{ textAlign: "center" }}>
          <Link to="/forgot-password" className="muted">
            Forgot password?
          </Link>
        </div>
        <div style={{ textAlign: "center", borderTop: "1px solid var(--color-border)", paddingTop: ".9rem" }}>
          <span className="muted" style={{ fontSize: ".85rem" }}>New here? </span>
          <Link to="/register">Register your business</Link>
        </div>
      </div>
    </div>
  );
}
