import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DownloadsMoveProgress, DownloadsMoveReport } from "../lib/ipc";

let onMoveProgress: ((p: DownloadsMoveProgress) => void) | null = null;
const unlisten = vi.fn();
const vaultDownloadsMove = vi.fn<(dir: string) => Promise<DownloadsMoveReport>>();
const open = vi.fn();
const emitAppError = vi.fn();
const dir = { path: "D:/Music Vault", defaultPath: "C:/AppData/downloads" };

vi.mock("@tauri-apps/plugin-dialog", () => ({ open }));
vi.mock("../lib/errorBus", () => ({ emitAppError }));
vi.mock("../lib/vault", () => ({ ensureVaultLocal: vi.fn() }));
vi.mock("./libraryStore", () => ({ useLibraryStore: { getState: () => ({ tracks: [] }), subscribe: vi.fn() } }));
vi.mock("../lib/ipc", () => ({
  onVaultDownloadDone: vi.fn(),
  onVaultDownloadError: vi.fn(),
  onVaultDownloadProgress: vi.fn(),
  onVaultDownloadsMoveProgress: async (cb: (p: DownloadsMoveProgress) => void) => {
    onMoveProgress = cb;
    return unlisten;
  },
  vaultCacheClear: vi.fn(),
  vaultCacheSetMax: vi.fn(),
  vaultCacheStats: async () => ({ autoBytes: 0, pinnedBytes: 0, maxBytes: 0 }),
  vaultDownloadCancel: vi.fn(),
  vaultDownloadRemove: vi.fn(),
  vaultDownloadsDir: async () => dir,
  vaultDownloadsList: async () => [],
  vaultDownloadsMove: (d: string) => vaultDownloadsMove(d),
}));

const { useDownloadStore } = await import("./downloadStore");

describe("moving the download folder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    onMoveProgress = null;
    useDownloadStore.setState({ moving: null, downloadsDir: null });
  });

  it("shows the move's progress and the new folder once done", async () => {
    let finish!: (r: DownloadsMoveReport) => void;
    vaultDownloadsMove.mockReturnValue(new Promise((resolve) => (finish = resolve)));

    const move = useDownloadStore.getState().moveDownloadsTo("D:/Music Vault");
    await vi.waitFor(() => expect(onMoveProgress).not.toBeNull());
    onMoveProgress!({ done: 1, total: 2, bytes: 10, totalBytes: 20 });
    expect(useDownloadStore.getState().moving).toEqual({ done: 1, total: 2, bytes: 10, totalBytes: 20 });

    finish({ moved: 2, failed: 0 });
    await move;
    expect(vaultDownloadsMove).toHaveBeenCalledWith("D:/Music Vault");
    expect(useDownloadStore.getState()).toMatchObject({ moving: null, downloadsDir: dir });
    expect(unlisten).toHaveBeenCalled();
    expect(emitAppError).not.toHaveBeenCalled();
  });

  it("says how many downloads stayed behind", async () => {
    vaultDownloadsMove.mockResolvedValue({ moved: 1, failed: 2 });
    await useDownloadStore.getState().moveDownloadsTo("D:/Music Vault");
    expect(emitAppError).toHaveBeenCalledWith(expect.stringMatching(/^2 downloads couldn't move/));
  });

  it("reports a refused move and clears the progress", async () => {
    vaultDownloadsMove.mockRejectedValue("Wait for the downloads to finish, then change the folder.");
    await useDownloadStore.getState().moveDownloadsTo("D:/Music Vault");
    expect(emitAppError).toHaveBeenCalledWith(
      "Couldn't change the download folder: Wait for the downloads to finish, then change the folder.",
    );
    expect(useDownloadStore.getState().moving).toBeNull();
  });

  it("moves to the folder picked, and does nothing when the picker is closed", async () => {
    vaultDownloadsMove.mockResolvedValue({ moved: 0, failed: 0 });
    open.mockResolvedValueOnce(null);
    await useDownloadStore.getState().chooseDownloadsDir();
    expect(vaultDownloadsMove).not.toHaveBeenCalled();

    open.mockResolvedValueOnce("E:/Songs");
    await useDownloadStore.getState().chooseDownloadsDir();
    expect(open).toHaveBeenLastCalledWith(expect.objectContaining({ directory: true }));
    expect(vaultDownloadsMove).toHaveBeenCalledWith("E:/Songs");
  });
});
