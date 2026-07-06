import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useStages, useProducts, useJourneyStages } from "../hooks/useSettings.ts";
import { useApi } from "../hooks/useApi.ts";
import { api, ApiError } from "../api/client.ts";
import { useAuth } from "../auth/AuthContext.tsx";
import { setFormatPrefs } from "../lib/format.ts";
import { CURRENCIES, DATE_FORMATS } from "@smart-crm/shared";
import type { ActivityTypeDef, BadgeTier, OrgPrefs } from "../api/types.ts";
import { Card, ErrorBanner, PageHead, Spinner, StatusBadge } from "../components/ui.tsx";
import { Icon } from "../components/Icon.tsx";

export default function SettingsPage() {
  const { isSuperAdmin, refresh: refreshAuth } = useAuth();
  const { data: orgData, reload: reloadOrg } = useApi<{ org: OrgPrefs }>("/api/settings/organization");
  const [orgCurrency, setOrgCurrency] = useState("");
  const [orgDateFormat, setOrgDateFormat] = useState("");
  const [orgSaving, setOrgSaving] = useState(false);
  const [orgSaved, setOrgSaved] = useState(false);
  useEffect(() => {
    if (orgData?.org) {
      setOrgCurrency(orgData.org.currency);
      setOrgDateFormat(orgData.org.dateFormat);
    }
  }, [orgData]);

  async function saveOrgPrefs(e: FormEvent) {
    e.preventDefault();
    setOrgSaving(true);
    setOrgSaved(false);
    try {
      const { org } = await api.patch<{ org: OrgPrefs }>("/api/settings/organization", { currency: orgCurrency, date_format: orgDateFormat });
      setFormatPrefs(org); // apply immediately, no reload needed
      await refreshAuth();
      reloadOrg();
      setOrgSaved(true);
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : "Failed to save preferences");
    } finally {
      setOrgSaving(false);
    }
  }
  const { data: stagesData, loading: ls, reload: reloadStages } = useStages();
  const { data: productsData, loading: lp, reload: reloadProducts } = useProducts();
  const { data: journeyData, reload: reloadJourney } = useJourneyStages();
  const { data: actData, reload: reloadActs } = useApi<{ activityTypes: ActivityTypeDef[] }>("/api/settings/activity-types");
  const { data: badgeData, reload: reloadBadges } = useApi<{ badgeTiers: BadgeTier[] }>("/api/settings/badge-tiers");
  const [err, setErr] = useState<string | null>(null);
  const [newActivity, setNewActivity] = useState({ label: "", category: "sales" });
  const [newBadge, setNewBadge] = useState({ label: "", min_percent: "" });

  async function addActivity(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    try {
      const order = (actData?.activityTypes.length ?? 0) + 1;
      await api.post("/api/settings/activity-types", { label: newActivity.label, category: newActivity.category, sort_order: order, active: true });
      setNewActivity({ label: "", category: newActivity.category });
      reloadActs();
    } catch (e2) { setErr(e2 instanceof ApiError ? e2.message : "Failed"); }
  }
  async function patchActivity(id: string, patch: Record<string, unknown>) {
    await api.patch(`/api/settings/activity-types/${id}`, patch);
    reloadActs();
  }
  async function addBadge(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    try {
      const order = (badgeData?.badgeTiers.length ?? 0) + 1;
      await api.post("/api/settings/badge-tiers", { label: newBadge.label, min_percent: Number(newBadge.min_percent) || 0, sort_order: order });
      setNewBadge({ label: "", min_percent: "" });
      reloadBadges();
    } catch (e2) { setErr(e2 instanceof ApiError ? e2.message : "Failed"); }
  }
  async function patchBadge(id: string, patch: Record<string, unknown>) {
    await api.patch(`/api/settings/badge-tiers/${id}`, patch);
    reloadBadges();
  }
  async function delBadge(id: string) {
    await api.delete(`/api/settings/badge-tiers/${id}`);
    reloadBadges();
  }

  const [newProduct, setNewProduct] = useState("");
  const [newProductPrice, setNewProductPrice] = useState("");
  const [newStage, setNewStage] = useState({ key: "", label: "" });
  const [newJourney, setNewJourney] = useState("");

  async function addJourney(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    try {
      const order = (journeyData?.stages.length ?? 0) + 1;
      await api.post("/api/settings/journey-stages", { label: newJourney, sort_order: order, active: true });
      setNewJourney("");
      reloadJourney();
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : "Failed");
    }
  }

  async function patchJourney(id: string, patch: Record<string, unknown>) {
    await api.patch(`/api/settings/journey-stages/${id}`, patch);
    reloadJourney();
  }

  async function addProduct(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    try {
      const order = (productsData?.products.length ?? 0) + 1;
      await api.post("/api/settings/products", {
        label: newProduct,
        sort_order: order,
        active: true,
        ...(newProductPrice ? { default_price: Number(newProductPrice) } : {}),
      });
      setNewProduct("");
      setNewProductPrice("");
      reloadProducts();
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : "Failed");
    }
  }

  async function toggleProduct(id: string, active: boolean) {
    await api.patch(`/api/settings/products/${id}`, { active });
    reloadProducts();
  }

  async function patchProductPrice(id: string, default_price: number | null) {
    await api.patch(`/api/settings/products/${id}`, { default_price });
    reloadProducts();
  }

  async function addStage(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    try {
      const order = (stagesData?.stages.length ?? 0) + 1;
      await api.post("/api/settings/status-stages", {
        key: newStage.key.trim().toLowerCase().replace(/\s+/g, "_"),
        label: newStage.label,
        sort_order: order,
        is_conversion: false,
        is_terminal: false,
      });
      setNewStage({ key: "", label: "" });
      reloadStages();
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : "Failed");
    }
  }

  async function patchStage(id: string, patch: Record<string, unknown>) {
    await api.patch(`/api/settings/status-stages/${id}`, patch);
    reloadStages();
  }

  if (ls || lp) return <Spinner />;

  return (
    <div>
      <PageHead title="Settings" subtitle="Products and status stages — shape the CRM without a developer" />
      <ErrorBanner message={err} />

      {isSuperAdmin && orgData?.org && (
        <Card>
          <h3>Organization preferences</h3>
          <p className="muted" style={{ fontSize: ".8rem" }}>
            How money and dates display across your workspace for everyone on the team.
          </p>
          <form onSubmit={saveOrgPrefs}>
            <div className="row" style={{ gap: ".75rem", alignItems: "flex-end", flexWrap: "wrap" }}>
              <div className="field" style={{ marginBottom: 0, flex: "1 1 220px" }}>
                <label htmlFor="org-currency">Currency</label>
                <select id="org-currency" value={orgCurrency} onChange={(e) => { setOrgCurrency(e.target.value); setOrgSaved(false); }}>
                  {CURRENCIES.map((c) => (
                    <option key={c.code} value={c.code}>{c.label}</option>
                  ))}
                </select>
              </div>
              <div className="field" style={{ marginBottom: 0, flex: "1 1 220px" }}>
                <label htmlFor="org-date-format">Date format</label>
                <select id="org-date-format" value={orgDateFormat} onChange={(e) => { setOrgDateFormat(e.target.value); setOrgSaved(false); }}>
                  {DATE_FORMATS.map((d) => (
                    <option key={d.value} value={d.value}>{d.label}</option>
                  ))}
                </select>
              </div>
              <button
                className="btn"
                disabled={orgSaving || (orgCurrency === orgData.org.currency && orgDateFormat === orgData.org.dateFormat)}
              >
                {orgSaving ? "Saving…" : "Save"}
              </button>
              {orgSaved && <span className="muted" style={{ fontSize: ".8rem", color: "var(--color-success, #1a7f43)" }}>Saved</span>}
            </div>
          </form>
        </Card>
      )}

      <Link to="/branding" style={{ color: "inherit" }}>
        <Card onClick={() => {}}>
          <div className="row" style={{ justifyContent: "flex-start", gap: ".75rem" }}>
            <span className="icon-tile">
              <Icon name="image" size={20} />
            </span>
            <div style={{ flex: 1 }}>
              <strong>Branding</strong>
              <div className="muted" style={{ fontSize: ".8rem" }}>
                Upload your portal logo (sidebar &amp; sign-in screen)
              </div>
            </div>
            <span className="muted" style={{ display: "inline-flex" }}>
              <Icon name="chevron-right" size={18} />
            </span>
          </div>
        </Card>
      </Link>

      <Link to="/settings/email-templates" style={{ color: "inherit" }}>
        <Card onClick={() => {}}>
          <div className="row" style={{ justifyContent: "flex-start", gap: ".75rem" }}>
            <span className="icon-tile">
              <Icon name="mail" size={20} />
            </span>
            <div style={{ flex: 1 }}>
              <strong>Email Templates</strong>
              <div className="muted" style={{ fontSize: ".8rem" }}>
                Reusable emails with personalization tags, CC/BCC &amp; attachments
              </div>
            </div>
            <span className="muted" style={{ display: "inline-flex" }}>
              <Icon name="chevron-right" size={18} />
            </span>
          </div>
        </Card>
      </Link>

      <Card>
        <h3>Products &amp; pricing</h3>
        <p className="muted" style={{ fontSize: ".8rem" }}>
          Set each product's price here. When an advisor picks it on a quote, the price fills in automatically.
        </p>
        {productsData?.products.map((p) => (
          <div key={p.id} className="row" style={{ padding: "4px 0", gap: ".5rem" }}>
            <span style={{ opacity: p.active ? 1 : 0.5, flex: 1 }}>{p.label}</span>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 4, fontWeight: 400, fontSize: ".8rem", margin: 0 }}>
              $
              <input
                type="number"
                step="1"
                defaultValue={p.defaultPrice ?? ""}
                placeholder="price"
                onBlur={(e) => {
                  const v = e.target.value === "" ? null : Number(e.target.value);
                  if (String(v ?? "") !== String(p.defaultPrice ?? "")) patchProductPrice(p.id, v);
                }}
                style={{ width: 90, height: 30, padding: "0 .4rem" }}
              />
            </label>
            <button className="btn small ghost" onClick={() => toggleProduct(p.id, !p.active)}>
              {p.active ? "Hide" : "Show"}
            </button>
          </div>
        ))}
        <form onSubmit={addProduct} className="row" style={{ gap: ".5rem", marginTop: ".5rem" }}>
          <input value={newProduct} onChange={(e) => setNewProduct(e.target.value)} placeholder="New product name" required style={{ flex: 1 }} />
          <input type="number" step="1" value={newProductPrice} onChange={(e) => setNewProductPrice(e.target.value)} placeholder="Price ($)" style={{ width: 110 }} />
          <button className="btn small">Add</button>
        </form>
      </Card>

      <Card>
        <h3>Stages</h3>
        <p className="muted" style={{ fontSize: ".8rem" }}>
          The sales-journey touchpoints shown as a stepper on each opportunity (e.g. Intro Call, Zoom Demo, Trial
          Started). Reorder by editing the order number; hide one by unticking Active.
        </p>
        {journeyData?.stages.map((s) => (
          <div key={s.id} className="row" style={{ padding: "6px 0", gap: ".5rem", borderBottom: "1px solid var(--color-border)" }}>
            <input
              defaultValue={s.label}
              onBlur={(e) => e.target.value !== s.label && patchJourney(s.id, { label: e.target.value })}
              style={{ flex: 1, opacity: s.active ? 1 : 0.5 }}
            />
            <label style={{ display: "inline-flex", alignItems: "center", gap: 4, fontWeight: 400, fontSize: ".8rem", margin: 0 }}>
              Order
              <input
                type="number"
                defaultValue={s.sortOrder}
                onBlur={(e) => Number(e.target.value) !== s.sortOrder && patchJourney(s.id, { sort_order: Number(e.target.value) })}
                style={{ width: 60, height: 30, padding: "0 .4rem" }}
              />
            </label>
            <label style={{ fontWeight: 400, fontSize: ".8rem" }}>
              <input type="checkbox" style={{ width: "auto", marginRight: 4 }} checked={s.active} onChange={(e) => patchJourney(s.id, { active: e.target.checked })} />
              Active
            </label>
          </div>
        ))}
        <form onSubmit={addJourney} className="row" style={{ gap: ".5rem", marginTop: ".75rem" }}>
          <input value={newJourney} onChange={(e) => setNewJourney(e.target.value)} placeholder="New stage (e.g. Follow Up Email)" required style={{ flex: 1 }} />
          <button className="btn small">Add</button>
        </form>
      </Card>

      <Card>
        <h3>Activity types</h3>
        <p className="muted" style={{ fontSize: ".8rem" }}>
          What advisors log time against. <strong>Sales</strong> activities keep their projection on track; <strong>Non-sales</strong> hours reduce it.
        </p>
        {actData?.activityTypes.map((a) => (
          <div key={a.id} className="row" style={{ padding: "6px 0", gap: ".5rem", borderBottom: "1px solid var(--color-border)" }}>
            <input defaultValue={a.label} onBlur={(e) => e.target.value !== a.label && patchActivity(a.id, { label: e.target.value })} style={{ flex: 1, opacity: a.active ? 1 : 0.5 }} />
            <select value={a.category} onChange={(e) => patchActivity(a.id, { category: e.target.value })} style={{ width: 130 }}>
              <option value="sales">Sales</option>
              <option value="non_sales">Non-sales</option>
            </select>
            <label style={{ fontWeight: 400, fontSize: ".8rem" }}>
              <input type="checkbox" style={{ width: "auto", marginRight: 4 }} checked={a.active} onChange={(e) => patchActivity(a.id, { active: e.target.checked })} />
              Active
            </label>
          </div>
        ))}
        <form onSubmit={addActivity} className="row" style={{ gap: ".5rem", marginTop: ".75rem" }}>
          <input value={newActivity.label} onChange={(e) => setNewActivity({ ...newActivity, label: e.target.value })} placeholder="New activity (e.g. Networking)" required style={{ flex: 1 }} />
          <select value={newActivity.category} onChange={(e) => setNewActivity({ ...newActivity, category: e.target.value })} style={{ width: 130 }}>
            <option value="sales">Sales</option>
            <option value="non_sales">Non-sales</option>
          </select>
          <button className="btn small">Add</button>
        </form>
      </Card>

      <Card>
        <h3>Ego badge tiers</h3>
        <p className="muted" style={{ fontSize: ".8rem" }}>
          Award tiers by % of objective attained (year + month). Set the thresholds; the highest tier an advisor reaches shows on their profile.
        </p>
        {badgeData?.badgeTiers.map((b) => (
          <div key={b.id} className="row" style={{ padding: "6px 0", gap: ".5rem", borderBottom: "1px solid var(--color-border)" }}>
            <span style={{ width: 14, height: 14, borderRadius: "50%", background: b.color ?? "#00c2cf", flex: "0 0 auto" }} />
            <input defaultValue={b.label} onBlur={(e) => e.target.value !== b.label && patchBadge(b.id, { label: e.target.value })} style={{ flex: 1 }} />
            <label style={{ display: "inline-flex", alignItems: "center", gap: 4, fontWeight: 400, fontSize: ".8rem", margin: 0 }}>
              ≥
              <input type="number" defaultValue={Number(b.minPercent)} onBlur={(e) => Number(e.target.value) !== Number(b.minPercent) && patchBadge(b.id, { min_percent: Number(e.target.value) })} style={{ width: 70, height: 30, padding: "0 .4rem" }} />
              %
            </label>
            <button className="btn small ghost" onClick={() => delBadge(b.id)}><Icon name="x" size={14} /></button>
          </div>
        ))}
        <form onSubmit={addBadge} className="row" style={{ gap: ".5rem", marginTop: ".75rem" }}>
          <input value={newBadge.label} onChange={(e) => setNewBadge({ ...newBadge, label: e.target.value })} placeholder="Tier name (e.g. Legend)" required style={{ flex: 1 }} />
          <input type="number" value={newBadge.min_percent} onChange={(e) => setNewBadge({ ...newBadge, min_percent: e.target.value })} placeholder="min %" style={{ width: 90 }} />
          <button className="btn small">Add</button>
        </form>
      </Card>

      <Card>
        <h3>Status stages</h3>
        <p className="muted" style={{ fontSize: ".8rem" }}>
          Renaming a stage's label is safe — existing records keep working. The conversion flag (not the name) triggers
          a sale.
        </p>
        {stagesData?.stages.map((s) => (
          <div key={s.id} style={{ padding: "6px 0", borderBottom: "1px solid var(--color-border)" }}>
            <div className="row">
              <input
                defaultValue={s.label}
                onBlur={(e) => e.target.value !== s.label && patchStage(s.id, { label: e.target.value })}
                style={{ maxWidth: 200 }}
              />
              <div style={{ display: "flex", gap: 6 }}>
                {s.isConversion && <StatusBadge label="won" kind="success" />}
                {s.isTerminal && <StatusBadge label="terminal" />}
              </div>
            </div>
            <div className="row" style={{ justifyContent: "flex-start", gap: ".75rem", marginTop: 4 }}>
              <label style={{ fontWeight: 400, fontSize: ".8rem" }}>
                <input type="checkbox" style={{ width: "auto", marginRight: 4 }} checked={s.isConversion} onChange={(e) => patchStage(s.id, { is_conversion: e.target.checked })} />
                Conversion
              </label>
              <label style={{ fontWeight: 400, fontSize: ".8rem" }}>
                <input type="checkbox" style={{ width: "auto", marginRight: 4 }} checked={s.isTerminal} onChange={(e) => patchStage(s.id, { is_terminal: e.target.checked })} />
                Terminal
              </label>
              <label style={{ fontWeight: 400, fontSize: ".8rem", display: "inline-flex", alignItems: "center", gap: 4 }}>
                Win %
                <input
                  type="number"
                  min={0}
                  max={100}
                  defaultValue={s.winProbability}
                  onBlur={(e) => Number(e.target.value) !== s.winProbability && patchStage(s.id, { win_probability: Number(e.target.value) })}
                  style={{ width: 64, height: 30, padding: "0 .4rem" }}
                />
              </label>
              <label style={{ fontWeight: 400, fontSize: ".8rem" }}>
                <input type="checkbox" style={{ width: "auto", marginRight: 4 }} checked={s.active} onChange={(e) => patchStage(s.id, { active: e.target.checked })} />
                Active
              </label>
            </div>
          </div>
        ))}
        <form onSubmit={addStage} style={{ marginTop: ".75rem" }}>
          <div className="row" style={{ gap: ".5rem" }}>
            <input value={newStage.label} onChange={(e) => setNewStage({ ...newStage, label: e.target.value, key: e.target.value })} placeholder="New stage label" required />
            <button className="btn small">Add</button>
          </div>
        </form>
      </Card>
    </div>
  );
}
