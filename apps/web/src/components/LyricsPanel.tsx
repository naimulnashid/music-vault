import { useEffect, useMemo, useRef } from "react";
import { usePlayerStore } from "../store/playerStore";
import { seekAudio } from "../hooks/useAudioEngine";
import { findCurrentLineIndex, parseLrc } from "@musicvault/core";
import { PanelHeader } from "./PanelHeader";

/** "[mm:ss.xx]" timestamps: plain lyrics that are really LRC. */
const LRC_TAG = /^\s*\[\d{1,2}:\d{2}(?:[.:]\d{1,3})?\]/m;

/**
 * Lyrics, synced when the song has timestamps. "panel" is the side panel;
 * "stage" is the big, centred version on the Now Playing screen.
 * Clicking a synced line jumps there.
 */
export function LyricsPanel({ variant = "panel" }: { variant?: "panel" | "stage" }) {
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const currentTime = usePlayerStore((s) => s.currentTime);
  const activeLineRef = useRef<HTMLButtonElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const stage = variant === "stage";

  // Synced lyrics, or plain lyrics that turn out to be LRC (pasted into the
  // wrong field) — shown synced rather than with raw timestamps.
  const synced = useMemo(() => {
    if (currentTrack?.lyricsSynced && currentTrack.lyricsSynced.length > 0) return currentTrack.lyricsSynced;
    const text = currentTrack?.lyricsText;
    return text && LRC_TAG.test(text) ? parseLrc(text) : undefined;
  }, [currentTrack?.lyricsSynced, currentTrack?.lyricsText]);
  const activeIndex = synced && synced.length > 0 ? findCurrentLineIndex(synced, currentTime) : -1;

  // Only the lyrics scroll: scrollIntoView would also move the phone-width full player.
  useEffect(() => {
    const body = bodyRef.current;
    const line = activeLineRef.current;
    if (!body || !line) return;
    const offset = line.getBoundingClientRect().top - body.getBoundingClientRect().top;
    body.scrollTo({ top: body.scrollTop + offset - (body.clientHeight - line.offsetHeight) / 2, behavior: "smooth" });
  }, [activeIndex]);

  const body = (
    <div ref={bodyRef} className={`flex-1 overflow-y-auto select-text ${stage ? (synced?.length ? "px-5 py-[22vh]" : "px-5 py-6") : "px-5 py-4"}`}>
      {!currentTrack && <p className="text-sm text-muted">Nothing playing.</p>}

      {currentTrack && synced && synced.length > 0 && (
        <div className={stage ? "space-y-5" : "space-y-3"}>
          {synced.map((line, i) => {
            const active = i === activeIndex;
            const past = i < activeIndex;
            return (
              <button
                key={i}
                ref={active ? activeLineRef : undefined}
                onClick={() => seekAudio(line.time)}
                className={`block w-full text-left transition-[color,opacity,transform] duration-300 origin-left ${
                  stage ? "text-2xl xl:text-3xl font-bold leading-snug" : "text-sm"
                } ${
                  active
                    ? `text-fg ${stage ? "scale-100" : "font-semibold"}`
                    : past
                      ? `text-muted ${stage ? "opacity-40 scale-[0.98]" : "opacity-70"} hover:opacity-100`
                      : `text-muted ${stage ? "opacity-60 scale-[0.98]" : ""} hover:opacity-100`
                }`}
              >
                {line.text || "♪"}
              </button>
            );
          })}
        </div>
      )}

      {currentTrack && (!synced || synced.length === 0) && currentTrack.lyricsText && (
        <pre
          className={`whitespace-pre-wrap font-sans text-muted ${stage ? "text-xl leading-relaxed font-semibold" : "text-sm leading-relaxed"}`}
        >
          {currentTrack.lyricsText}
        </pre>
      )}

      {currentTrack && (!synced || synced.length === 0) && !currentTrack.lyricsText && (
        <div className={`text-muted ${stage ? "text-center py-10" : ""}`}>
          <p className={stage ? "text-lg font-semibold text-fg" : "text-sm"}>No lyrics for this song</p>
          <p className="text-sm mt-1">Add them any time from “Edit details”.</p>
        </div>
      )}
    </div>
  );

  if (stage) return <div className="flex flex-col h-full min-h-0">{body}</div>;
  return (
    <div className="flex flex-col h-full">
      <PanelHeader title="Lyrics" />
      {body}
    </div>
  );
}
