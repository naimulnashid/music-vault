/**
 * Rule-based smart playlists (Phase 2).
 *
 * The AST is plain JSON so it can be stored in SQLite/Room/Supabase and
 * evaluated by the Kotlin port (`SmartRules.kt`) with identical results.
 * Both engines are verified against the shared golden fixtures in
 * `docs/fixtures/smart-rules.golden.json` — if you change semantics here,
 * update the fixtures and the Kotlin port together.
 */

export type RuleFieldType = "string" | "number" | "date" | "boolean";

export type RuleField =
  | "title"
  | "artist"
  | "album"
  | "genre"
  | "language"
  | "country"
  | "featuredArtists"
  | "subgenre"
  | "secondaryGenres"
  | "mood"
  | "vocals"
  | "year"
  | "duration"
  | "playCount"
  | "addedAt"
  | "lastPlayedAt"
  | "favorite";

export type RuleOp =
  // string
  | "is"
  | "isNot"
  | "contains"
  | "notContains"
  | "startsWith"
  // number
  | "eq"
  | "neq"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "between"
  // date (value = epoch ms; inLast value = days back from `now`)
  | "before"
  | "after"
  | "inLast"
  // presence (strings: non-empty; others: defined)
  | "isSet"
  | "notSet"
  // boolean
  | "isTrue"
  | "isFalse";

export interface RuleCondition {
  field: RuleField;
  op: RuleOp;
  value?: string | number;
  /** Upper bound for `between` (inclusive on both ends). */
  value2?: number;
}

export interface RuleGroup {
  combinator: "and" | "or";
  rules: RuleNode[];
}

export type RuleNode = RuleCondition | RuleGroup;

export type RuleSortKey = Exclude<RuleField, "favorite">;

export interface SmartRules {
  version: 1;
  root: RuleGroup;
  sortBy?: RuleSortKey;
  sortDir?: "asc" | "desc";
  limit?: number;
}

/**
 * Flat, platform-neutral evaluation input. Clients map their Track + play
 * history into this shape (duration in seconds, timestamps in epoch ms).
 */
export interface RuleTrackInput {
  id: string;
  title: string;
  artist: string;
  album: string;
  genre?: string;
  language?: string;
  country?: string;
  featuredArtists?: string;
  subgenre?: string;
  secondaryGenres?: string;
  mood?: string;
  vocals?: string;
  year?: number;
  duration: number;
  playCount: number;
  addedAt: number;
  lastPlayedAt?: number;
  favorite: boolean;
}

export function isRuleGroup(node: RuleNode): node is RuleGroup {
  return "combinator" in node;
}

export const RULE_FIELDS: Record<RuleField, { label: string; type: RuleFieldType }> = {
  title: { label: "Title", type: "string" },
  artist: { label: "Artist", type: "string" },
  album: { label: "Album", type: "string" },
  genre: { label: "Genre", type: "string" },
  language: { label: "Language", type: "string" },
  country: { label: "Country", type: "string" },
  featuredArtists: { label: "Featured artists", type: "string" },
  subgenre: { label: "Subgenre", type: "string" },
  secondaryGenres: { label: "Secondary genres", type: "string" },
  mood: { label: "Mood", type: "string" },
  vocals: { label: "Vocals", type: "string" },
  year: { label: "Year", type: "number" },
  duration: { label: "Duration (seconds)", type: "number" },
  playCount: { label: "Play Count", type: "number" },
  addedAt: { label: "Date Added", type: "date" },
  lastPlayedAt: { label: "Last Played", type: "date" },
  favorite: { label: "Favorite", type: "boolean" },
};

export const RULE_OPS_FOR_TYPE: Record<RuleFieldType, RuleOp[]> = {
  string: ["is", "isNot", "contains", "notContains", "startsWith", "isSet", "notSet"],
  number: ["eq", "neq", "gt", "gte", "lt", "lte", "between", "isSet", "notSet"],
  date: ["before", "after", "inLast", "isSet", "notSet"],
  boolean: ["isTrue", "isFalse"],
};

export const RULE_OP_LABELS: Record<RuleOp, string> = {
  is: "is",
  isNot: "is not",
  contains: "contains",
  notContains: "does not contain",
  startsWith: "starts with",
  eq: "=",
  neq: "≠",
  gt: ">",
  gte: "≥",
  lt: "<",
  lte: "≤",
  between: "between",
  before: "before",
  after: "after",
  inLast: "in the last (days)",
  isSet: "is set",
  notSet: "is not set",
  isTrue: "is on",
  isFalse: "is off",
};

const MS_PER_DAY = 86_400_000;

function stringField(track: RuleTrackInput, field: RuleField): string {
  switch (field) {
    case "title":
      return track.title;
    case "artist":
      return track.artist;
    case "album":
      return track.album;
    case "genre":
      return track.genre ?? "";
    case "language":
      return track.language ?? "";
    case "country":
      return track.country ?? "";
    case "featuredArtists":
      return track.featuredArtists ?? "";
    case "subgenre":
      return track.subgenre ?? "";
    case "secondaryGenres":
      return track.secondaryGenres ?? "";
    case "mood":
      return track.mood ?? "";
    case "vocals":
      return track.vocals ?? "";
    default:
      return "";
  }
}

function numberField(track: RuleTrackInput, field: RuleField): number | undefined {
  switch (field) {
    case "year":
      return track.year;
    case "duration":
      return track.duration;
    case "playCount":
      return track.playCount;
    case "addedAt":
      return track.addedAt;
    case "lastPlayedAt":
      return track.lastPlayedAt;
    default:
      return undefined;
  }
}

