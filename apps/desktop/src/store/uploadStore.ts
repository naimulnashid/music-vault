import { create } from "zustand";
import { open } from "@tauri-apps/plugin-dialog";
import {
  applyBatchFields,
  AUDIO_EXTS,
  draftFromSource,
  normalizeTrackPatch,
  parseLrc,
  uploadTrack,
  validateDraft,
  type PreparedCover,
  type TrackEditPatch,
  type UploadDeps,
  type UploadDraft,
  type UploadOutcome,
  type UploadSource,
  type UploadStage,
  type TrackRow as RemoteTrackRow,
} from "@musicvault/core";
import { supabase } from "../lib/supabase";
import {
  onVaultUploadProgress,
  vaultAdoptArt,
  vaultAdoptUpload,
  vaultPrepareFiles,
  vaultPutFile,
  type PreparedCoverDto,
  type PreparedFileDto,
} from "../lib/ipc";
import { audioMime, vaultApi } from "../lib/vault";
import { coverFromDto } from "../lib/covers";
import { uploadCacheCopy } from "../lib/uploadCache";
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
import { useDownloadStore } from "./downloadStore";
import { useLibraryStore } from "./libraryStore";
import { useSyncStore } from "./syncStore";

/**
 * Manual uploads to the vault (docs/drive-to-r2-migration.md §2.4). Nothing
 * is ever uploaded without the user confirming the form. Rust prepares each
 * file (hashes, tags, cover); core's uploadTrack runs the
 * resolve → cover → row → PUT → commit sequence.
 */

export interface DesktopSource extends UploadSource {
  path: string;
}

export type UploadStatus = "preparing" | "ready" | "invalid" | "queued" | "uploading" | "done" | "failed";

export interface UploadItem {
  id: string;
  path: string;
  status: UploadStatus;
  error?: string;
  source?: DesktopSource;
  /** Form values for this file (strings, as typed). */
  values: FormValues;
  /** undefined = keep the file's embedded cover; null = upload without a cover. */
  cover: PreparedCover | null;
  /** The online track this file matches (a re-upload keeps its history). */
  existing?: { id: string; title: string };
  stage?: UploadStage;
  sent?: number;
  total?: number;
  outcome?: UploadOutcome;
}

interface UploadState {
  open: boolean;
  items: UploadItem[];
  /** Batch-wide values; a non-empty field overrides every file's own. */
  shared: FormValues;
  /** A cover for the whole batch (undefined = each file keeps its own). */
  sharedCover: PreparedCover | null | undefined;
  running: boolean;
  openWith: (paths?: string[]) => void;
  pickFiles: () => Promise<void>;
  addPaths: (paths: string[]) => Promise<void>;
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

function sourceFromDto(dto: PreparedFileDto): DesktopSource {
  const tags = { ...dto.tags } as TrackEditPatch;
  if (dto.lrc) {
    const lines = parseLrc(dto.lrc);
    if (lines.length > 0) tags.lyrics_synced = lines;
  }
  return {
    path: dto.path,
    fileName: dto.fileName,
    fileSize: dto.fileSize,
    contentHash: dto.contentHash,
    ext: dto.ext,
    technical: dto.technical,
    tags,
    embeddedCover: dto.cover ? coverFromDto(dto.cover) : null,
  };
}

/** The confirmed draft for an item: its values, the batch values and the chosen cover. */
/** Read-only lookup of online rows matching the picked files, by content hash. */
async function findExisting(sources: DesktopSource[]): Promise<Map<string, RemoteTrackRow>> {
  const found = new Map<string, RemoteTrackRow>();
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
  // Lyrics stay as the file had them; everything in the form comes from the form.
  const fields = normalizeTrackPatch({ ...patchInput(item.values, UPLOAD_FORM_FIELDS) });
  // (A song already online keeps its online lyrics.)
  if (!item.existing && source.tags.lyrics_text) fields.lyrics_text = source.tags.lyrics_text;
  if (!item.existing && source.tags.lyrics_synced) fields.lyrics_synced = source.tags.lyrics_synced;
  const sharedFields = SHARED_FIELDS.filter((f) => (shared[f] ?? "").trim() !== "");
  const sharedPatch = normalizeTrackPatch(patchInput(shared, sharedFields));
  const [draft] = applyBatchFields([{ ...base, fields, cover: item.cover }], sharedPatch, sharedCover);
  return draft;
}

function deps(userId: string, item: UploadItem): UploadDeps {
  const vault = vaultApi()!;
  const client = supabase!;
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
      vaultPutFile(url, (draft.source as DesktopSource).path, item.id, audioMime(draft.source.ext), draft.source.contentHash),
    putCover: (url, cover, variant) => {
      const dto = cover.handle as PreparedCoverDto;
      return vaultPutFile(url, variant === "full" ? dto.fullPath : dto.thumbPath, `${item.id}:cover`, "image/jpeg");
    },
    onStage: (stage) => patchItem(item.id, { stage }),
  };
}

