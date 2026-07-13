import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext.tsx";
import { api } from "../api/client.ts";
import { useBranding } from "../branding/BrandingContext.tsx";
import { useTheme } from "../theme/ThemeContext.tsx";
import { Icon, type IconName } from "./Icon.tsx";
import { AdviseWordmark } from "./AdviseWordmark.tsx";
import HighFiveOverlay from "./HighFiveOverlay.tsx";

interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  badge?: number;
  end?: boolean;
}

function initials(name: string): string {
  return name
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export default function Layout() {
  const { user, logout, isManager, isSuperAdmin, refresh } = useAuth();
  const avatarInputRef = useRef<HTMLInputElement>(null);

  async function uploadAvatar(file: File) {
    if (!user) return;
    const fd = new FormData();
    fd.set("file", file, file.name);
    try {
      await api.upload(`/api/users/${user.id}/avatar`, fd);
      await refresh();
    } catch {
      /* ignore */
    }
  }
  const { darkLogoUrl } = useBranding(); // sidebar is always navy → dark-bg logo
  const { mode, toggle } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);

  // Close the mobile drawer on navigation.
  useEffect(() => setOpen(false), [location.pathname]);

  // Poll the unread notification badge (in-app notification centre, §13).
  useEffect(() => {
    let active = true;
    const fetchUnread = () =>
      api
        .get<{ unread: number }>("/api/notifications")
        .then((d) => active && setUnread(d.unread))
        .catch(() => {});
    fetchUnread();
    const t = setInterval(fetchUnread, 30_000);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, []);

  const notif: NavItem = { to: "/notifications", label: "Notifications", icon: "bell", badge: unread };
  const items: NavItem[] = isManager
    ? [
        { to: "/dashboard", label: "Dashboard", icon: "dashboard" },
        { to: "/pipeline", label: "Pipeline", icon: "pipeline" },
        { to: "/users", label: "Smart Advisors", icon: "users" },
        ...(isSuperAdmin
          ? [{ to: "/super-admins", label: "Super Admins", icon: "user-plus" } as NavItem]
          : []),
        { to: "/leads", label: "Leads", icon: "building" },
        { to: "/address-book", label: "Address Book", icon: "contact" },
        { to: "/claims", label: "Takeover Requests", icon: "requests" },
        { to: "/quotes", label: "Quotes", icon: "file-text" },
        { to: "/library", label: "Library", icon: "library" },
        notif,
        { to: "/reports", label: "Reports", icon: "reports" },
        { to: "/settings", label: "Settings", icon: "settings" },
      ]
    : [
        { to: "/", label: "Today", icon: "today", end: true },
        { to: "/pipeline", label: "My Pipeline", icon: "pipeline" },
        { to: "/leads", label: "My Leads", icon: "building" },
        { to: "/performance", label: "Performance", icon: "trophy" },
        { to: "/new", label: "New Opportunity", icon: "plus" },
        { to: "/quotes", label: "Quotes", icon: "file-text" },
        { to: "/address-book", label: "Address Book", icon: "contact" },
        { to: "/library", label: "Library", icon: "library" },
        notif,
      ];

  return (
    <div className="layout">
      <aside className={`sidebar ${open ? "open" : ""}`}>
        <div className="sidebar-logo">
          {darkLogoUrl ? (
            <img className="custom-logo" src={darkLogoUrl} alt="Portal logo" />
          ) : (
            <span style={{ color: "#fff" }}>
              <AdviseWordmark size={26} />
            </span>
          )}
        </div>
        <nav className="sidebar-nav">
          {items.map((it) => (
            <NavLink key={it.to} to={it.to} end={it.end} className={({ isActive }) => (isActive ? "active" : "")}>
              <span className="nav-icon">
                <Icon name={it.icon} size={19} />
              </span>
              <span>{it.label}</span>
              {it.badge ? <span className="nav-badge">{it.badge > 99 ? "99+" : it.badge}</span> : null}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-user">
          <input
            ref={avatarInputRef}
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadAvatar(f); e.target.value = ""; }}
          />
          <div
            className={`avatar clickable ${user?.avatarUrl ? "has-img" : ""}`}
            title="Change your photo"
            onClick={() => avatarInputRef.current?.click()}
          >
            {user?.avatarUrl ? <img src={user.avatarUrl} alt="" /> : user ? initials(user.fullName) : "?"}
          </div>
          <div className="who">
            <div className="name">{user?.fullName}</div>
            <div className="role">{user?.role === "super_admin" ? "Super Admin" : "Advisor"}</div>
          </div>
          <div className="sidebar-actions">
            <button
              className="btn small secondary icon-only"
              aria-label={mode === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              title={mode === "dark" ? "Light mode" : "Dark mode"}
              onClick={toggle}
            >
              <Icon name={mode === "dark" ? "sun" : "moon"} size={16} />
            </button>
            <button className="btn small secondary" onClick={() => logout().then(() => navigate("/login"))}>
              Sign out
            </button>
          </div>
        </div>
      </aside>

      <div className={`scrim ${open ? "open" : ""}`} onClick={() => setOpen(false)} />

      <div className="content">
        <div className="mobile-topbar">
          <button className="hamburger" aria-label="Menu" onClick={() => setOpen(true)}>
            <Icon name="menu" size={22} />
          </button>
          <span className="brand">
            <span style={{ color: "var(--brand-blue)" }}>Smart</span>Plan
          </span>
        </div>
        <main className="app-main">
          <Outlet />
        </main>
      </div>

      {!isManager && (
        <NavLink to="/new" className="btn fab" aria-label="New opportunity">
          +
        </NavLink>
      )}

      <HighFiveOverlay />
    </div>
  );
}
