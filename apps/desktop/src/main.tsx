// Must run before any store reads localStorage: see lib/freshStart.ts.
import './lib/freshStart'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import '@fontsource-variable/figtree'
import './index.css'
import App from './App.tsx'
import { initPaths } from './lib/paths'
import { useAuthStore } from './store/authStore'
import { useDownloadStore } from './store/downloadStore'
import { useMirrorStore } from './store/mirrorStore'

// The mini player window shares this bundle but boots a minimal remote-control
// UI: no auth/sync/download initialization — the main window (hidden while mini
// is open) keeps owning all of that.
const isMini = getCurrentWebviewWindow().label === 'mini'

if (isMini) {
  void Promise.all([import('./components/MiniPlayer'), initPaths()]).then(([{ MiniPlayer }]) => {
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <MiniPlayer />
      </StrictMode>,
    )
  })
} else {
  // Dev-only automation hook: lets end-to-end checks drive the stores through
  // the WebView2 remote-debugging protocol. Stripped from production builds.
  if (import.meta.env.DEV) {
    void Promise.all([
      import('./store/libraryStore'),
      import('./store/playerStore'),
      import('./store/settingsStore'),
      import('./hooks/useAudioEngine'),
    ]).then(([library, player, settings, engine]) => {
      (window as unknown as Record<string, unknown>).__mvStores = {
        library: library.useLibraryStore,
        player: player.usePlayerStore,
        settings: settings.useSettingsStore,
        seekAudio: engine.seekAudio,
      }
    })
  }

  // The sync store subscribes to auth state changes — import it before the
  // session restore below so a restored session starts the engine.
  void import('./store/syncStore').then(() => {
    // Restore the Supabase session without blocking paint.
    useAuthStore.getState().init()
  })

  // Download progress events + the cache index for the Downloads view.
  void useDownloadStore.getState().init()

  // The library mirror runs after library changes once sync has pulled.
  void useMirrorStore.getState().init()

  // Resolve app directories (artwork cache) before first paint so album art
  // URLs can be built synchronously during render.
  void initPaths().finally(() => {
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <App />
      </StrictMode>,
    )
    // Startup profile: script eval → first render handed to React. The
    // library-loaded mark is logged from App once tracks arrive.
    performance.mark('mv:render')
    console.info(`[startup] first render at ${Math.round(performance.now())}ms`)
  })
}
