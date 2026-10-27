import { create } from "zustand";
import {
  applyBatchFields,
  draftFromSource,
  normalizeTrackPatch,
  uploadTrack,
  validateDraft,
  type PreparedCover,
  type TrackRow as RemoteTrackRow,
  type UploadDeps,
  type UploadDraft,
  type UploadOutcome,
  type UploadStage,
} from "@musicvault/core";
import { getSupabaseBrowser } from "../lib/supabase/browser";
import { audioMime, putBlob, vaultApi } from "../lib/vault";
import { prepareFile, type WebCoverHandle, type WebSource } from "../lib/uploadPrepare";
import { adoptVaultCover } from "../lib/artwork";
import { nowIso, syncEnqueue } from "../lib/syncBus";
import {
  patchInput,
  SHARED_FIELDS,
  UPLOAD_FORM_FIELDS,
  valuesFromPatch,
  valuesFromRow,
  type FormValues,
} from "../lib/trackForm";
import { useAuthStore } from "./authStore";
import { useSyncStore } from "./syncStore";

/**
 * Manual uploads to the vault from the browser (docs/drive-to-r2-migration.md
 * §2.4) — the same flow as desktop: nothing uploads until the user confirms.
 * Files are hashed and read in the page; core's uploadTrack runs
 * resolve → cover → row → PUT → commit, PUTting straight to R2.
 */

export type UploadStatus = "preparing" | "ready" | "invalid" | "queued" | "uploading" | "done" | "failed";

export interface UploadItem {
  id: string;
  name: string;
  status: UploadStatus;
  error?: string;
  source?: WebSource;
  values: FormValues;
  cover: PreparedCover | null;
  existing?: { id: string; title: string };
  stage?: UploadStage;
  sent?: number;
  total?: number;
  outcome?: UploadOutcome;
}

interface UploadState {
  open: boolean;
  items: UploadItem[];
  shared: FormValues;
  sharedCover: PreparedCover | null | undefined;
  running: boolean;
  /** Songs the last run uploaded, for the empty screen it leaves behind. */
  lastUploaded: number;
  openWith: (files?: File[]) => void;
  addFiles: (files: File[]) => Promise<void>;
  setValue: (id: string, field: keyof FormValues, value: string) => void;
  setItemCover: (id: string, cover: PreparedCover | null) => void;
  setShared: (field: keyof FormValues, value: string) => void;
  setSharedCover: (cover: PreparedCover | null | undefined) => void;
  remove: (id: string) => void;
  clearFinished: () => void;
  close: () => void;
  start: () => Promise<void>;
}

const CONCURRENCY = 2;

function patchItem(id: string, patch: Partial<UploadItem>) {
  useUploadStore.setState((s) => ({ items: s.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) }));
}

/** Read-only lookup of online rows matching the files (by content hash). */
async function findExisting(sources: WebSource[]): Promise<Map<string, RemoteTrackRow>> {
  const found = new Map<string, RemoteTrackRow>();
  const supabase = getSupabaseBrowser();
  if (!supabase || sources.length === 0) return found;
  const hashes = sources.map((s) => s.contentHash);
  for (let i = 0; i < hashes.length; i += 25) {
    const { data } = await supabase.from("tracks").select("*").in("content_hash", hashes.slice(i, i + 25));
    for (const row of data ?? []) if (row.content_hash) found.set(row.content_hash, row);
  }
  return found;
}

function draftFor(item: UploadItem, shared: FormValues, sharedCover: PreparedCover | null | undefined): UploadDraft {
  const source = item.source!;
  const base = draftFromSource(source);
  const fields = normalizeTrackPatch(patchInput(item.values, UPLOAD_FORM_FIELDS));
  // Lyrics come from the file (or its .lrc) for a new song; a known song keeps its online lyrics.
  if (!item.existing && source.tags.lyrics_text) fields.lyrics_text = source.tags.lyrics_text;
  if (!item.existing && source.tags.lyrics_synced) fields.lyrics_synced = source.tags.lyrics_synced;
  const sharedFields = SHARED_FIELDS.filter((f) => (shared[f] ?? "").trim() !== "");
  const sharedPatch = normalizeTrackPatch(patchInput(shared, sharedFields));
  const [draft] = applyBatchFields([{ ...base, fields, cover: item.cover }], sharedPatch, sharedCover);
  return draft;
}

