import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";

/**
 * "Add to Home Screen" prompt for Advise.
 *
 * Two worlds:
 *  - Android / desktop Chrome & Edge fire `beforeinstallprompt` once the PWA is
 *    installable (valid manifest + service worker + not already installed). We
 *    stash the event and drive the native chooser from our own button.
 *  - iOS Safari never fires that event, so we show manual instructions instead
 *    (Share → "Add to Home Screen"). Chrome/Firefox on iOS can't install at all,
 *    so we stay quiet there.
 *
 * The banner never appears when the app is already running standalone, and a
 * dismissal is remembered so we don't nag on every visit.
 */

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISS_KEY = "advise:pwa-install-dismissed";
const DISMISS_DAYS = 14;

/* ── Module-level capture ──────────────────────────────────────
 * `beforeinstallprompt` can fire before React has mounted (it depends on the
 * browser, not our render). Listen at import time — which runs before
 * ReactDOM.render — so the event is never lost to a mounting race. */
let deferredEvent: BeforeInstallPromptEvent | null = null;
const subscribers = new Set<() => void>();
const notify = () => subscribers.forEach((fn) => fn());

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // suppress Chrome's default mini-infobar; we present our own
    deferredEvent = e as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    deferredEvent = null;
    try {
      localStorage.removeItem(DISMISS_KEY);
    } catch {
      /* private mode / storage disabled */
    }
    notify();
  });
}

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // iOS Safari exposes this non-standard flag when launched from the home screen.
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIosSafari(): boolean {
  const ua = window.navigator.userAgent;
  const iOS = /iphone|ipad|ipod/i.test(ua);
  // Real Safari only — Chrome (CriOS), Firefox (FxiOS), Edge (EdgiOS) on iOS
  // can't add to the home screen, so instructions there would just mislead.
  const safari = /safari/i.test(ua) && !/crios|fxios|edgios/i.test(ua);
  return iOS && safari;
}

function recentlyDismissed(): boolean {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return false;
    const when = Number(raw);
    return Number.isFinite(when) && Date.now() - when < DISMISS_DAYS * 24 * 60 * 60 * 1000;
  } catch {
    return false;
  }
}

export default function InstallPrompt() {
  const location = useLocation();
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(deferredEvent);
  const [showIosHint, setShowIosHint] = useState(false);
  const [dismissed, setDismissed] = useState(() => recentlyDismissed());

  useEffect(() => {
    if (isStandalone()) return; // already installed — nothing to offer

    const sync = () => setDeferred(deferredEvent);
    subscribers.add(sync);

    // iOS has no event to wait on — decide up front.
    if (isIosSafari()) setShowIosHint(true);

    return () => {
      subscribers.delete(sync);
    };
  }, []);

  // Never overlay the customer-facing public quote page, and respect standalone/dismissal.
  if (location.pathname.startsWith("/q/")) return null;
  if (dismissed || isStandalone()) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      /* private mode / storage disabled — just hide for this session */
    }
  };

  const install = async () => {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice;
    // A prompt event can only be used once, whatever the user chose.
    deferredEvent = null;
    setDeferred(null);
  };

  if (deferred) {
    return (
      <div className="install-banner" role="region" aria-label="Install Advise">
        <img className="install-icon" src="/pwa-192x192.png" alt="" width={40} height={40} />
        <div className="install-copy">
          <strong>Install Advise</strong>
          <span>Add it to your device for a full-screen, app-like experience.</span>
        </div>
        <div className="install-actions">
          <button className="btn small" onClick={install}>
            Install
          </button>
          <button className="btn small ghost install-x" aria-label="Not now" onClick={dismiss}>
            ✕
          </button>
        </div>
      </div>
    );
  }

  if (showIosHint) {
    return (
      <div className="install-banner" role="region" aria-label="Install Advise">
        <img className="install-icon" src="/apple-touch-icon.png" alt="" width={40} height={40} />
        <div className="install-copy">
          <strong>Install Advise</strong>
          <span>
            Tap the Share icon{" "}
            <svg className="ios-share" viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
              <path
                d="M12 3v11M12 3l-3.5 3.5M12 3l3.5 3.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M6 11H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-1"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>{" "}
            then <strong>Add to Home Screen</strong>.
          </span>
        </div>
        <div className="install-actions">
          <button className="btn small ghost install-x" aria-label="Dismiss" onClick={dismiss}>
            ✕
          </button>
        </div>
      </div>
    );
  }

  return null;
}