/** `playCount eq 0` should match never-played tracks. */
function numberFieldForCompare(track: RuleTrackInput, field: RuleField): number | undefined {
  return numberField(track, field);
}

/**
 * The field's type, or undefined for a field this engine doesn't know — a
 * saved rule may name a retired field (album artist, composer, BPM, track
 * and disc number, rating); such a field is never set and doesn't affect sorting.
 */
function fieldType(field: RuleField): RuleFieldType | undefined {
  return Object.prototype.hasOwnProperty.call(RULE_FIELDS, field) ? RULE_FIELDS[field].type : undefined;
}

function isFieldSet(track: RuleTrackInput, field: RuleField): boolean {
  const type = fieldType(field);
  if (type === undefined) return false;
  if (type === "string") return stringField(track, field) !== "";
  if (type === "boolean") return true;
  return numberField(track, field) !== undefined;
}

export function matchesCondition(cond: RuleCondition, track: RuleTrackInput, now: number): boolean {
  switch (cond.op) {
    case "isSet":
      return isFieldSet(track, cond.field);
    case "notSet":
      return !isFieldSet(track, cond.field);
    case "isTrue":
      return cond.field === "favorite" && track.favorite;
    case "isFalse":
      return cond.field === "favorite" && !track.favorite;

    case "is":
    case "isNot":
    case "contains":
    case "notContains":
    case "startsWith": {
      const field = stringField(track, cond.field).toLowerCase();
      const value = String(cond.value ?? "").toLowerCase();
      switch (cond.op) {
        case "is":
          return field === value;
        case "isNot":
          return field !== value;
        case "contains":
          return field.includes(value);
        case "notContains":
          return !field.includes(value);
        case "startsWith":
          return field.startsWith(value);
      }
      return false;
    }

    case "eq":
    case "neq":
    case "gt":
    case "gte":
    case "lt":
    case "lte":
    case "between": {
      const field = numberFieldForCompare(track, cond.field);
      if (field === undefined) return false;
      const value = Number(cond.value ?? 0);
      switch (cond.op) {
        case "eq":
          return field === value;
        case "neq":
          return field !== value;
        case "gt":
          return field > value;
        case "gte":
          return field >= value;
        case "lt":
          return field < value;
        case "lte":
          return field <= value;
        case "between":
          return field >= value && field <= Number(cond.value2 ?? value);
      }
      return false;
    }

    case "before":
    case "after":
    case "inLast": {
      const field = numberField(track, cond.field);
      if (field === undefined) return false;
      const value = Number(cond.value ?? 0);
      switch (cond.op) {
        case "before":
          return field < value;
        case "after":
          return field > value;
        case "inLast":
          return field >= now - value * MS_PER_DAY;
      }
      return false;
    }
  }
  return false;
}

export function matchesGroup(group: RuleGroup, track: RuleTrackInput, now: number): boolean {
  // An empty group matches everything (a freshly created playlist lists all tracks).
  if (group.rules.length === 0) return true;
  const test = (node: RuleNode) =>
    isRuleGroup(node) ? matchesGroup(node, track, now) : matchesCondition(node, track, now);
  return group.combinator === "and" ? group.rules.every(test) : group.rules.some(test);
}

function compareForSort(a: RuleTrackInput, b: RuleTrackInput, sortBy: RuleSortKey): number {
  const type = fieldType(sortBy);
  if (type === "string") {
    return stringField(a, sortBy).toLowerCase().localeCompare(stringField(b, sortBy).toLowerCase());
  }
  const av = numberField(a, sortBy);
  const bv = numberField(b, sortBy);
  // Missing values always sort last, regardless of direction.
  if (av === undefined && bv === undefined) return 0;
  if (av === undefined) return 1;
  if (bv === undefined) return -1;
  return av - bv;
}

/**
 * Evaluate a rule set against a library. Returns matching track ids, sorted
 * and limited per the rules (input order preserved when no sortBy). `now` is
 * a parameter so results are deterministic in tests.
 */
export function evaluateSmartRules(rules: SmartRules, tracks: RuleTrackInput[], now: number): string[] {
  let matched = tracks.filter((t) => matchesGroup(rules.root, t, now));

  const sortBy = rules.sortBy;
  if (sortBy) {
    const dir = rules.sortDir === "desc" ? -1 : 1;
    matched = [...matched].sort((a, b) => {
      const cmp = compareForSort(a, b, sortBy);
      // Missing-last must hold in both directions; ties break by id for determinism.
      if (cmp !== 0) {
        const aMissing = fieldType(sortBy) !== "string" && numberField(a, sortBy) === undefined;
        const bMissing = fieldType(sortBy) !== "string" && numberField(b, sortBy) === undefined;
        if (aMissing || bMissing) return cmp;
        return cmp * dir;
      }
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
  }

  if (rules.limit !== undefined && rules.limit >= 0) {
    matched = matched.slice(0, rules.limit);
  }
  return matched.map((t) => t.id);
}

export function emptySmartRules(): SmartRules {
  return { version: 1, root: { combinator: "and", rules: [] } };
}

/** Default value/condition for a field, used by rule-builder UIs. */
export function defaultConditionFor(field: RuleField): RuleCondition {
  const { type } = RULE_FIELDS[field];
  switch (type) {
    case "string":
      return { field, op: "contains", value: "" };
    case "number":
      return { field, op: "gt", value: 0 };
    case "date":
      return { field, op: "inLast", value: 30 };
    case "boolean":
      return { field, op: "isTrue" };
  }
}