function deps(userId: string, item: UploadItem): UploadDeps {
  const vault = vaultApi()!;
  const client = getSupabaseBrowser()!;
  return {
    userId,
    vault,
    async getTrack(id) {
      const { data, error } = await client.from("tracks").select("*").eq("id", id).maybeSingle();
      if (error) throw new Error(error.message);
      return data;
    },
    async insertTrack(row) {
      const { data, error } = await client.from("tracks").insert(row).select("id").single();
      if (error) throw new Error(error.message);
      return data.id;
    },
    async updateTechnical(trackId, props) {
      const { error } = await client.from("tracks").update(props).eq("id", trackId);
      if (error) throw new Error(error.message);
    },
    async applyEdit(trackId, patch) {
      syncEnqueue({ kind: "track.edit", track: { remoteId: trackId }, patch, editedAt: nowIso() });
    },
    putAudio: (url, draft) =>
      putBlob(url, (draft.source as WebSource).file, audioMime(draft.source.ext), (sent, total) =>
        patchItem(item.id, { sent, total }),
      ),
    putCover: (url, cover, variant) => {
      const handle = cover.handle as WebCoverHandle;
      return putBlob(url, variant === "full" ? handle.full : handle.thumb, "image/jpeg");
    },
    onStage: (stage) => patchItem(item.id, { stage }),
  };
}

async function runOne(item: UploadItem, userId: string) {
  const { shared, sharedCover } = useUploadStore.getState();
  patchItem(item.id, { status: "uploading", error: undefined, sent: 0, total: item.source?.fileSize });
  try {
    const draft = draftFor(item, shared, sharedCover);
    const outcome = await uploadTrack(deps(userId, item), draft);
    patchItem(item.id, { status: "done", outcome, stage: "done" });
    if (draft.cover && outcome.status !== "already-in-vault") {
      const handle = draft.cover.handle as WebCoverHandle;
      await adoptVaultCover(`users/${userId}/art/${draft.cover.sha256}.jpg`, handle.full, handle.thumb);
    }
  } catch (err) {
    patchItem(item.id, { status: "failed", error: err instanceof Error ? err.message : String(err) });
  }
}

const stem = (name: string) => name.replace(/\.[^.]+$/, "").toLowerCase();

