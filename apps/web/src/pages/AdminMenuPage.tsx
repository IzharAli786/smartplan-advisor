import { Link } from "react-router-dom";
import { Card, PageHead } from "../components/ui.tsx";
import { Icon, type IconName } from "../components/Icon.tsx";
import { useAuth } from "../auth/AuthContext.tsx";

const ITEMS: { to: string; label: string; icon: IconName; hint: string }[] = [
  { to: "/users", label: "Smart Advisors", icon: "users", hint: "Roster, commission rates, invites" },
  { to: "/reports", label: "Reports", icon: "reports", hint: "Converted customers + CSV" },
  { to: "/settings", label: "Settings", icon: "settings", hint: "Products & status stages" },
  { to: "/library", label: "Library", icon: "library", hint: "Marketing collateral & videos" },
  { to: "/claims", label: "Takeover requests", icon: "requests", hint: "Approve / reject" },
];

export default function AdminMenuPage() {
  const { user } = useAuth();
  return (
    <div>
      <PageHead title="Admin" subtitle={`${user?.fullName} · ${user?.role === "super_admin" ? "Super Admin" : "Manager"}`} />
      {ITEMS.map((it) => (
        <Link key={it.to} to={it.to} style={{ color: "inherit" }}>
          <Card onClick={() => {}}>
            <div className="row" style={{ justifyContent: "flex-start", gap: ".75rem" }}>
              <span className="icon-tile">
                <Icon name={it.icon} size={20} />
              </span>
              <div style={{ flex: 1 }}>
                <strong>{it.label}</strong>
                <div className="muted" style={{ fontSize: ".8rem" }}>
                  {it.hint}
                </div>
              </div>
              <span className="muted" style={{ display: "inline-flex" }}>
                <Icon name="chevron-right" size={18} />
              </span>
            </div>
          </Card>
        </Link>
      ))}
    </div>
  );
}
