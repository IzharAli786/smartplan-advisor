import { useRef, useState } from "react";
import { api, ApiError } from "../api/client.ts";
import { useBranding } from "../branding/BrandingContext.tsx";
import { Card, ErrorBanner, PageHead } from "../components/ui.tsx";
import { Icon } from "../components/Icon.tsx";

type Variant = "light" | "dark";

export default function BrandingPage() {
  const { lightLogoUrl, darkLogoUrl, refresh } = useBranding();
  const [busy, setBusy] = useState<Variant | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function upload(variant: Variant, file: File) {
    setBusy(variant);
    setError(null);
    setMsg(null);
    try {
      const fd = new FormData();
      fd.set("file", file);
      await api.upload(`/api/settings/branding?variant=${variant}`, fd);
      await refresh();
      setMsg(variant === "dark" ? "Dark-mode logo updated." : "Light-mode logo updated.");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Upload failed");
    } finally {
      setBusy(null);
    }
  }

  async function reset(variant: Variant) {
    setBusy(variant);
    setError(null);
    setMsg(null);
    try {
      await api.delete(`/api/settings/branding?variant=${variant}`);
      await refresh();
      setMsg("Reverted to the default SmartPlan logo.");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not reset");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <PageHead title="Branding" subtitle="Upload a logo for light mode and one for dark mode" />
      <ErrorBanner message={error} />
      {msg && <div className="success-banner">{msg}</div>}

      <LogoSection
        title="Light-mode logo"
        hint="Shown on light backgrounds — the sign-in screen and the app in light mode. Use your full-colour / dark logo here."
        previewBg="#ffffff"
        previewBorder
        currentUrl={lightLogoUrl}
        busy={busy === "light"}
        onUpload={(f) => upload("light", f)}
        onReset={() => reset("light")}
      />

      <LogoSection
        title="Dark-mode logo"
        hint="Shown on dark backgrounds — the navy sidebar and the app in dark mode. Use a white / light or transparent logo here."
        previewBg="var(--navy)"
        currentUrl={darkLogoUrl}
        busy={busy === "dark"}
        onUpload={(f) => upload("dark", f)}
        onReset={() => reset("dark")}
      />
    </div>
  );
}

function LogoSection({
  title,
  hint,
  previewBg,
  previewBorder,
  currentUrl,
  busy,
  onUpload,
  onReset,
}: {
  title: string;
  hint: string;
  previewBg: string;
  previewBorder?: boolean;
  currentUrl: string | null;
  busy: boolean;
  onUpload: (f: File) => void;
  onReset: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <Card>
      <h3>{title}</h3>
      <p className="muted" style={{ marginBottom: "1rem" }}>
        {hint} PNG, JPG, SVG, WEBP or GIF, up to 5MB.
      </p>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: previewBg,
          border: previewBorder ? "1px solid var(--color-border)" : "none",
          borderRadius: "var(--radius-sm)",
          padding: "1.5rem",
          marginBottom: "1rem",
          minHeight: 96,
        }}
      >
        <img src={currentUrl ?? "/icon.svg"} alt="Current logo" style={{ maxHeight: 56, maxWidth: 240, objectFit: "contain" }} />
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/svg+xml,image/webp,image/gif"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onUpload(f);
          e.target.value = "";
        }}
      />
      <div className="row" style={{ justifyContent: "flex-start", gap: ".5rem" }}>
        <button className="btn" disabled={busy} onClick={() => fileRef.current?.click()}>
          <Icon name="image" size={16} /> {busy ? "Uploading…" : currentUrl ? "Replace" : "Upload"}
        </button>
        {currentUrl && (
          <button className="btn secondary" disabled={busy} onClick={onReset}>
            Reset to default
          </button>
        )}
      </div>
    </Card>
  );
}
