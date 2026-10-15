import { useEffect } from "react";
import { usePlayerStore } from "../store/playerStore";
import { onSmtcControl, smtcPlayback, smtcUpdate } from "../lib/ipc";
import { artworkDir } from "../lib/paths";
import { seekAudio } from "./useAudioEngine";

/**
 * Windows System Media Transport Controls bridge — the native replacement for
 * the Media Session API. Pushes metadata/playback state to the Rust side
 * (souvlaki) and dispatches hardware media-key / flyout actions back onto the
 * player store.
 */
export function useSmtc() {
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const duration = usePlayerStore((s) => s.duration);

  useEffect(() => {
    if (!currentTrack) return;
    const dir = artworkDir();
    const artworkAbs = currentTrack.artworkPath && dir ? `${dir}\\${currentTrack.artworkPath}` : null;
    void smtcUpdate(currentTrack.title, currentTrack.artist, currentTrack.album, artworkAbs, duration).catch(
      (err) => console.error("[smtc] update failed:", err),
    );
  }, [currentTrack, duration]);

  useEffect(() => {
    void smtcPlayback(isPlaying, usePlayerStore.getState().currentTime).catch((err) =>
      console.error("[smtc] playback failed:", err),
    );
  }, [isPlaying]);

  // Keep the flyout timeline roughly in sync while playing.
  useEffect(() => {
    if (!isPlaying) return;
    const interval = setInterval(() => {
      void smtcPlayback(true, usePlayerStore.getState().currentTime).catch(() => {});
    }, 1000);
    return () => clearInterval(interval);
  }, [isPlaying]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    void onSmtcControl(({ action, position }) => {
      const player = usePlayerStore.getState();
      switch (action) {
        case "play":
        case "pause":
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
          if (typeof position === "number") seekAudio(position);
          break;
      }
    }).then((un) => {
      if (disposed) un();
      else unlisten = un;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
}
