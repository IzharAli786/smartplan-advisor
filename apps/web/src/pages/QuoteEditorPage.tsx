import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, ApiError } from "../api/client.ts";
import { useApi } from "../hooks/useApi.ts";
import { useProducts } from "../hooks/useSettings.ts";
import { Card, ErrorBanner, PageHead, Spinner } from "../components/ui.tsx";
import { Icon } from "../components/Icon.tsx";
import { money } from "../lib/format.ts";
import type { QuoteDetail, Contact } from "../api/types.ts";

interface Line {
  product: string;
  description: string;
  quantity: string;
  unitPrice: string;
}

const blankLine = (): Line => ({ product: "", description: "", quantity: "1", unitPrice: "" });

export default function QuoteEditorPage() {
  const { id } = useParams();
  const isEdit = !!id;
  const [params] = useSearchParams();
  const opportunityId = params.get("opportunityId") ?? "";
  const navigate = useNavigate();
  const { data: productsData } = useProducts();
  const products = (productsData?.products ?? []).filter((p) => p.active);
  const { data: contactsData } = useApi<{ contacts: Contact[] }>("/api/contacts");
  const contacts = contactsData?.contacts ?? [];

  const [loaded, setLoaded] = useState(!isEdit);
  const [title, setTitle] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [notes, setNotes] = useState("");
  const [discount, setDiscount] = useState("0");
  const [taxRate, setTaxRate] = useState("0");
  const [lines, setLines] = useState<Line[]>([blankLine()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isEdit) return;
    api
      .get<QuoteDetail>(`/api/quotes/${id}`)
      .then((d) => {
        if (d.quote.status !== "draft") {
          navigate(`/quotes/${id}`, { replace: true });
          return;
        }
        setTitle(d.quote.title);
        setContactName(d.quote.contactName ?? "");
        setContactEmail(d.quote.contactEmail ?? "");
        setValidUntil(d.quote.validUntil ?? "");
        setNotes(d.quote.notes ?? "");
        setDiscount(String(d.quote.discount));
        setTaxRate(String(d.quote.taxRate));
        setLines(
          d.lineItems.length
            ? d.lineItems.map((l) => ({ product: l.product ?? "", description: l.description ?? "", quantity: String(l.quantity), unitPrice: String(l.unitPrice) }))
            : [blankLine()],
        );
        setLoaded(true);
      })
      .catch(() => setError("Could not load quote"));
  }, [id, isEdit, navigate]);

  function setLine(i: number, patch: Partial<Line>) {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }
  function onPickProduct(i: number, label: string) {
    const p = products.find((x) => x.label === label);
    const patch: Partial<Line> = { product: label };
    // Selecting a product auto-applies its catalog price (set by Tom in Settings).
    if (p && p.defaultPrice != null) patch.unitPrice = String(Number(p.defaultPrice));
    setLine(i, patch);
  }

  const num = (s: string) => Number(s || 0);
  const subtotal = lines.reduce((s, l) => s + num(l.quantity) * num(l.unitPrice), 0);
  const taxAmount = ((subtotal - num(discount)) * num(taxRate)) / 100;
  const total = subtotal - num(discount) + taxAmount;

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        title,
        contact_name: contactName,
        contact_email: contactEmail,
        notes,
        discount: num(discount),
        tax_rate: num(taxRate),
        line_items: lines
          .filter((l) => l.product || l.description || num(l.unitPrice) > 0)
          .map((l) => ({ product: l.product, description: l.description, quantity: num(l.quantity), unit_price: num(l.unitPrice) })),
      };
      if (validUntil) payload.valid_until = validUntil;
      let quoteId = id;
      if (isEdit) {
        await api.patch(`/api/quotes/${id}`, payload);
      } else {
        payload.opportunity_id = opportunityId;
        const res = await api.post<{ quote: { id: string } }>("/api/quotes", payload);
        quoteId = res.quote.id;
      }
      navigate(`/quotes/${quoteId}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save quote");
    } finally {
      setBusy(false);
    }
  }

  if (!isEdit && !opportunityId) {
    return (
      <div>
        <PageHead title="New quote" />
        <ErrorBanner message="Start a quote from an opportunity (open one and tap “Create quote”)." />
      </div>
    );
  }
  if (!loaded) return <Spinner />;

  return (
    <div>
      <PageHead title={isEdit ? "Edit quote" : "New quote"} subtitle="Build a branded proposal from your product list" />
      <ErrorBanner message={error} />
      <form onSubmit={save}>
        <Card>
          <div className="field">
            <label>Title *</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. SmartPlan rollout — Acme HVAC" required />
          </div>
          <div className="field">
            <label>Customer (from your Address Book)</label>
            <select
              value=""
              onChange={(e) => {
                const c = contacts.find((x) => x.id === e.target.value);
                if (c) {
                  setContactName(c.name);
                  if (c.email) setContactEmail(c.email);
                }
              }}
            >
              <option value="">{contacts.length ? "Choose a contact…" : "No contacts yet — add them in the Address Book"}</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.company ? ` — ${c.company}` : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="row" style={{ gap: ".5rem" }}>
            <div className="field" style={{ flex: 1 }}>
              <label>Contact name</label>
              <input value={contactName} onChange={(e) => setContactName(e.target.value)} />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label>Contact email</label>
              <input type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} placeholder="Where to send the quote" />
            </div>
          </div>
        </Card>

        <Card>
          <h3>Line items</h3>
          {lines.map((l, i) => (
            <div key={i} className="row" style={{ gap: ".5rem", alignItems: "flex-end", marginBottom: ".5rem", flexWrap: "wrap" }}>
              <div className="field" style={{ flex: 2, marginBottom: 0, minWidth: 160 }}>
                <label>Product</label>
                <select value={l.product} onChange={(e) => onPickProduct(i, e.target.value)}>
                  <option value="">Custom / none</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.label}>
                      {p.label}
                      {p.defaultPrice != null ? ` — ${money(Number(p.defaultPrice))}` : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field" style={{ flex: 2, marginBottom: 0, minWidth: 140 }}>
                <label>Description</label>
                <input value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} />
              </div>
              <div className="field" style={{ width: 70, marginBottom: 0 }}>
                <label>Qty</label>
                <input type="number" value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} />
              </div>
              <div className="field" style={{ width: 110, marginBottom: 0 }}>
                <label>Unit price</label>
                <input type="number" value={l.unitPrice} onChange={(e) => setLine(i, { unitPrice: e.target.value })} />
              </div>
              <div style={{ width: 90, textAlign: "right", paddingBottom: 8 }}>{money(num(l.quantity) * num(l.unitPrice))}</div>
              <button type="button" className="btn small ghost" onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))} style={{ paddingBottom: 8 }}>
                <Icon name="x" size={15} />
              </button>
            </div>
          ))}
          <button type="button" className="btn small secondary" onClick={() => setLines((ls) => [...ls, blankLine()])}>
            <Icon name="plus" size={15} /> Add line
          </button>
        </Card>

        <Card>
          <div className="row" style={{ gap: ".5rem" }}>
            <div className="field" style={{ flex: 1 }}>
              <label>Discount ($)</label>
              <input type="number" value={discount} onChange={(e) => setDiscount(e.target.value)} />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label>Tax rate (%)</label>
              <input type="number" value={taxRate} onChange={(e) => setTaxRate(e.target.value)} />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label>Valid until</label>
              <input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
            </div>
          </div>
          <div className="field">
            <label>Terms / message</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Payment terms, scope notes, a short message to the customer…" />
          </div>
          <div style={{ borderTop: "1px solid var(--color-border)", paddingTop: ".75rem" }}>
            <div className="row"><span className="muted">Subtotal</span><span>{money(subtotal)}</span></div>
            {num(discount) > 0 && <div className="row"><span className="muted">Discount</span><span>-{money(num(discount))}</span></div>}
            {num(taxRate) > 0 && <div className="row"><span className="muted">Tax ({num(taxRate)}%)</span><span>{money(taxAmount)}</span></div>}
            <div className="row" style={{ fontWeight: 700, fontSize: "1.1rem", marginTop: 4 }}><span>Total</span><span>{money(total)}</span></div>
          </div>
        </Card>

        <button className="btn full" disabled={busy}>{busy ? "Saving…" : isEdit ? "Save changes" : "Create quote"}</button>
      </form>
    </div>
  );
}