export const useUploadStore = create<UploadState>((set, get) => ({
  open: false,
  items: [],
  shared: {},
  sharedCover: undefined,
  running: false,
  lastUploaded: 0,

  openWith: (files) => {
    set({ open: true });
    if (files && files.length > 0) void get().addFiles(files);
  },

  addFiles: async (files) => {
    // .lrc files picked alongside a song become its synced lyrics.
    const lrcByStem = new Map<string, File>();
    for (const f of files) if (f.name.toLowerCase().endsWith(".lrc")) lrcByStem.set(stem(f.name), f);
    const audio = files.filter((f) => !f.name.toLowerCase().endsWith(".lrc"));
    if (audio.length === 0) return;

    const placeholders: UploadItem[] = audio.map((f) => ({
      id: crypto.randomUUID(),
      name: f.name,
      status: "preparing",
      values: {},
      cover: null,
    }));
    set((s) => ({ items: [...s.items, ...placeholders], lastUploaded: 0 }));

    const prepared: { id: string; source?: WebSource; error?: string }[] = [];
    let cursor = 0;
    const worker = async () => {
      while (cursor < audio.length) {
        const i = cursor++;
        const file = audio[i];
        try {
          const lrc = lrcByStem.get(stem(file.name));
          prepared[i] = { id: placeholders[i].id, source: await prepareFile(file, lrc ? await lrc.text() : undefined) };
        } catch (err) {
          prepared[i] = { id: placeholders[i].id, error: err instanceof Error ? err.message : String(err) };
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(2, audio.length) }, worker));

    const sources = prepared.flatMap((p) => (p.source ? [p.source] : []));
    const existing = await findExisting(sources).catch(() => new Map<string, RemoteTrackRow>());
    const known = new Set(get().items.filter((i) => i.source).map((i) => i.source!.contentHash));

    const resolved = new Map<string, UploadItem>();
    for (const p of prepared) {
      const base = placeholders.find((x) => x.id === p.id)!;
      if (!p.source) {
        resolved.set(p.id, { ...base, status: "invalid", error: p.error ?? "Couldn't read this file" });
        continue;
      }
      const source = p.source;
      const row = existing.get(source.contentHash);
      if (row && row.storage_key && !row.deleted_at) {
        resolved.set(p.id, { ...base, status: "invalid", error: `Already in your vault as "${row.title}"` });
        continue;
      }
      const dupe = known.has(source.contentHash);
      known.add(source.contentHash);
      const draft = draftFromSource(source);
      const item: UploadItem = {
        ...base,
        status: dupe ? "invalid" : "ready",
        error: dupe ? "This exact file is already in the list" : undefined,
        source,
        values: row ? valuesFromRow(row) : valuesFromPatch(draft.fields),
        cover: row?.artwork_key ? null : draft.cover,
        existing: row ? { id: row.id, title: row.title } : undefined,
      };
      const problems = dupe ? [] : validateDraft(draft);
      resolved.set(p.id, problems.length > 0 ? { ...item, status: "invalid", error: problems.join("; ") } : item);
    }
    set((s) => ({ items: s.items.map((i) => resolved.get(i.id) ?? i) }));
  },

  setValue: (id, field, value) =>
    set((s) => ({ items: s.items.map((i) => (i.id === id ? { ...i, values: { ...i.values, [field]: value } } : i)) })),

  setItemCover: (id, cover) => set((s) => ({ items: s.items.map((i) => (i.id === id ? { ...i, cover } : i)) })),

  setShared: (field, value) => set((s) => ({ shared: { ...s.shared, [field]: value } })),

  setSharedCover: (sharedCover) => set({ sharedCover }),

  remove: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id || i.status === "uploading") })),

  clearFinished: () => set((s) => ({ items: s.items.filter((i) => i.status !== "done") })),

  close: () => set((s) => ({ open: false, items: s.running ? s.items : s.items.filter((i) => i.status !== "done") })),

  start: async () => {
    if (get().running) return;
    const session = useAuthStore.getState().session;
    if (!getSupabaseBrowser() || !session || !vaultApi()) {
      set({ items: get().items.map((i) => (i.status === "ready" ? { ...i, status: "failed", error: "Sign in to upload" } : i)) });
      return;
    }
    const queue = get().items.filter((i) => (i.status === "ready" || i.status === "failed") && i.source);
    if (queue.length === 0) return;
    const ids = new Set(queue.map((i) => i.id));
    set({ running: true, items: get().items.map((i) => (ids.has(i.id) ? { ...i, status: "queued" } : i)) });
    let cursor = 0;
    const worker = async () => {
      while (cursor < queue.length) {
        const item = get().items.find((i) => i.id === queue[cursor].id);
        cursor++;
        if (item?.source) await runOne(item, session.user.id);
      }
    };
    try {
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
    } finally {
      // Uploaded songs leave the list, and once nothing is left the batch
      // fields empty too, so the screen is ready for the next upload.
      // Failed songs stay, with what was typed, to be tried again.
      set((s) => {
        const items = s.items.filter((i) => i.status !== "done");
        return {
          running: false,
          items,
          lastUploaded: s.items.length - items.length,
          ...(items.length === 0 ? { shared: {}, sharedCover: undefined } : {}),
        };
      });
      void useSyncStore.getState().syncNow();
    }
  },
}));
