"use client";

import dynamic from "next/dynamic";

/**
 * The player shell is client-only (Web Audio, IndexedDB, OPFS — none of it
 * exists during prerender). Route protection happens in the proxy.
 *
 * Optional catch-all: every in-app address (/albums, /album/…, /stats/history)
 * reloads into the same shell, which reads the view from the URL (lib/urlSync).
 */
const MusicVaultApp = dynamic(() => import("../../components/MusicVaultApp"), {
  ssr: false,
  loading: () => (
    <div className="h-screen flex items-center justify-center text-sm text-[var(--color-text-muted)]">
      Loading Music Vault…
    </div>
  ),
});

export default function HomePage() {
  return <MusicVaultApp />;
}
