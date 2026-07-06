import { useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { api, ApiError } from "../api/client.ts";
import { useApi } from "../hooks/useApi.ts";
import { useStages, useProducts } from "../hooks/useSettings.ts";
import { AgeIndicator, Card, ErrorBanner, Spinner, StatusBadge } from "../components/ui.tsx";
import { Icon } from "../components/Icon.tsx";
import ActivityTimeline from "../components/ActivityTimeline.tsx";
import JourneyStepper from "../components/JourneyStepper.tsx";
import EmailComposer from "../components/EmailComposer.tsx";
import { PhoneInput } from "../components/PhoneInput.tsx";
import { useAuth } from "../auth/AuthContext.tsx";
import { dateShort, dateTimeShort, money, relativeDue } from "../lib/format.ts";
import { quoteBadge } from "../lib/quote.ts";
import type { Communication, Opportunity, OpportunityProductLine, Quote } from "../api/types.ts";

const COMM_KIND_LABEL: Record<string, string> = { quote: "Quote", email: "Email", invite: "Invite", reset: "Password reset", other: "Email" };

export default function OpportunityDetailPage() {
  const { id } = useParams();
  const location = useLocation() as { state?: { warning?: string | null } };
  const { data, loading, error, reload } = useApi<{ opportunity: Opportunity; productLines: OpportunityProductLine[] }>(
    id ? `/api/opportunities/${id}` : null,
  );
  const { data: stagesData } = useStages();
  const { data: quotesData } = useApi<{ quotes: Quote[] }>(id ? `/api/quotes?opportunityId=${id}` : null, [id]);
  const { data: commsData } = useApi<{ communications: Communication[] }>(id ? `/api/opportunities/${id}/communications` : null, [id]);
  const [warning, setWarning] = useState<string | null>(location.state?.warning ?? null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dealValue, setDealValue] = useState("");
  const [showConvert, setShowConvert] = useState(false);
  const [reviewDate, setReviewDate] = useState("");
  const [reviewNotes, setReviewNotes] = useState("");
  const [reviewSaved, setReviewSaved] = useState(false);
  const [composing, setComposing] = useState(false);
  const [editContact, setEditContact] = useState(false);
  const [contactForm, setContactForm] = useState({ name: "", cell: "", email: "" });
  const [editProducts, setEditProducts] = useState(false);
  const [lines, setLines] = useState<{ product: string; technicians: string }[]>([]);
  const [stateVal, setStateVal] = useState("");
  const [followUp, setFollowUp] = useState("");
  const { user } = useAuth();
  const { data: productsData } = useProducts();
  const products = (productsData?.products ?? []).filter((p) => p.active);
  const priceOf = (label: string) => Number(products.find((p) => p.label === label)?.defaultPrice ?? 0);

  const opp = data?.opportunity;
  const productLines = data?.productLines ?? [];

  useEffect(() => {
    setReviewDate(opp?.nextReviewAt ? opp.nextReviewAt.slice(0, 10) : "");
    setReviewNotes(opp?.reviewNotes ?? "");
  }, [opp?.nextReviewAt, opp?.reviewNotes]);
  const stages = (stagesData?.stages ?? []).filter((s) => s.active);
  const conversionStage = (stagesData?.stages ?? []).find((s) => s.isConversion);

  useEffect(() => {
    if (opp?.opportunityValue != null) setDealValue(String(opp.opportunityValue));
  }, [opp?.opportunityValue]);

  if (loading) return <Spinner />;
  if (!opp) return <ErrorBanner message={error ?? "Not found"} />;

  async function changeStatus(status: string) {
    if (!opp) return;
    setBusy(true);
    setActionError(null);
    try {
      await api.patch(`/api/opportunities/${opp.id}`, { status });
      reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not update");
    } finally {
      setBusy(false);
    }
  }

  async function convert() {
    if (!opp) return;
    setBusy(true);
    setActionError(null);
    try {
      await api.post(`/api/opportunities/${opp.id}/convert`, { deal_value: Number(dealValue || 0) });
      setShowConvert(false);
      reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not convert");
    } finally {
      setBusy(false);
    }
  }

  async function saveReview() {
    if (!opp) return;
    setBusy(true);
    setActionError(null);
    setReviewSaved(false);
    try {
      await api.patch(`/api/opportunities/${opp.id}`, {
        next_review_at: reviewDate ? new Date(reviewDate).toISOString() : null,
        review_notes: reviewNotes,
      });
      setReviewSaved(true);
      reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not save review");
    } finally {
      setBusy(false);
    }
  }

  function startEditContact() {
    if (!opp) return;
    setContactForm({ name: opp.contactName ?? "", cell: opp.contactCell ?? "", email: opp.contactEmail ?? "" });
    setEditContact(true);
    setActionError(null);
  }
  async function saveContact() {
    if (!opp) return;
    setBusy(true);
    setActionError(null);
    try {
      await api.patch(`/api/opportunities/${opp.id}`, {
        contact_name: contactForm.name,
        contact_cell: contactForm.cell,
        contact_email: contactForm.email,
      });
      setEditContact(false);
      reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not save contact");
    } finally {
      setBusy(false);
    }
  }

  function startEditProducts() {
    if (!opp) return;
    setLines(
      productLines.length
        ? productLines.map((l) => ({ product: l.product, technicians: String(l.technicians) }))
        : [{ product: opp.product ?? "", technicians: String(opp.numTechnicians ?? 1) }],
    );
    setStateVal(opp.state);
    setFollowUp(opp.followUpAt ? opp.followUpAt.slice(0, 10) : "");
    setEditProducts(true);
    setActionError(null);
  }
  async function saveProducts() {
    if (!opp) return;
    const product_lines = lines
      .filter((l) => l.product)
      .map((l) => ({ product: l.product, technicians: Math.max(1, Number(l.technicians) || 1) }));
    if (product_lines.length === 0) {
      setActionError("Add at least one product.");
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      const patch: Record<string, unknown> = { product_lines, state: stateVal };
      if (followUp) patch.follow_up_at = new Date(followUp).toISOString();
      await api.patch(`/api/opportunities/${opp.id}`, patch);
      setEditProducts(false);
      reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not save products");
    } finally {
      setBusy(false);
    }
  }

  const editLineAmount = (l: { product: string; technicians: string }) => priceOf(l.product) * (Number(l.technicians) || 0);
  const editDealValue = lines.reduce((s, l) => s + (l.product ? editLineAmount(l) : 0), 0);

  const currentStage = stages.find((s) => s.key === opp.status);
  const isWon = currentStage?.isConversion;
  const reviewOverdue = opp.nextReviewAt != null && new Date(opp.nextReviewAt) < new Date();

  return (
    <div className="stack">
      <Link to="/pipeline" className="muted" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
        <Icon name="chevron-left" size={16} /> Pipeline
      </Link>
      <h1 style={{ marginBottom: ".25rem" }}>{opp.contractorCompanyName}</h1>
      <div className="row" style={{ justifyContent: "flex-start", gap: ".5rem", marginBottom: ".25rem" }}>
        <span className="muted" style={{ fontSize: ".8rem" }}>Logged {dateShort(opp.createdAt)}</span>
        <AgeIndicator since={opp.createdAt} />
      </div>
      {warning && (
        <div className="warn-banner" onClick={() => setWarning(null)}>
          {warning}
        </div>
      )}
      <ErrorBanner message={actionError} />

      {/* Graphical journey stages (configurable in Settings) */}
      <JourneyStepper opportunityId={opp.id} />

      {/* Next step (deterministic engine, §8.1) */}
      {opp.nextStep && !isWon && (
        <Card>
          <div className="row">
            <div>
              <div className="muted" style={{ fontSize: ".75rem" }}>
                NEXT STEP
              </div>
              <strong>{opp.nextStep}</strong>
            </div>
            <StatusBadge label={relativeDue(opp.nextStepDue)} kind={opp.nextStepDue && new Date(opp.nextStepDue) < new Date() ? "overdue" : undefined} />
          </div>
        </Card>
      )}

      <Card>
        <div className="field">
          <label>Status</label>
          <select value={opp.status} onChange={(e) => changeStatus(e.target.value)} disabled={busy}>
            {stages.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        {conversionStage && !isWon && (
          <button className="btn success full" onClick={() => setShowConvert((v) => !v)}>
            <Icon name="trophy" size={16} /> Mark as {conversionStage.label}
          </button>
        )}
        {isWon && <div className="success-banner">Converted · {money(opp.opportunityValue)}</div>}
        {showConvert && (
          <div className="stack" style={{ marginTop: ".75rem" }}>
            <div className="field">
              <label>Final deal value ($)</label>
              <input type="number" inputMode="decimal" value={dealValue} onChange={(e) => setDealValue(e.target.value)} />
            </div>
            <button className="btn success full" onClick={convert} disabled={busy}>
              Confirm conversion
            </button>
          </div>
        )}
      </Card>

      <Card>
        <div className="row">
          <h3>Products</h3>
          {!editProducts && (
            <button className="btn small secondary" onClick={startEditProducts}><Icon name="edit" size={14} /> Edit</button>
          )}
        </div>

        {editProducts ? (
          <>
            {lines.map((l, idx) => (
              <div key={idx} className="row" style={{ gap: ".5rem", alignItems: "flex-end", marginTop: ".5rem" }}>
                <div className="field" style={{ flex: 2, margin: 0 }}>
                  {idx === 0 && <label>Product</label>}
                  <select value={l.product} onChange={(e) => setLines((ls) => ls.map((x, i) => (i === idx ? { ...x, product: e.target.value } : x)))}>
                    <option value="">Select…</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.label}>
                        {p.label}{p.defaultPrice != null ? ` — ${money(Number(p.defaultPrice))}/tech` : ""}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field" style={{ width: 90, margin: 0 }}>
                  {idx === 0 && <label># Techs</label>}
                  <input type="number" min={1} value={l.technicians} onChange={(e) => setLines((ls) => ls.map((x, i) => (i === idx ? { ...x, technicians: e.target.value } : x)))} />
                </div>
                <div className="field" style={{ width: 92, margin: 0, textAlign: "right" }}>
                  {idx === 0 && <label>Amount</label>}
                  <div style={{ padding: ".55rem 0", fontWeight: 600 }}>{l.product ? money(editLineAmount(l)) : "—"}</div>
                </div>
                <button type="button" className="btn small ghost" disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((_, i) => i !== idx))} style={{ marginBottom: 2 }}>
                  <Icon name="x" size={15} />
                </button>
              </div>
            ))}
            <button type="button" className="btn small secondary" style={{ marginTop: ".6rem" }} onClick={() => setLines((ls) => [...ls, { product: "", technicians: "1" }])}>
              <Icon name="plus" size={15} /> Add product
            </button>
            <div className="row" style={{ marginTop: ".75rem", paddingTop: ".6rem", borderTop: "1px solid var(--color-border)" }}>
              <strong>Deal value</strong>
              <strong style={{ color: "var(--brand-blue)" }}>{money(editDealValue)}</strong>
            </div>
            <div className="row" style={{ gap: ".5rem", marginTop: ".6rem" }}>
              <div className="field" style={{ flex: 1, margin: 0 }}>
                <label>State</label>
                <input value={stateVal} onChange={(e) => setStateVal(e.target.value.toUpperCase().slice(0, 2))} maxLength={2} />
              </div>
              <div className="field" style={{ flex: 1, margin: 0 }}>
                <label>Follow-up</label>
                <input type="date" value={followUp} onChange={(e) => setFollowUp(e.target.value)} />
              </div>
            </div>
            <div className="row" style={{ gap: ".5rem", marginTop: ".75rem" }}>
              <button className="btn" onClick={saveProducts} disabled={busy}>{busy ? "Saving…" : "Save"}</button>
              <button className="btn secondary" onClick={() => setEditProducts(false)} disabled={busy}>Cancel</button>
            </div>
          </>
        ) : (
          <>
            {productLines.length > 0 ? (
              <>
                {productLines.map((l) => (
                  <div key={l.id ?? l.product} className="row" style={{ padding: ".35rem 0", borderTop: "1px solid var(--color-border)" }}>
                    <div>
                      <div>{l.product}</div>
                      <div className="muted" style={{ fontSize: ".75rem" }}>{money(l.unitPrice)}/tech × {l.technicians}</div>
                    </div>
                    <strong>{money(l.amount)}</strong>
                  </div>
                ))}
                <div className="row" style={{ padding: ".5rem 0 0", borderTop: "2px solid var(--color-border)", marginTop: ".25rem" }}>
                  <strong>Deal value</strong>
                  <strong style={{ color: "var(--brand-blue)" }}>{money(opp.opportunityValue)}</strong>
                </div>
              </>
            ) : (
              <>
                <div className="row"><span className="muted">Product</span><span>{opp.product ?? "—"}</span></div>
                <div className="row"><span className="muted">Value</span><span>{money(opp.opportunityValue)}</span></div>
              </>
            )}
            <div className="row"><span className="muted">State</span><span>{opp.state}</span></div>
            <div className="row"><span className="muted">Technicians</span><span>{opp.numTechnicians ?? "—"}</span></div>
            <div className="row"><span className="muted">Follow-up</span><span>{dateShort(opp.followUpAt)}</span></div>
          </>
        )}
      </Card>

      {/* Next review date + notes */}
      <Card>
        <div className="row">
          <h3 style={{ display: "flex", alignItems: "center", gap: ".4rem" }}>
            <Icon name="calendar" size={17} /> Next review
          </h3>
          {opp.nextReviewAt && <StatusBadge label={`Due ${dateShort(opp.nextReviewAt)}`} kind={reviewOverdue ? "overdue" : undefined} />}
        </div>
        <div className="field" style={{ marginTop: ".5rem" }}>
          <label>Review date</label>
          <input type="date" value={reviewDate} onChange={(e) => { setReviewDate(e.target.value); setReviewSaved(false); }} />
        </div>
        <div className="field">
          <label>Review notes</label>
          <textarea value={reviewNotes} onChange={(e) => { setReviewNotes(e.target.value); setReviewSaved(false); }} placeholder="What to check / follow up at the next review" />
        </div>
        <button className="btn secondary" onClick={saveReview} disabled={busy}>
          {reviewSaved ? "Saved ✓" : busy ? "Saving…" : "Save review"}
        </button>
      </Card>

      <Card>
        <div className="row">
          <h3>Contact</h3>
          {!editContact && (
            <button className="btn small secondary" onClick={startEditContact}><Icon name="edit" size={14} /> Edit</button>
          )}
        </div>
        {editContact ? (
          <>
            <div className="field"><label>Name</label><input value={contactForm.name} onChange={(e) => setContactForm({ ...contactForm, name: e.target.value })} /></div>
            <div className="row" style={{ gap: ".5rem" }}>
              <div className="field" style={{ flex: 1 }}><label>Cell</label><PhoneInput value={contactForm.cell} onChange={(v) => setContactForm({ ...contactForm, cell: v })} /></div>
              <div className="field" style={{ flex: 1 }}><label>Email</label><input type="email" value={contactForm.email} onChange={(e) => setContactForm({ ...contactForm, email: e.target.value })} /></div>
            </div>
            <div className="row" style={{ gap: ".5rem" }}>
              <button className="btn" onClick={saveContact} disabled={busy}>{busy ? "Saving…" : "Save"}</button>
              <button className="btn secondary" onClick={() => setEditContact(false)} disabled={busy}>Cancel</button>
            </div>
          </>
        ) : (
          <>
            <div className="row"><span className="muted">Name</span><span>{opp.contactName ?? "—"}</span></div>
            <div className="row">
              <span className="muted">Cell</span>
              <span>{opp.contactCell ? <a href={`tel:${opp.contactCell}`}>{opp.contactCell}</a> : "—"}</span>
            </div>
            <div className="row">
              <span className="muted">Email</span>
              <span>{opp.contactEmail ? <a href={`mailto:${opp.contactEmail}`}>{opp.contactEmail}</a> : "—"}</span>
            </div>
            {opp.contactEmail && (
              <button className="btn secondary full" style={{ marginTop: ".75rem" }} onClick={() => setComposing(true)}>
                <Icon name="mail" size={16} /> Email prospect
              </button>
            )}
          </>
        )}
      </Card>

      {composing && opp.contactEmail && (
        <EmailComposer
          to={opp.contactEmail}
          opportunityId={opp.id}
          onClose={() => setComposing(false)}
          onSent={reload}
          ctx={{
            first_name: (opp.contactName ?? "").split(" ")[0] || "there",
            full_name: opp.contactName ?? "",
            company: opp.contractorCompanyName,
            email: opp.contactEmail,
            state: opp.state,
            product: opp.product ?? "",
            advisor_name: user?.fullName ?? "",
            advisor_email: user?.email ?? "",
            advisor_phone: user?.phone ?? "",
          }}
        />
      )}

      {opp.notes && (
        <Card>
          <h3>Notes</h3>
          <p style={{ whiteSpace: "pre-wrap" }}>{opp.notes}</p>
        </Card>
      )}

      {/* Quotes for this opportunity */}
      <Card>
        <div className="row">
          <h3 style={{ display: "flex", alignItems: "center", gap: ".4rem" }}>
            <Icon name="file-text" size={17} /> Quotes
          </h3>
          <Link className="btn small" to={`/quotes/new?opportunityId=${opp.id}`}>
            <Icon name="plus" size={15} /> Create quote
          </Link>
        </div>
        {(quotesData?.quotes ?? []).length === 0 ? (
          <div className="muted" style={{ fontSize: ".85rem", marginTop: ".5rem" }}>No quotes yet — create one to send for e-signature.</div>
        ) : (
          (quotesData?.quotes ?? []).map((qt) => {
            const b = quoteBadge(qt.effectiveStatus);
            return (
              <Link key={qt.id} to={`/quotes/${qt.id}`} style={{ color: "inherit" }}>
                <div className="row" style={{ padding: ".5rem 0", borderTop: "1px solid var(--color-border)" }}>
                  <div>
                    <strong style={{ fontSize: ".9rem" }}>{qt.title}</strong>
                    <div className="muted" style={{ fontSize: ".75rem" }}>{qt.quoteNumber} · {money(qt.total)}</div>
                  </div>
                  <StatusBadge label={b.label} kind={b.kind} />
                </div>
              </Link>
            );
          })
        )}
      </Card>

      {/* Communications log — quotes/emails sent (e.g. via Resend), kept by date & time */}
      {(commsData?.communications ?? []).length > 0 && (
        <Card>
          <h3 style={{ display: "flex", alignItems: "center", gap: ".4rem" }}>
            <Icon name="mail" size={17} /> Communications
          </h3>
          {(commsData?.communications ?? []).map((c) => (
            <div key={c.id} className="row" style={{ padding: ".45rem 0", borderTop: "1px solid var(--color-border)" }}>
              <div>
                <div style={{ fontSize: ".88rem" }}>{c.subject}</div>
                <div className="muted" style={{ fontSize: ".75rem" }}>
                  {COMM_KIND_LABEL[c.kind] ?? c.kind} → {c.toEmail} · {c.provider}
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div className="muted" style={{ fontSize: ".75rem" }}>{dateTimeShort(c.createdAt)}</div>
                {c.status === "failed" && <StatusBadge label="failed" kind="overdue" />}
              </div>
            </div>
          ))}
        </Card>
      )}

      {/* Activity timeline + one-tap call/text/email (auto-logged) */}
      <ActivityTimeline opportunityId={opp.id} contactCell={opp.contactCell} contactEmail={opp.contactEmail} onChange={reload} />

      {/* Collateral one tap from the deal (§4, §7) */}
      <Link className="btn secondary full" to={`/library?product=${encodeURIComponent(opp.product ?? "")}`}>
        <Icon name="library" size={16} /> Collateral for {opp.product ?? "this product"}
      </Link>
    </div>
  );
}
