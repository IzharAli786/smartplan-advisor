import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Icon, type IconName } from "./Icon.tsx";

/** Password field with a show/hide (eye) toggle. Render your own <label> above it. */
export function PasswordInput({
  id,
  value,
  onChange,
  autoComplete,
  required,
  minLength,
  placeholder,
}: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete?: string;
  required?: boolean;
  minLength?: number;
  placeholder?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div style={{ position: "relative" }}>
      <input
        id={id}
        type={show ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        required={required}
        minLength={minLength}
        placeholder={placeholder}
        style={{ paddingRight: "2.6rem" }}
      />
      <button
        type="button"
        aria-label={show ? "Hide password" : "Show password"}
        onClick={() => setShow((s) => !s)}
        style={{
          position: "absolute",
          right: ".55rem",
          top: "50%",
          transform: "translateY(-50%)",
          background: "none",
          border: "none",
          cursor: "pointer",
          color: "var(--color-text-muted)",
          padding: 4,
          display: "inline-flex",
          lineHeight: 1,
        }}
      >
        <Icon name={show ? "eye-off" : "eye"} size={18} />
      </button>
    </div>
  );
}

export function Spinner() {
  return (
    <div className="center-screen">
      <div className="spinner" aria-label="Loading" />
    </div>
  );
}

export function ErrorBanner({ message }: { message: string | null }) {
  if (!message) return null;
  return <div className="error-banner">{message}</div>;
}

/** Teal hexagon-check mark used beside page titles (matches SmartPlan look). */
export function HexCheck() {
  return (
    <svg className="hex-check" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <path
        d="M24 3 41.6 13v22L24 45 6.4 35V13z"
        fill="#0f1825"
        stroke="#14b8a6"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      <path d="M16 24l5.5 5.5L33 18" stroke="#14b8a6" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Standard page header: optional hex icon, title, subtitle, right-aligned actions. */
export function PageHead({
  title,
  subtitle,
  hex,
  actions,
}: {
  title: string;
  subtitle?: string;
  hex?: boolean;
  actions?: ReactNode;
}) {
  return (
    <div className="page-head">
      <div>
        <div className="title-row">
          {hex && <HexCheck />}
          <h1>{title}</h1>
        </div>
        {subtitle && <div className="subtitle">{subtitle}</div>}
      </div>
      {actions && <div className="actions">{actions}</div>}
    </div>
  );
}

export function StatGrid({ children }: { children: ReactNode }) {
  return <div className="stat-grid">{children}</div>;
}

export function StatCard({
  label,
  value,
  sub,
  icon,
  to,
}: {
  label: string;
  value: ReactNode;
  sub?: string;
  icon?: ReactNode;
  to?: string;
}) {
  const inner = (
    <>
      <div className="stat-top">
        <span className="stat-label">{label}</span>
        {icon && <span className="stat-icon">{icon}</span>}
      </div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </>
  );
  if (to) {
    return (
      <Link to={to} className="stat-card linkable">
        {inner}
      </Link>
    );
  }
  return <div className="stat-card">{inner}</div>;
}

export function Progress({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className="progress" aria-label={`${pct}%`}>
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  hint,
  actionLabel,
  actionTo,
}: {
  icon?: IconName;
  title: string;
  hint?: string;
  actionLabel?: string;
  actionTo?: string;
}) {
  // No dead-end empty states (§4): every empty list points at the next action.
  return (
    <div className="empty-state stack">
      {icon && (
        <div>
          <span className="empty-icon">
            <Icon name={icon} size={26} />
          </span>
        </div>
      )}
      <div style={{ fontWeight: 600, color: "var(--color-text)" }}>{title}</div>
      {hint && <div className="muted">{hint}</div>}
      {actionLabel && actionTo && (
        <div>
          <Link className="btn small" to={actionTo}>
            {actionLabel}
          </Link>
        </div>
      )}
    </div>
  );
}

export function StatusBadge({ label, kind }: { label: string; kind?: "overdue" | "success" | "ai" }) {
  return <span className={`badge ${kind ?? ""}`}>{label}</span>;
}

/** Elapsed-days chip for an opportunity's logged date. Green ≤7d, amber ≤30d, red older. */
export function AgeIndicator({ since, suffix = "old" }: { since: string | null | undefined; suffix?: string }) {
  if (!since) return null;
  const days = Math.max(0, Math.floor((Date.now() - new Date(since).getTime()) / 86_400_000));
  const kind = days <= 7 ? "fresh" : days <= 30 ? "aging" : "stale";
  const text = days === 0 ? "Today" : days === 1 ? "1 day" : `${days} days`;
  return (
    <span className={`age-chip ${kind}`} title={`Logged ${new Date(since).toLocaleDateString("en-US")}`}>
      <Icon name="clock" size={13} />
      {text}
      {days > 0 && suffix ? ` ${suffix}` : ""}
    </span>
  );
}

export function Card({ children, onClick, className }: { children: ReactNode; onClick?: () => void; className?: string }) {
  return (
    <div className={`card ${onClick ? "tappable" : ""} ${className ?? ""}`} onClick={onClick}>
      {children}
    </div>
  );
}
