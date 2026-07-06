import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, ApiError } from "../api/client.ts";
import { useApi } from "../hooks/useApi.ts";
import { Card, ErrorBanner, PageHead, Spinner, StatusBadge } from "../components/ui.tsx";
import { Icon } from "../components/Icon.tsx";
import { money, dateShort, dateTimeShort } from "../lib/format.ts";
import { quoteBadge } from "../lib/quote.ts";
import { exportQuotePdf } from "../lib/export.ts";
import type { QuoteDetail } from "../api/types.ts";

export default function QuoteDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data, loading, error, reload } = useApi<QuoteDetail>(id ? `/api/quotes/${id}` : null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  if (loading) return <Spinner />;
  if (!data) return <ErrorBanner message={error ?? "Quote not found"} />;
  const { quote: q, lineItems, company, publicUrl } = data;
  const badge = quoteBadge(q.effectiveStatus);
  const isDraft = q.status === "draft";

  async function action(fn: () => Promise<void>) {
    setBusy(true);
    setActionError(null);
    setMsg(null);
    try {
      await fn();
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  const send = () => action(async () => { await api.post(`/api/quotes/${id}/send`); setMsg("Quote sent to the customer."); reload(); });
  const del = () => action(async () => { await api.delete(`/api/quotes/${id}`); navigate("/quotes"); });
  const copyLink = () => action(async () => {
    const url = publicUrl?.startsWith("http") ? publicUrl : `${window.location.origin}${publicUrl}`;
    await navigator.clipboard?.writeText(url);
    setMsg("Customer link copied to clipboard.");
  });
  const downloadPdf = () =>
    exportQuotePdf({
      quoteNumber: q.quoteNumber,
      title: q.title,
      company,
      lineItems,
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

  const steps = [
    { label: "Created", at: q.createdAt },
    { label: "Sent", at: q.sentAt },
    { label: "Viewed", at: q.viewedAt },
    { label: q.status === "declined" ? "Declined" : "Signed", at: q.status === "declined" ? q.declinedAt : q.signedAt },
  ];

  return (
    <div>
      <Link to="/quotes" className="muted" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
        <Icon name="chevron-left" size={16} /> Quotes
      </Link>
      <PageHead
        title={q.title}
        subtitle={`${q.quoteNumber} · ${company}`}
        actions={<StatusBadge label={badge.label} kind={badge.kind} />}
      />
      {msg && <div className="success-banner">{msg}</div>}
      <ErrorBanner message={actionError} />

      {/* Actions */}
      <Card>
        <div className="row" style={{ gap: ".5rem", justifyContent: "flex-start", flexWrap: "wrap" }}>
          {isDraft && (
            <>
              <button className="btn" disabled={busy} onClick={send}><Icon name="mail" size={16} /> Send to customer</button>
              <Link className="btn secondary" to={`/quotes/${id}/edit`}><Icon name="edit" size={16} /> Edit</Link>
              <button className="btn danger" disabled={busy} onClick={del}><Icon name="x" size={16} /> Delete</button>
            </>
          )}
          {!isDraft && publicUrl && (
            <>
              <a className="btn secondary" href={publicUrl} target="_blank" rel="noreferrer"><Icon name="external-link" size={16} /> View as customer</a>
              <button className="btn secondary" disabled={busy} onClick={copyLink}><Icon name="link" size={16} /> Copy link</button>
              {q.status !== "signed" && <button className="btn secondary" disabled={busy} onClick={send}><Icon name="mail" size={16} /> Resend</button>}
            </>
          )}
          <button className="btn secondary" onClick={downloadPdf}><Icon name="download" size={16} /> PDF</button>
        </div>
      </Card>

      {/* Status timeline */}
      <Card>
        <h3>Status</h3>
        <div className="row" style={{ gap: ".5rem", flexWrap: "wrap", marginTop: ".5rem" }}>
          {steps.map((s) => (
            <div key={s.label} style={{ flex: 1, minWidth: 120, opacity: s.at ? 1 : 0.4 }}>
              <div className="muted" style={{ fontSize: ".7rem", textTransform: "uppercase", letterSpacing: ".04em" }}>{s.label}</div>
              <div style={{ fontSize: ".85rem" }}>{s.at ? dateTimeShort(s.at) : "—"}</div>
            </div>
          ))}
        </div>
        {q.signerName && q.signedAt && (
          <div className="success-banner" style={{ marginTop: ".75rem", marginBottom: 0 }}>
            <Icon name="check-circle" size={15} /> Signed by <strong>&nbsp;{q.signerName}&nbsp;</strong> on {dateShort(q.signedAt)}
          </div>
        )}
        {q.validUntil && <div className="muted" style={{ fontSize: ".78rem", marginTop: ".6rem" }}>Valid until {dateShort(q.validUntil)}</div>}
      </Card>

      {/* Line items */}
      <Card>
        <div className="scroll-x">
          <table>
            <thead>
              <tr><th>Item</th><th className="num">Qty</th><th className="num">Unit</th><th className="num">Amount</th></tr>
            </thead>
            <tbody>
              {lineItems.map((l, i) => (
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
          <div className="row" style={{ fontWeight: 700, fontSize: "1.1rem", marginTop: 4 }}><span>Total</span><span>{money(q.total)}</span></div>
        </div>
      </Card>

      {q.notes && (
        <Card>
          <h3>Terms</h3>
          <p className="muted" style={{ whiteSpace: "pre-wrap" }}>{q.notes}</p>
        </Card>
      )}
    </div>
  );
}
