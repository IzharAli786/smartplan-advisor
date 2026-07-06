import { useState, type FormEvent } from "react";
import { useApi } from "../hooks/useApi.ts";
import { api, ApiError } from "../api/client.ts";
import { Card, ErrorBanner, StatusBadge } from "./ui.tsx";
import { Icon } from "./Icon.tsx";
import { money } from "../lib/format.ts";
import type { SmartPlanTransaction } from "../api/types.ts";

function datePart(iso: string) {
  return new Date(iso).toLocaleDateString("en-US");
}
function timePart(iso: string) {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

const emptyAdd = { stripe_transaction_id: "", product: "", amount: "", status: "active", occurred_at: new Date().toISOString().slice(0, 16) };

/** Smart Plan (Stripe + manual) transactions for one advisor, with a filter bar. */
export default function SmartPlanTransactions({ advisorId }: { advisorId: string }) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const query = new URLSearchParams({ advisorId });
  if (q) query.set("q", q);
  if (status) query.set("status", status);
  if (from) query.set("from", from);
  if (to) query.set("to", to);
  const { data, reload } = useApi<{ transactions: SmartPlanTransaction[] }>(`/api/smartplan-transactions?${query.toString()}`, [advisorId, q, status, from, to]);
  const txns = data?.transactions ?? [];

  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(emptyAdd);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/smartplan-transactions", {
        advisor_id: advisorId,
        stripe_transaction_id: form.stripe_transaction_id || undefined,
        product: form.product || undefined,
        amount: Number(form.amount) || 0,
        status: form.status,
        occurred_at: form.occurred_at ? new Date(form.occurred_at).toISOString() : undefined,
      });
      setForm({ ...emptyAdd, occurred_at: new Date().toISOString().slice(0, 16) });
      setShowAdd(false);
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not add transaction");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm("Delete this transaction?")) return;
    await api.delete(`/api/smartplan-transactions/${id}`);
    reload();
  }

  const total = txns.reduce((s, t) => s + Number(t.amount), 0);

  return (
    <Card>
      <div className="row">
        <h3 style={{ display: "flex", alignItems: "center", gap: ".4rem" }}>
          <Icon name="commission" size={17} /> Smart Plan Transactions
        </h3>
        <button className="btn small" onClick={() => setShowAdd((v) => !v)}>
          <Icon name="plus" size={15} /> Add manual
        </button>
      </div>

      {/* Filter bar */}
      <div className="row" style={{ gap: ".5rem", flexWrap: "wrap", alignItems: "flex-end", marginTop: ".5rem" }}>
        <div className="field" style={{ margin: 0, flex: 2, minWidth: 160, position: "relative" }}>
          <input placeholder="Search Stripe # or product…" value={q} onChange={(e) => setQ(e.target.value)} style={{ paddingLeft: "2.1rem" }} />
          <span style={{ position: "absolute", left: ".6rem", top: "9px", color: "var(--color-text-muted)" }}><Icon name="search" size={16} /></span>
        </div>
        <div className="field" style={{ margin: 0, width: 130 }}>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>
        <div className="field" style={{ margin: 0, width: 150 }}><label style={{ fontSize: ".7rem" }}>From</label><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div className="field" style={{ margin: 0, width: 150 }}><label style={{ fontSize: ".7rem" }}>To</label><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        {(q || status || from || to) && <button className="btn small ghost" onClick={() => { setQ(""); setStatus(""); setFrom(""); setTo(""); }}><Icon name="x" size={14} /> Clear</button>}
      </div>

      <ErrorBanner message={error} />

      {showAdd && (
        <form onSubmit={add} className="row" style={{ gap: ".5rem", flexWrap: "wrap", alignItems: "flex-end", marginTop: ".75rem", padding: ".75rem", background: "var(--color-surface-2)", borderRadius: 8 }}>
          <div className="field" style={{ margin: 0, width: 200 }}><label style={{ fontSize: ".7rem" }}>Date &amp; time</label><input type="datetime-local" value={form.occurred_at} onChange={(e) => setForm({ ...form, occurred_at: e.target.value })} required /></div>
          <div className="field" style={{ margin: 0, flex: 1, minWidth: 130 }}><label style={{ fontSize: ".7rem" }}>Product</label><input value={form.product} onChange={(e) => setForm({ ...form, product: e.target.value })} placeholder="Smart Plan…" /></div>
          <div className="field" style={{ margin: 0, width: 110 }}><label style={{ fontSize: ".7rem" }}>Amount</label><input type="number" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="$" required /></div>
          <div className="field" style={{ margin: 0, width: 130 }}><label style={{ fontSize: ".7rem" }}>Stripe #</label><input value={form.stripe_transaction_id} onChange={(e) => setForm({ ...form, stripe_transaction_id: e.target.value })} placeholder="optional" /></div>
          <div className="field" style={{ margin: 0, width: 120 }}><label style={{ fontSize: ".7rem" }}>Status</label><select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}><option value="active">Active</option><option value="inactive">Inactive</option></select></div>
          <button className="btn small" disabled={busy}>{busy ? "Saving…" : "Add"}</button>
        </form>
      )}

      {txns.length === 0 ? (
        <div className="muted" style={{ fontSize: ".85rem", marginTop: ".75rem" }}>No transactions{q || status || from || to ? " match the filter" : " yet — they'll appear here from Stripe, or add one manually"}.</div>
      ) : (
        <div className="scroll-x" style={{ marginTop: ".75rem" }}>
          <table className="grid-table">
            <thead>
              <tr>
                <th>Date</th><th>Time</th><th>Stripe #</th><th>Product</th><th style={{ textAlign: "right" }}>Amount</th><th>Status</th><th></th>
              </tr>
            </thead>
            <tbody>
              {txns.map((t) => (
                <tr key={t.id}>
                  <td>{datePart(t.occurredAt)}</td>
                  <td className="muted">{timePart(t.occurredAt)}</td>
                  <td className="muted" style={{ fontFamily: "monospace", fontSize: ".8rem" }}>
                    {t.stripeTransactionId ?? "—"}
                    {t.source === "manual" && <span className="badge" style={{ marginLeft: 4, fontSize: ".6rem" }}>manual</span>}
                  </td>
                  <td>{t.product ?? "—"}</td>
                  <td style={{ textAlign: "right", fontWeight: 600 }}>{money(Number(t.amount))}</td>
                  <td><StatusBadge label={t.status} kind={t.status === "active" ? "success" : "overdue"} /></td>
                  <td><button className="btn small ghost" onClick={() => remove(t.id)}><Icon name="x" size={13} /></button></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={4} className="muted">{txns.length} shown</td>
                <td style={{ textAlign: "right", fontWeight: 700 }}>{money(total)}</td>
                <td colSpan={2}></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </Card>
  );
}
