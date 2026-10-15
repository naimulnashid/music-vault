import { useEffect } from "react";
import { usePlayerStore } from "../store/playerStore";
import { useArtworkUrl } from "../lib/artwork";
import { seekAudio } from "./useAudioEngine";

export function useMediaSession() {
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const duration = usePlayerStore((s) => s.duration);
  const currentTime = usePlayerStore((s) => s.currentTime);
  const artUrl = useArtworkUrl(currentTrack?.id);

  useEffect(() => {
    if (!("mediaSession" in navigator) || !currentTrack) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: currentTrack.title,
      artist: currentTrack.artist,
      album: currentTrack.album,
      artwork: artUrl ? [{ src: artUrl, sizes: "512x512" }] : [],
    });
  }, [currentTrack, artUrl]);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.playbackState = isPlaying ? "playing" : "paused";
  }, [isPlaying]);

  useEffect(() => {
    if (!("mediaSession" in navigator) || !duration) return;
    try {
      navigator.mediaSession.setPositionState({
        duration,
        playbackRate: 1,
        position: Math.min(currentTime, duration),
      });
    } catch {
      // setPositionState can throw if position is momentarily out of range during a track switch.
    }
  }, [duration, currentTime]);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;

    const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
      ["play", () => usePlayerStore.getState().togglePlay()],
      ["pause", () => usePlayerStore.getState().togglePlay()],
      ["previoustrack", () => usePlayerStore.getState().prev()],
      ["nexttrack", () => usePlayerStore.getState().next()],
      [
        "seekto",
        (details) => {
          if (typeof details.seekTime === "number") seekAudio(details.seekTime);
        },
      ],
    ];

    for (const [action, handler] of handlers) {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch {
        // Some actions (e.g. seekto) aren't supported in every browser.
      }
    }

    return () => {
      for (const [action] of handlers) {
        try {
          navigator.mediaSession.setActionHandler(action, null);
        } catch {
          // Ignore.
        }
      }
    };
  }, []);
}
