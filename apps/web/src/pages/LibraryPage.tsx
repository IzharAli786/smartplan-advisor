import { useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { useApi } from "../hooks/useApi.ts";
import { useProducts } from "../hooks/useSettings.ts";
import { useAuth } from "../auth/AuthContext.tsx";
import { api, ApiError } from "../api/client.ts";
import { Card, EmptyState, ErrorBanner, PageHead, Spinner, StatusBadge } from "../components/ui.tsx";
import { Icon, type IconName } from "../components/Icon.tsx";
import type { Collateral } from "../api/types.ts";

const TYPE_ICON: Record<Collateral["type"], IconName> = {
  pdf: "file-text",
  slides: "presentation",
  image: "image",
  video: "video",
  link: "link",
};

export default function LibraryPage() {
  const { isManager } = useAuth();
  const [params, setParams] = useSearchParams();
  const product = params.get("product") ?? "";
  const [q, setQ] = useState("");
  const { data: productsData } = useProducts();
  const products = (productsData?.products ?? []).filter((p) => p.active);

  // Managers see hidden items too (so they can manage them); advisors only see active.
  const query = new URLSearchParams();
  if (product) query.set("product", product);
  if (q) query.set("q", q);
  if (isManager) query.set("includeInactive", "true");
  const { data, loading, error, reload } = useApi<{ collateral: Collateral[] }>(
    `/api/collateral?${query.toString()}`,
    [product, q, isManager],
  );

  async function share(c: Collateral) {
    try {
      const { url } = await api.get<{ url: string }>(`/api/collateral/${c.id}/share`);
      const absolute = url.startsWith("http") ? url : `${window.location.origin}${url}`;
      await navigator.clipboard?.writeText(absolute);
      alert("Shareable link copied to clipboard");
    } catch {
      alert("Could not create share link");
    }
  }

  function setProduct(p: string) {
    const next = new URLSearchParams(params);
    if (p) next.set("product", p);
    else next.delete("product");
    setParams(next);
  }

  return (
    <div>
      <PageHead
        title="Library"
        subtitle="Marketing collateral & videos by product"
        actions={isManager ? <ManageActions products={products} reload={reload} /> : undefined}
      />
      <ErrorBanner message={error} />

      <div className="field" style={{ position: "relative" }}>
        <input placeholder="Search by title…" value={q} onChange={(e) => setQ(e.target.value)} style={{ paddingLeft: "2.25rem" }} />
        <span style={{ position: "absolute", left: ".7rem", top: "11px", color: "var(--color-text-muted)" }}>
          <Icon name="search" size={18} />
        </span>
      </div>

      <div className="tabs">
        <button className={`tab ${product === "" ? "active" : ""}`} onClick={() => setProduct("")}>
          All products
        </button>
        {products.map((p) => (
          <button key={p.id} className={`tab ${product === p.label ? "active" : ""}`} onClick={() => setProduct(p.label)}>
            {p.label}
          </button>
        ))}
      </div>

      {loading ? (
        <Spinner />
      ) : !data || data.collateral.length === 0 ? (
        <EmptyState
          icon="library"
          title="No collateral here yet"
          hint={isManager ? "Use “Add to library” to upload files or add a video/link." : product ? `Nothing for ${product} yet.` : "Check back soon."}
        />
      ) : (
        data.collateral.map((c) => (
          <Card key={c.id} className={c.active ? "" : "lib-hidden"}>
            <div className="row" style={{ justifyContent: "flex-start", gap: ".75rem" }}>
              <span className="icon-tile">
                <Icon name={TYPE_ICON[c.type]} size={20} />
              </span>
              <div style={{ flex: 1 }}>
                <div className="row" style={{ justifyContent: "flex-start", gap: ".5rem" }}>
                  <strong>{c.title}</strong>
                  {isManager && !c.active && <StatusBadge label="hidden" kind="overdue" />}
                </div>
                <div className="muted" style={{ fontSize: ".78rem" }}>
                  {c.product}
                </div>
              </div>
            </div>
            {c.description && <p className="muted" style={{ marginTop: 8 }}>{c.description}</p>}
            <div className="row" style={{ marginTop: ".75rem", gap: ".5rem", justifyContent: "flex-start" }}>
              {(c.fileUrl || c.externalUrl) && (
                <a className="btn small" href={c.fileUrl ?? c.externalUrl ?? "#"} target="_blank" rel="noreferrer">
                  <Icon name={c.type === "video" ? "video" : "external-link"} size={15} />
                  {c.type === "video" ? "Watch" : c.type === "link" ? "Open" : "View"}
                </a>
              )}
              <button className="btn small secondary" onClick={() => share(c)}>
                <Icon name="share" size={15} />
                Share
              </button>
              {isManager && <HideToggle c={c} reload={reload} />}
            </div>
          </Card>
        ))
      )}
    </div>
  );
}

function HideToggle({ c, reload }: { c: Collateral; reload: () => void }) {
  const [busy, setBusy] = useState(false);
  async function toggle() {
    setBusy(true);
    try {
      await api.patch(`/api/collateral/${c.id}`, { active: !c.active });
      reload();
    } finally {
      setBusy(false);
    }
  }
  return (
    <button className="btn small ghost" disabled={busy} onClick={toggle}>
      <Icon name={c.active ? "eye-off" : "eye"} size={15} />
      {c.active ? "Hide" : "Show"}
    </button>
  );
}

/** Managerial-only: reveal an inline uploader that adds a file or a video/link to the library. */
function ManageActions({ products, reload }: { products: { id: string; label: string }[]; reload: () => void }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"link" | "file">("link");
  const [form, setForm] = useState({ product: "", title: "", description: "", type: "video", external_url: "" });
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      if (mode === "link") {
        await api.post("/api/collateral", {
          product: form.product,
          title: form.title,
          description: form.description,
          type: form.type,
          external_url: form.external_url,
          sort_order: 0,
        });
      } else {
        if (!file) throw new ApiError(400, "Choose a file");
        const fd = new FormData();
        fd.set("product", form.product);
        fd.set("title", form.title);
        fd.set("description", form.description);
        fd.set("type", form.type);
        fd.set("file", file);
        await api.upload("/api/collateral/upload", fd);
      }
      setForm({ product: "", title: "", description: "", type: mode === "link" ? "video" : "pdf", external_url: "" });
      setFile(null);
      setErr(null);
      reload();
      setOpen(false);
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button className="btn" onClick={() => setOpen(true)}>
        <Icon name="plus" size={16} /> Add to library
      </button>
    );
  }

  return (
    <div className="modal-overlay" onClick={() => setOpen(false)}>
      <div className="modal" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ marginBottom: ".5rem" }}>
          <h3 style={{ margin: 0 }}>Add to library</h3>
          <button className="btn small ghost icon-only" aria-label="Close" onClick={() => setOpen(false)}>
            <Icon name="x" size={16} />
          </button>
        </div>
        <ErrorBanner message={err} />
        <div className="tabs">
          <button className={`tab ${mode === "link" ? "active" : ""}`} onClick={() => { setMode("link"); setForm({ ...form, type: "video" }); }}>
            Video / Link
          </button>
          <button className={`tab ${mode === "file" ? "active" : ""}`} onClick={() => { setMode("file"); setForm({ ...form, type: "pdf" }); }}>
            File upload
          </button>
        </div>
        <form onSubmit={submit}>
          <div className="field">
            <label>Product</label>
            <select value={form.product} onChange={(e) => setForm({ ...form, product: e.target.value })} required>
              <option value="">Select…</option>
              {products.map((p) => (
                <option key={p.id} value={p.label}>{p.label}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Title</label>
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
          </div>
          <div className="field">
            <label>Type</label>
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              {mode === "link" ? (
                <>
                  <option value="video">Video (YouTube/Vimeo)</option>
                  <option value="link">External link</option>
                </>
              ) : (
                <>
                  <option value="pdf">PDF</option>
                  <option value="slides">Slides</option>
                  <option value="image">Image</option>
                </>
              )}
            </select>
          </div>
          {mode === "link" ? (
            <div className="field">
              <label>URL</label>
              <input type="url" value={form.external_url} onChange={(e) => setForm({ ...form, external_url: e.target.value })} required placeholder="https://youtube.com/…" />
            </div>
          ) : (
            <div className="field">
              <label>File</label>
              <input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} required />
            </div>
          )}
          <div className="field">
            <label>Description</label>
            <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          <button className="btn full" disabled={busy}>
            {busy ? "Saving…" : "Add to library"}
          </button>
        </form>
      </div>
    </div>
  );
}