function patchItem(id: string, patch: Partial<UploadItem>) {
  useUploadStore.setState((s) => ({ items: s.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) }));
}

let progressAttached = false;
function attachProgress() {
  if (progressAttached) return;
  progressAttached = true;
  void onVaultUploadProgress(({ uploadId, sent, total }) => {
    if (!uploadId.includes(":")) patchItem(uploadId, { sent, total });
  });
}

async function runOne(item: UploadItem, userId: string) {
  const { shared, sharedCover } = useUploadStore.getState();
  patchItem(item.id, { status: "uploading", error: undefined, sent: 0, total: item.source?.fileSize });
  try {
    const draft = draftFor(item, shared, sharedCover);
    const outcome = await uploadTrack(deps(userId, item), draft);
    patchItem(item.id, { status: "done", outcome, stage: "done" });
    // Keep this PC's copy, so the first play doesn't download it back. With
    // auto-download on it goes straight to downloads, as a played song does.
    const copy = uploadCacheCopy(outcome, item.source!);
    if (copy) {
      const pin = useDownloadStore.getState().autoDownload;
      await vaultAdoptUpload(copy.path, copy.contentHash, copy.ext, pin)
        .then(async (kept) => {
          if (kept) await useDownloadStore.getState().refreshDownloads();
        })
        .catch((err) => console.warn("[upload] couldn't keep a local copy:", err));
    }
    // Show the cover right away instead of downloading it back.
    if (draft.cover && outcome.status !== "already-in-vault") {
      const dto = draft.cover.handle as PreparedCoverDto;
      const file = await vaultAdoptArt(dto.sha256, dto.fullPath, dto.thumbPath).catch(() => null);
      if (file) useLibraryStore.getState().adoptVaultArt(`users/${userId}/art/${dto.sha256}.jpg`, file);
    }
  } catch (err) {
    patchItem(item.id, { status: "failed", error: err instanceof Error ? err.message : String(err) });
  }
}

