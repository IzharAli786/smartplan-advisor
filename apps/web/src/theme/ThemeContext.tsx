import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

type Mode = "light" | "dark";
const STORAGE_KEY = "scrm_theme";

interface ThemeState {
  mode: Mode;
  toggle: () => void;
  setMode: (m: Mode) => void;
}

const ThemeCtx = createContext<ThemeState>({ mode: "light", toggle: () => {}, setMode: () => {} });

function initialMode(): Mode {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "light" || stored === "dark") return stored;
  // Fall back to the OS preference.
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<Mode>(() => initialMode());

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", mode);
    localStorage.setItem(STORAGE_KEY, mode);
  }, [mode]);

  const setMode = (m: Mode) => setModeState(m);
  const toggle = () => setModeState((m) => (m === "dark" ? "light" : "dark"));

  return <ThemeCtx.Provider value={{ mode, toggle, setMode }}>{children}</ThemeCtx.Provider>;
}

export function useTheme(): ThemeState {
  return useContext(ThemeCtx);
}
