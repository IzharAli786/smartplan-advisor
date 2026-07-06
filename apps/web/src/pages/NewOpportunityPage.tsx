import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "../api/client.ts";
import { useProducts } from "../hooks/useSettings.ts";
import { ErrorBanner, PageHead } from "../components/ui.tsx";
import { Icon } from "../components/Icon.tsx";
import { PhoneInput } from "../components/PhoneInput.tsx";
import { money } from "../lib/format.ts";
import type { Opportunity } from "../api/types.ts";

type ScalarField =
  | "contractor_company_name"
  | "state"
  | "contact_name"
  | "contact_email"
  | "contact_cell"
  | "follow_up_at"
  | "next_review_at"
  | "review_notes"
  | "notes";

type FormState = Record<ScalarField, string>;

interface ProductLine {
  product: string;
  technicians: string;
}

const EMPTY: FormState = {
  contractor_company_name: "",
  state: "",
  contact_name: "",
  contact_email: "",
  contact_cell: "",
  follow_up_at: "",
  next_review_at: "",
  review_notes: "",
  notes: "",
};

/** Voice-extracted draft from ChatGPT. */
interface VoiceResult {
  transcript: string;
  draft: Record<string, string | number>;
}

export default function NewOpportunityPage() {
  const navigate = useNavigate();
  const { data: productsData } = useProducts();
  const products = (productsData?.products ?? []).filter((p) => p.active);
  const priceOf = (label: string) => Number(products.find((p) => p.label === label)?.defaultPrice ?? 0);

  const [form, setForm] = useState<FormState>(EMPTY);
  const [lines, setLines] = useState<ProductLine[]>([{ product: "", technicians: "1" }]);
  const [aiFields, setAiFields] = useState<Set<ScalarField>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // ── Voice capture ──
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [recording, setRecording] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    api
      .get<{ enabled: boolean }>("/api/opportunities/voice-status")
      .then((d) => setVoiceEnabled(d.enabled))
      .catch(() => setVoiceEnabled(false));
  }, []);

  function set(key: ScalarField, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
    setAiFields((s) => {
      if (!s.has(key)) return s;
      const next = new Set(s);
      next.delete(key);
      return next;
    });
  }

  // ── Product lines ──
  const pricedLines = lines.map((l) => ({ ...l, amount: priceOf(l.product) * (Number(l.technicians) || 0) }));
  const dealValue = pricedLines.reduce((s, l) => s + (l.product ? l.amount : 0), 0);

  function setLine(idx: number, patch: Partial<ProductLine>) {
    setLines((ls) => ls.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }
  function addLine() {
    setLines((ls) => [...ls, { product: "", technicians: "1" }]);
  }
  function removeLine(idx: number) {
    setLines((ls) => (ls.length === 1 ? ls : ls.filter((_, i) => i !== idx)));
  }

  async function startRecording() {
    setVoiceError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setVoiceError("This device/browser can't record audio. Type the details instead.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => e.data.size > 0 && chunksRef.current.push(e.data);
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        void sendAudio(blob);
      };
      recorderRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch {
      setVoiceError("Microphone permission denied. Type the details instead.");
    }
  }

  function stopRecording() {
    recorderRef.current?.stop();
    setRecording(false);
  }

  async function sendAudio(blob: Blob) {
    setProcessing(true);
    setVoiceError(null);
    try {
      const ext = (blob.type.split("/")[1] || "webm").split(";")[0];
      const fd = new FormData();
      fd.set("file", blob, `note.${ext}`);
      const result = await api.upload<VoiceResult>("/api/opportunities/transcribe", fd);
      setTranscript(result.transcript || "(no speech detected)");

      const filled = new Set<ScalarField>();
      setForm((f) => {
        const next = { ...f };
        for (const [k, v] of Object.entries(result.draft)) {
          if (v === undefined || v === null || v === "") continue;
          if (k in next) {
            next[k as ScalarField] = String(v);
            filled.add(k as ScalarField);
          }
        }
        return next;
      });
      setAiFields(filled);
      // Seed a product line from the extracted product + technician count.
      if (result.draft.product) {
        setLines([{ product: String(result.draft.product), technicians: String(result.draft.num_technicians ?? 1) }]);
      }
    } catch (e) {
      setVoiceError(e instanceof ApiError ? e.message : "Couldn't process the voice note");
    } finally {
      setProcessing(false);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setBlocked(null);
    try {
      const product_lines = lines
        .filter((l) => l.product)
        .map((l) => ({ product: l.product, technicians: Math.max(1, Number(l.technicians) || 1) }));
      if (product_lines.length === 0) {
        setError("Add at least one product.");
        setBusy(false);
        return;
      }
      const payload: Record<string, unknown> = {
        contractor_company_name: form.contractor_company_name,
        state: form.state,
        product_lines,
        source: aiFields.size > 0 ? "voice" : "typed",
      };
      if (form.contact_name) payload.contact_name = form.contact_name;
      if (form.contact_email) payload.contact_email = form.contact_email;
      if (form.contact_cell) payload.contact_cell = form.contact_cell;
      if (form.follow_up_at) payload.follow_up_at = new Date(form.follow_up_at).toISOString();
      if (form.next_review_at) payload.next_review_at = new Date(form.next_review_at).toISOString();
      if (form.review_notes) payload.review_notes = form.review_notes;
      if (form.notes) payload.notes = form.notes;

      const res = await api.post<{ opportunity: Opportunity; warning: string | null }>("/api/opportunities", payload);
      navigate(`/opportunity/${res.opportunity.id}`, { state: { warning: res.warning } });
    } catch (err) {
      if (err instanceof ApiError && err.code === "territory_blocked") setBlocked(err.message);
      else setError(err instanceof ApiError ? err.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  function Label({ field, children }: { field: ScalarField; children: string }) {
    return (
      <label>
        {children}
        {aiFields.has(field) && (
          <span className="badge ai" style={{ marginLeft: 6, fontSize: ".62rem", padding: "1px 6px" }}>
            <Icon name="sparkles" size={11} /> AI
          </span>
        )}
      </label>
    );
  }

  if (blocked) {
    return (
      <div>
        <PageHead title="Request sent" />
        <div className="warn-banner">{blocked}</div>
        <p className="muted">
          A manager will review your takeover request. You'll get a notification when it's decided — you don't need to
          re-enter anything.
        </p>
        <button className="btn full" onClick={() => navigate("/")}>
          Back to Today
        </button>
      </div>
    );
  }

  return (
    <div>
      <PageHead title="New Opportunity" subtitle="Type it in, or record a voice note and let AI fill the form" />

      {/* Voice capture (§6.2) */}
      <div className="card" style={{ borderColor: "var(--insight-border)", background: "var(--color-primary-soft)" }}>
        <div className="row" style={{ justifyContent: "flex-start", gap: ".75rem" }}>
          <span className="icon-tile" style={{ background: "#fff" }}>
            <Icon name="sparkles" size={20} />
          </span>
          <div style={{ flex: 1 }}>
            <strong>Voice capture</strong>
            <div className="muted" style={{ fontSize: ".8rem" }}>
              {!voiceEnabled
                ? "Add an OpenAI API key on the server to enable AI voice capture."
                : recording
                  ? "Listening… describe the company, contact, products and technicians."
                  : processing
                    ? "Transcribing with AI…"
                    : "Record a quick note — ChatGPT fills the form for you to review."}
            </div>
          </div>
          {recording ? (
            <button type="button" className="btn danger" onClick={stopRecording}>
              <Icon name="x" size={16} /> Stop
            </button>
          ) : (
            <button type="button" className="btn" disabled={!voiceEnabled || processing} onClick={startRecording}>
              <Icon name="phone" size={16} /> {processing ? "Working…" : "Record"}
            </button>
          )}
        </div>
        {voiceError && <div className="error-banner" style={{ marginTop: ".75rem", marginBottom: 0 }}>{voiceError}</div>}
      </div>

      {transcript && (
        <details style={{ marginBottom: "1rem" }}>
          <summary className="muted" style={{ cursor: "pointer" }}>What I heard</summary>
          <p className="muted" style={{ marginTop: ".4rem", whiteSpace: "pre-wrap" }}>{transcript}</p>
        </details>
      )}

      <ErrorBanner message={error} />
      <form onSubmit={onSubmit}>
        <div className="field">
          <Label field="contractor_company_name">Company *</Label>
          <input
            value={form.contractor_company_name}
            onChange={(e) => set("contractor_company_name", e.target.value)}
            placeholder="e.g. Acme Mechanical"
            required
            autoFocus
          />
        </div>

        <div className="field">
          <Label field="state">State *</Label>
          <input
            value={form.state}
            onChange={(e) => set("state", e.target.value.toUpperCase().slice(0, 2))}
            placeholder="CO"
            maxLength={2}
            required
            style={{ maxWidth: 120 }}
          />
        </div>

        {/* Products + technicians → auto deal value */}
        <div className="card" style={{ padding: "1rem" }}>
          <div className="row">
            <strong>Products</strong>
            <span className="muted" style={{ fontSize: ".78rem" }}>Price × technicians</span>
          </div>
          {pricedLines.map((l, idx) => (
            <div key={idx} className="row" style={{ gap: ".5rem", alignItems: "flex-end", marginTop: ".5rem" }}>
              <div className="field" style={{ flex: 2, margin: 0 }}>
                {idx === 0 && <label>Product</label>}
                <select value={l.product} onChange={(e) => setLine(idx, { product: e.target.value })}>
                  <option value="">Select…</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.label}>
                      {p.label}
                      {p.defaultPrice != null ? ` — ${money(Number(p.defaultPrice))}/tech` : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field" style={{ width: 96, margin: 0 }}>
                {idx === 0 && <label># Techs</label>}
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={l.technicians}
                  onChange={(e) => setLine(idx, { technicians: e.target.value })}
                />
              </div>
              <div className="field" style={{ width: 100, margin: 0, textAlign: "right" }}>
                {idx === 0 && <label>Amount</label>}
                <div style={{ padding: ".55rem 0", fontWeight: 600 }}>{l.product ? money(l.amount) : "—"}</div>
              </div>
              <button
                type="button"
                className="btn small ghost"
                onClick={() => removeLine(idx)}
                disabled={lines.length === 1}
                aria-label="Remove product"
                style={{ marginBottom: 2 }}
              >
                <Icon name="x" size={15} />
              </button>
            </div>
          ))}
          <button type="button" className="btn small secondary" onClick={addLine} style={{ marginTop: ".6rem" }}>
            <Icon name="plus" size={15} /> Add product
          </button>
          <div className="row" style={{ marginTop: ".85rem", paddingTop: ".75rem", borderTop: "1px solid var(--color-border)" }}>
            <strong>Deal value</strong>
            <strong style={{ fontSize: "1.15rem", color: "var(--brand-blue)" }}>{money(dealValue)}</strong>
          </div>
        </div>

        <div className="field">
          <Label field="contact_name">Contact name</Label>
          <input value={form.contact_name} onChange={(e) => set("contact_name", e.target.value)} />
        </div>
        <div className="row" style={{ gap: ".5rem" }}>
          <div className="field" style={{ flex: 1 }}>
            <Label field="contact_cell">Cell</Label>
            <PhoneInput value={form.contact_cell} onChange={(v) => set("contact_cell", v)} />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <Label field="contact_email">Email</Label>
            <input type="email" value={form.contact_email} onChange={(e) => set("contact_email", e.target.value)} />
          </div>
        </div>

        <div className="row" style={{ gap: ".5rem" }}>
          <div className="field" style={{ flex: 1 }}>
            <Label field="follow_up_at">Follow-up date</Label>
            <input type="date" value={form.follow_up_at} onChange={(e) => set("follow_up_at", e.target.value)} />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <Label field="next_review_at">Next review date</Label>
            <input type="date" value={form.next_review_at} onChange={(e) => set("next_review_at", e.target.value)} />
          </div>
        </div>

        <div className="field">
          <Label field="review_notes">Review notes</Label>
          <textarea value={form.review_notes} onChange={(e) => set("review_notes", e.target.value)} placeholder="What to check at the next review" />
        </div>

        <div className="field">
          <Label field="notes">Notes</Label>
          <textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} />
        </div>

        <button className="btn full" disabled={busy}>
          {busy ? "Saving…" : "Save opportunity"}
        </button>
      </form>
    </div>
  );
}
