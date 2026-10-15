import { useEffect } from "react";
import { usePlayerStore } from "../store/playerStore";
import { useLibraryStore } from "../store/libraryStore";
import { seekAudio } from "./useAudioEngine";
import { emitMiniState, onMiniCmd, onMiniReady, type MiniState } from "../lib/miniBridge";

/**
 * Main-window side of the mini player: broadcasts now-playing state and
 * executes commands the mini window sends back. The main window keeps
 * running (hidden) while mini is open, so queue/shuffle/sync logic stays
 * in one place.
 */
export function useMiniBridge() {
  useEffect(() => {
    let disposed = false;
    const unsubs: (() => void)[] = [];
    const track = (p: Promise<() => void>) =>
      void p.then((un) => (disposed ? un() : unsubs.push(un)));

    const send = () => {
      const p = usePlayerStore.getState();
      const t = p.currentTrack;
      const favorite = t
        ? Boolean(useLibraryStore.getState().tracks.find((x) => x.id === t.id)?.favorite)
        : false;
      const state: MiniState = {
        hasTrack: t !== null,
        title: t?.title ?? null,
        artist: t?.artist ?? null,
        artworkPath: t?.artworkPath ?? null,
        playing: p.isPlaying,
        position: p.currentTime,
        duration: p.duration,
        favorite,
      };
      void emitMiniState(state).catch(() => {});
    };

    // Position updates stream every frame; the bridge only needs ~2 Hz.
    let lastSent = 0;
    unsubs.push(
      usePlayerStore.subscribe((s, prev) => {
        if (s.currentTrack !== prev.currentTrack || s.isPlaying !== prev.isPlaying || s.duration !== prev.duration) {
          lastSent = Date.now();
          send();
        } else if (s.currentTime !== prev.currentTime && Date.now() - lastSent > 500) {
          lastSent = Date.now();
          send();
        }
      }),
    );
    // Favorite toggles arrive as a new tracks array.
    unsubs.push(
      useLibraryStore.subscribe((s, prev) => {
        if (s.tracks !== prev.tracks) send();
      }),
    );

    track(onMiniReady(send));
    track(
      onMiniCmd((cmd) => {
        const player = usePlayerStore.getState();
        switch (cmd.action) {
          case "toggle":
            player.togglePlay();
            break;
          case "next":
            player.next();
            break;
          case "prev":
            player.prev();
            break;
          case "seek":
            if (typeof cmd.position === "number") seekAudio(cmd.position);
            break;
          case "favorite": {
            const t = player.currentTrack;
            if (t) void useLibraryStore.getState().toggleFavorite(t.id);
            break;
          }
        }
      }),
    );

    return () => {
      disposed = true;
      unsubs.forEach((un) => un());
    };
  }, []);
}
