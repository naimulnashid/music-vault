import type { SmartKey } from "@musicvault/core";
import { HOME, useUiStore, type Location } from "../store/uiStore";

/**
 * Keeps the address bar in step with the page being shown, so a view can be
 * bookmarked, reloaded or shared, and the browser's Back/Forward walk the same
 * stack as the app's Back button. The app stays one client page: URLs are
 * written with history.pushState (which Next.js integrates with instead of
 * navigating), and app/[[...view]] serves every such URL on reload.
 */

const enc = encodeURIComponent;

export function pathOf(l: Location): string {
  switch (l.mainView) {
    case "albums":
      return "/albums";
    case "album":
      return l.activeAlbumKey ? `/album/${enc(l.activeAlbumKey)}` : "/albums";
    case "artist":
      return l.activeArtist ? `/artist/${enc(l.activeArtist)}` : "/";
    case "playlist":
      return l.activePlaylistId ? `/playlist/${enc(l.activePlaylistId)}` : "/";
    case "smart":
      if (!l.smartKey) return "/";
      return l.activeGroup ? `/smart/${l.smartKey}/${enc(l.activeGroup)}` : `/smart/${l.smartKey}`;
    case "stats":
      return "/stats";
    case "recap":
      return "/stats/recap";
    case "heatmap":
      return "/stats/history";
    case "downloads":
      return "/downloads";
    case "search":
      return "/search";
    default:
      return "/";
  }
}

/** The location a path names, or HOME for anything unknown. */
export function locationFromPath(path: string): Location {
  const [first, second, third] = path
    .split("/")
    .filter(Boolean)
    .map((part) => {
      try {
        return decodeURIComponent(part);
      } catch {
        return part;
      }
    });
  switch (first) {
    case "albums":
      return { ...HOME, mainView: "albums" };
    case "album":
      return second ? { ...HOME, mainView: "album", activeAlbumKey: second } : { ...HOME, mainView: "albums" };
    case "artist":
      return second ? { ...HOME, mainView: "artist", activeArtist: second } : HOME;
    case "playlist":
      return second ? { ...HOME, mainView: "playlist", activePlaylistId: second } : HOME;
    case "smart":
      return second
        ? { ...HOME, mainView: "smart", smartKey: second as SmartKey, activeGroup: third ?? null }
        : HOME;
    case "stats":
      return {
        ...HOME,
        mainView: second === "recap" ? "recap" : second === "history" ? "heatmap" : "stats",
      };
    case "downloads":
      return { ...HOME, mainView: "downloads" };
    case "search":
      return { ...HOME, mainView: "search" };
    default:
      return HOME;
  }
}

const locationOf = (s: Location): Location => ({
  mainView: s.mainView,
  activePlaylistId: s.activePlaylistId,
  smartKey: s.smartKey,
  activeGroup: s.activeGroup,
  activeAlbumKey: s.activeAlbumKey,
  activeArtist: s.activeArtist,
});

let started = false;

export function startUrlSync(): void {
  if (started || typeof window === "undefined") return;
  started = true;

  // Each entry we write carries its position, so popstate can tell Back from Forward.
  let index = 0;
  let applying = false;
  // Open the page the address names (a reload or a shared link); an unknown
  // address is rewritten to the page actually shown.
  const initial = locationFromPath(window.location.pathname);
  const canonical = pathOf(initial);
  window.history.replaceState(
    { ...window.history.state, mvIndex: index },
    "",
    canonical === window.location.pathname ? undefined : canonical + window.location.search,
  );
  if (pathOf(initial) !== "/") {
    applying = true;
    useUiStore.setState(initial);
    applying = false;
  }

  useUiStore.subscribe((s, prev) => {
    if (applying) return;
    const path = pathOf(s);
    if (path === pathOf(prev) || path === window.location.pathname) return;
    index += 1;
    window.history.pushState({ mvIndex: index }, "", path);
  });

  window.addEventListener("popstate", (e) => {
    const target = typeof e.state?.mvIndex === "number" ? (e.state.mvIndex as number) : 0;
    const ui = useUiStore.getState();
    const current = locationOf(ui);
    const next = locationFromPath(window.location.pathname);
    // Mirror the move in the app's own back stack so its Back button stays right.
    const history = target < index ? ui.history.slice(0, -1) : [...ui.history, current].slice(-50);
    index = target;
    applying = true;
    useUiStore.setState({
      ...next,
      history,
      canGoBack: history.length > 0,
      sidebarOpen: false,
      nowPlayingExpanded: false,
    });
    applying = false;
  });

  // The in-app Back button walks the browser history, so both stay in step.
  useUiStore.setState({ goBack: () => window.history.back() });
}
