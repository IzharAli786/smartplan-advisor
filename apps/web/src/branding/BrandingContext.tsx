import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "../api/client.ts";
import { useAuth } from "../auth/AuthContext.tsx";

interface BrandingState {
  /** Logo for light backgrounds (light mode, login). */
  lightLogoUrl: string | null;
  /** Logo for dark backgrounds (the navy sidebar, dark mode). */
  darkLogoUrl: string | null;
  refresh: () => Promise<void>;
}

const BrandingCtx = createContext<BrandingState>({ lightLogoUrl: null, darkLogoUrl: null, refresh: async () => {} });

export function BrandingProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [lightLogoUrl, setLight] = useState<string | null>(null);
  const [darkLogoUrl, setDark] = useState<string | null>(null);

  async function refresh() {
    try {
      const b = await api.get<{ lightLogoUrl: string | null; darkLogoUrl: string | null }>("/api/branding");
      setLight(b.lightLogoUrl);
      setDark(b.darkLogoUrl);
    } catch {
      setLight(null);
      setDark(null);
    }
  }

  // Branding is per-org, so re-fetch whenever the signed-in user (and thus org) changes.
  useEffect(() => {
    refresh();
  }, [user?.id]);

  return <BrandingCtx.Provider value={{ lightLogoUrl, darkLogoUrl, refresh }}>{children}</BrandingCtx.Provider>;
}

export function useBranding(): BrandingState {
  return useContext(BrandingCtx);
}
