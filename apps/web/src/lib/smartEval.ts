import { evaluateSmartRules, type RuleTrackInput, type SmartRules } from "@musicvault/core";
import type { Track } from "../types";

interface HistoryData {
  playCounts: Record<string, number>;
  lastPlayedAt: Record<string, number>;
}

function toRuleInput(track: Track, history: HistoryData): RuleTrackInput {
  return {
    id: track.id,
    title: track.title,
    artist: track.artist,
    album: track.album,
    genre: track.genre,
    language: track.language,
    country: track.country,
    year: track.year,
    duration: track.duration,
    playCount: history.playCounts[track.id] ?? 0,
    addedAt: track.addedAt,
    lastPlayedAt: history.lastPlayedAt[track.id],
    favorite: Boolean(track.favorite),
  };
}

/** Run a smart playlist's rules against the library, returning full tracks in rule order. */
export function evaluateSmartPlaylist(rules: SmartRules, tracks: Track[], history: HistoryData): Track[] {
  const ids = evaluateSmartRules(rules, tracks.map((t) => toRuleInput(t, history)), Date.now());
  const byId = new Map(tracks.map((t) => [t.id, t]));
  return ids.map((id) => byId.get(id)).filter((t): t is Track => Boolean(t));
}