export const useUploadStore = create<UploadState>((set, get) => ({
  open: false,
  items: [],
  shared: {},
  sharedCover: undefined,
  running: false,

  openWith: (paths) => {
    set({ open: true });
    attachProgress();
    if (paths && paths.length > 0) void get().addPaths(paths);
  },

  pickFiles: async () => {
    const picked = await open({
      multiple: true,
      title: "Choose music to upload",
      filters: [{ name: "Audio", extensions: [...AUDIO_EXTS] }],
    });
    if (!picked) return;
    await get().addPaths(Array.isArray(picked) ? picked : [picked]);
  },

  addPaths: async (paths) => {
    const placeholders: UploadItem[] = paths.map((path) => ({
      id: crypto.randomUUID(),
      path,
      status: "preparing",
      values: {},
      cover: null,
    }));
    set((s) => ({ items: [...s.items, ...placeholders] }));
    const ids = new Set(placeholders.map((p) => p.id));
    try {
      const results = await vaultPrepareFiles(paths);
      const known = new Set(get().items.filter((i) => i.source).map((i) => i.source!.contentHash));
      const existing = await findExisting(
        results.flatMap((r) => (r.file ? [sourceFromDto(r.file)] : [])),
      ).catch(() => new Map<string, RemoteTrackRow>());
      const liveByHash = new Map(
        useLibraryStore.getState().tracks.flatMap((t) => (t.contentHash ? [[t.contentHash, t] as const] : [])),
      );
      const prepared: UploadItem[] = results.map((r) => {
        if (!r.file) return { id: crypto.randomUUID(), path: r.path, status: "invalid", error: r.error ?? "Couldn't read this file", values: {}, cover: null };
        const source = sourceFromDto(r.file);
        // A mirror copy's own hash is new (its tags were rewritten), so it is
        // matched by the song it was made from. A song since deleted from the
        // vault uploads as usual: the mirror doubles as a backup.
        const mirrored = r.file.mirrorOf ? liveByHash.get(r.file.mirrorOf) : undefined;
        if (mirrored) {
          return {
            id: crypto.randomUUID(),
            path: r.path,
            status: "invalid",
            error: `A library mirror copy of "${mirrored.title}", which is already in your vault`,
            values: {},
            cover: null,
          } satisfies UploadItem;
        }
        const dupe = known.has(source.contentHash);
        known.add(source.contentHash);
        const draft = draftFromSource(source);
        const row = existing.get(source.contentHash);
        if (row && row.storage_key && !row.deleted_at) {
          return {
            id: crypto.randomUUID(),
            path: r.path,
            status: "invalid",
            error: `Already in your vault as "${row.title}"`,
            values: {},
            cover: null,
          } satisfies UploadItem;
        }
        const item: UploadItem = {
          id: crypto.randomUUID(),
          path: r.path,
          status: dupe ? "invalid" : "ready",
          error: dupe ? "This exact file is already in the list" : undefined,
          source,
          // A known song starts from its online metadata, so only what you
          // change is edited; a new one starts from the file's tags.
          values: row ? valuesFromRow(row) : valuesFromPatch(draft.fields),
          cover: row?.artwork_key ? null : draft.cover,
          existing: row ? { id: row.id, title: row.title } : undefined,
        };
        const problems = dupe ? [] : validateDraft(draft);
        return problems.length > 0 ? { ...item, status: "invalid", error: problems.join("; ") } : item;
      });
      set((s) => ({ items: [...s.items.filter((i) => !ids.has(i.id)), ...prepared] }));
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      set((s) => ({ items: s.items.map((i) => (ids.has(i.id) ? { ...i, status: "invalid", error } : i)) }));
    }
  },

  setValue: (id, field, value) =>
    set((s) => ({ items: s.items.map((i) => (i.id === id ? { ...i, values: { ...i.values, [field]: value } } : i)) })),

  setItemCover: (id, cover) => set((s) => ({ items: s.items.map((i) => (i.id === id ? { ...i, cover } : i)) })),

  setShared: (field, value) => set((s) => ({ shared: { ...s.shared, [field]: value } })),

  setSharedCover: (sharedCover) => set({ sharedCover }),

  remove: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id || i.status === "uploading") })),

  clearFinished: () => set((s) => ({ items: s.items.filter((i) => i.status !== "done") })),

  close: () => {
    // Uploads keep running in the background; finished rows are tidied away.
    set((s) => ({ open: false, items: s.running ? s.items : s.items.filter((i) => i.status !== "done") }));
  },

  start: async () => {
    if (get().running) return;
    const session = useAuthStore.getState().session;
    if (!supabase || !session || !vaultApi()) {
      set({ items: get().items.map((i) => (i.status === "ready" ? { ...i, status: "failed", error: "Sign in to upload" } : i)) });
      return;
    }
    const queue = get().items.filter((i) => i.status === "ready" || i.status === "failed");
    if (queue.length === 0) return;
    set({ running: true, items: get().items.map((i) => (queue.includes(i) ? { ...i, status: "queued" } : i)) });
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
      set({ running: false });
      // Pull the new rows (with their storage keys) into the library.
      void useSyncStore.getState().syncNow();
    }
  },
}));
