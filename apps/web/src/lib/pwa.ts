import { useSyncExternalStore } from "react";

/**
 * Progressive web app plumbing: registers public/sw.js (production builds
 * only, so a dev server never serves stale code) and keeps the browser's
 * install offer, which Chromium hands out once as `beforeinstallprompt`, for
 * the account menu's "Install app" item.
 */

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let offer: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
let started = false;

export function startPwa(): void {
  if (started || typeof window === "undefined") return;
  started = true;

  window.addEventListener("beforeinstallprompt", (e) => {
    // Keep the offer for our own button instead of the browser's mini-infobar.
    e.preventDefault();
    offer = e as InstallPromptEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    offer = null;
    notify();
  });

  if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .catch((err) => console.error("[pwa] service worker registration failed:", err));
  }
}

/** Whether the browser currently offers to install the app. */
export function useCanInstall(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => offer !== null,
    () => false,
  );
}

/** Shows the browser's install dialog; the offer is single-use either way. */
export async function installApp(): Promise<void> {
  const current = offer;
  if (!current) return;
  offer = null;
  notify();
  await current.prompt();
  await current.userChoice.catch(() => undefined);
}
