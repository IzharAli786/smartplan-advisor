import { useState, type FormEvent } from "react";
import { useParams } from "react-router-dom";
import { api, ApiError } from "../api/client.ts";
import { useApi } from "../hooks/useApi.ts";
import { Icon } from "../components/Icon.tsx";
import { ErrorBanner, Spinner } from "../components/ui.tsx";
import { money, dateShort } from "../lib/format.ts";
import { exportQuotePdf } from "../lib/export.ts";
import type { PublicQuote } from "../api/types.ts";

export default function PublicQuotePage() {
  const { token } = useParams();
  const { data, loading, error, reload } = useApi<{ quote: PublicQuote }>(token ? `/api/public/quotes/${token}` : null);
  const [signer, setSigner] = useState("");
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [signError, setSignError] = useState<string | null>(null);

  if (loading) return <Spinner />;
  if (!data) {
    return (
      <div className="center-screen">
        <div className="auth-card card stack" style={{ textAlign: "center" }}>
          <Icon name="alert-triangle" size={28} />
          <h2>Quote unavailable</h2>
          <p className="muted">{error ?? "This link is invalid or has expired."}</p>
        </div>
      </div>
    );
  }

  const q = data.quote;
  const signed = q.status === "signed";
  const canSign = q.status === "sent" || q.status === "viewed";

  async function sign(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setSignError(null);
    try {
      await api.post(`/api/public/quotes/${token}/sign`, { signer_name: signer, agree });
      reload();
    } catch (err) {
      setSignError(err instanceof ApiError ? err.message : "Could not sign");
    } finally {
      setBusy(false);
    }
  }

  function pdf() {
    exportQuotePdf({
      quoteNumber: q.quoteNumber,
      title: q.title,
      company: q.company,
      lineItems: q.lineItems,
      subtotal: q.subtotal,
      discount: q.discount,
      taxRate: q.taxRate,
      taxAmount: q.taxAmount,
      total: q.total,
      validUntil: q.validUntil,
      notes: q.notes,
      signerName: q.signerName,
      signedAt: q.signedAt,
    });
  }

  return (
    <div
      style={{
        background: "var(--color-bg)",
        minHeight: "100%",
        padding:
          "calc(1.5rem + var(--safe-top)) calc(1rem + var(--safe-right)) calc(1.5rem + var(--safe-bottom)) calc(1rem + var(--safe-left))",
      }}
    >
      <div style={{ maxWidth: 760, margin: "0 auto" }}>
        <div className="card" style={{ padding: "1.75rem" }}>
          {/* Brand header */}
          <div className="row" style={{ alignItems: "flex-start" }}>
            <div>
              {q.logoUrl ? (
                <img src={q.logoUrl} alt="" style={{ maxHeight: 48, maxWidth: 200, objectFit: "contain" }} />
              ) : (
                <div style={{ fontWeight: 800, fontSize: "1.4rem" }}>
                  <span style={{ color: "var(--brand-blue)" }}>Smart</span>
                  <span style={{ color: "var(--navy)" }}>Plan</span>
                </div>
              )}
              <div className="muted" style={{ marginTop: 4 }}>Quote / Proposal</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontWeight: 700 }}>{q.quoteNumber}</div>
              {q.validUntil && <div className="muted" style={{ fontSize: ".8rem" }}>Valid until {dateShort(q.validUntil)}</div>}
            </div>
          </div>

          <div style={{ marginTop: "1.25rem" }}>
            <div className="muted" style={{ fontSize: ".72rem", textTransform: "uppercase", letterSpacing: ".04em" }}>Prepared for</div>
            <div style={{ fontSize: "1.05rem", fontWeight: 600 }}>{q.company}</div>
            <h1 style={{ marginTop: ".5rem" }}>{q.title}</h1>
            {q.advisor && <div className="muted" style={{ fontSize: ".85rem", marginTop: 4 }}>From {q.advisor.name}{q.advisor.email ? ` · ${q.advisor.email}` : ""}</div>}
          </div>

          {signed && (
            <div className="success-banner" style={{ marginTop: "1rem", marginBottom: 0 }}>
              <Icon name="check-circle" size={15} /> Signed by <strong>&nbsp;{q.signerName}&nbsp;</strong>
              {q.signedAt ? `on ${dateShort(q.signedAt)}` : ""}. Thank you!
            </div>
          )}
          {q.status === "declined" && <div className="warn-banner" style={{ marginTop: "1rem", marginBottom: 0 }}>This quote was declined.</div>}
          {q.status === "expired" && <div className="warn-banner" style={{ marginTop: "1rem", marginBottom: 0 }}>This quote has expired — please contact your advisor for an updated one.</div>}

          {/* Line items */}
          <div className="scroll-x" style={{ marginTop: "1.25rem" }}>
            <table>
              <thead>
                <tr><th>Item</th><th className="num">Qty</th><th className="num">Unit</th><th className="num">Amount</th></tr>
              </thead>
              <tbody>
                {q.lineItems.map((l, i) => (
                  <tr key={i}>
                    <td>{[l.product, l.description].filter(Boolean).join(" — ") || "Item"}</td>
                    <td className="num">{l.quantity}</td>
                    <td className="num">{money(l.unitPrice)}</td>
                    <td className="num">{money(l.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ borderTop: "1px solid var(--color-border)", marginTop: ".75rem", paddingTop: ".75rem" }}>
            <div className="row"><span className="muted">Subtotal</span><span>{money(q.subtotal)}</span></div>
            {q.discount > 0 && <div className="row"><span className="muted">Discount</span><span>-{money(q.discount)}</span></div>}
            {q.taxRate > 0 && <div className="row"><span className="muted">Tax ({q.taxRate}%)</span><span>{money(q.taxAmount)}</span></div>}
            <div className="row" style={{ fontWeight: 700, fontSize: "1.2rem", marginTop: 4 }}><span>Total</span><span>{money(q.total)}</span></div>
          </div>

          {q.notes && (
            <div style={{ marginTop: "1rem" }}>
              <div className="muted" style={{ fontSize: ".72rem", textTransform: "uppercase", letterSpacing: ".04em" }}>Terms</div>
              <p className="muted" style={{ whiteSpace: "pre-wrap", marginTop: 4 }}>{q.notes}</p>
            </div>
          )}

          <div className="row" style={{ marginTop: "1.25rem", justifyContent: "flex-start", gap: ".5rem" }}>
            <button className="btn secondary" onClick={pdf}><Icon name="download" size={16} /> Download PDF</button>
          </div>

          {/* E-signature */}
          {canSign && (
            <div className="card" style={{ marginTop: "1.25rem", background: "var(--color-primary-soft)", borderColor: "var(--insight-border)" }}>
              <h3>Accept &amp; sign</h3>
              <p className="muted" style={{ fontSize: ".82rem" }}>Type your full name to sign electronically. This is a legally binding acceptance.</p>
              <ErrorBanner message={signError} />
              <form onSubmit={sign}>
                <div className="field">
                  <label>Full name</label>
                  <input value={signer} onChange={(e) => setSigner(e.target.value)} placeholder="Your full name" required />
                </div>
                <label style={{ fontWeight: 400, fontSize: ".85rem", display: "flex", gap: 8, alignItems: "flex-start", marginBottom: ".75rem" }}>
                  <input type="checkbox" style={{ width: "auto", marginTop: 3 }} checked={agree} onChange={(e) => setAgree(e.target.checked)} />
                  I agree to the terms above and authorize this quote on behalf of {q.company}.
                </label>
                <button className="btn success full" disabled={busy || !agree || signer.trim().length < 2}>
                  <Icon name="check" size={16} /> {busy ? "Signing…" : "Sign & accept"}
                </button>
              </form>
            </div>
          )}
        </div>
        <div className="muted" style={{ textAlign: "center", fontSize: ".75rem", marginTop: "1rem" }}>Powered by SmartPlan</div>
      </div>
    </div>
  );
}
