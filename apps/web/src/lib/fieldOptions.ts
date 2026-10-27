import { splitNames } from "@musicvault/core";
import { useLibraryStore } from "../store/libraryStore";

export type OptionField =
  | "title"
  | "artist"
  | "featured_artists"
  | "album"
  | "genre"
  | "subgenre"
  | "secondary_genres"
  | "mood"
  | "vocals"
  | "language"
  | "country";

type Lists = Record<OptionField, string[]>;

// Every form field asks for its list; one pass per library snapshot serves them all.
const cache = new WeakMap<object, Lists>();

function build(tracks: ReturnType<typeof useLibraryStore.getState>["tracks"]): Lists {
  const sets: Record<OptionField, Set<string>> = {
    title: new Set(),
    artist: new Set(),
    featured_artists: new Set(),
    album: new Set(),
    genre: new Set(),
    subgenre: new Set(),
    secondary_genres: new Set(),
    mood: new Set(),
    vocals: new Set(),
    language: new Set(),
    country: new Set(),
  };
  for (const t of tracks) {
    if (t.title) sets.title.add(t.title);
    if (t.artist !== "Unknown Artist") for (const name of splitNames(t.artist)) sets.artist.add(name);
    if (t.album && t.album !== "Unknown Album") sets.album.add(t.album);
    for (const name of splitNames(t.genre)) sets.genre.add(name);
    // Guest artists are artists too: either field suggests from both.
    for (const name of splitNames(t.featuredArtists)) {
      sets.featured_artists.add(name);
      sets.artist.add(name);
    }
    for (const name of splitNames(t.artist)) if (t.artist !== "Unknown Artist") sets.featured_artists.add(name);
    if (t.subgenre) sets.subgenre.add(t.subgenre);
    for (const name of splitNames(t.secondaryGenres)) sets.secondary_genres.add(name);
    for (const name of splitNames(t.mood)) sets.mood.add(name);
    if (t.vocals) sets.vocals.add(t.vocals);
    for (const name of splitNames(t.language)) sets.language.add(name);
    for (const name of splitNames(t.country)) sets.country.add(name);
  }
  const sorted = (s: Set<string>) => [...s].sort((a, b) => a.localeCompare(b));
  return {
    title: sorted(sets.title),
    artist: sorted(sets.artist),
    featured_artists: sorted(sets.featured_artists),
    album: sorted(sets.album),
    genre: sorted(sets.genre),
    subgenre: sorted(sets.subgenre),
    secondary_genres: sorted(sets.secondary_genres),
    mood: sorted(sets.mood),
    vocals: sorted(sets.vocals),
    language: sorted(sets.language),
    country: sorted(sets.country),
  };
}

/** Distinct values of a field across the library, sorted; artists, genres, languages and countries split at commas. */
export function useFieldOptions(field: OptionField): string[] {
  const tracks = useLibraryStore((s) => s.tracks);
  let lists = cache.get(tracks);
  if (!lists) {
    lists = build(tracks);
    cache.set(tracks, lists);
  }
  return lists[field];
}

/** How each field's suggestions behave: short lists show everything, long ones show matches. */
export const OPTION_MODE: Record<OptionField, { show: "all" | "matches"; multi: boolean }> = {
  title: { show: "matches", multi: false },
  artist: { show: "matches", multi: true },
  featured_artists: { show: "matches", multi: true },
  album: { show: "matches", multi: false },
  genre: { show: "matches", multi: true },
  subgenre: { show: "matches", multi: false },
  secondary_genres: { show: "matches", multi: true },
  mood: { show: "all", multi: true },
  vocals: { show: "all", multi: false },
  language: { show: "all", multi: true },
  country: { show: "all", multi: true },
};
