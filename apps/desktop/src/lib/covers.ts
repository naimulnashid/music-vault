import { open } from "@tauri-apps/plugin-dialog";
import type { PreparedCover } from "@musicvault/core";
import { vaultPrepareCover, type PreparedCoverDto } from "./ipc";

/** Wraps Rust's prepared cover (staged JPEG paths) as a core PreparedCover. */
export function coverFromDto(dto: PreparedCoverDto): PreparedCover {
  return { sha256: dto.sha256, fullSize: dto.fullSize, thumbSize: dto.thumbSize, handle: dto };
}

/** Lets the user pick an image file and turns it into a vault cover. */
export async function pickCover(): Promise<PreparedCover | null> {
  const picked = await open({
    multiple: false,
    title: "Choose a cover image",
    filters: [{ name: "Images", extensions: ["jpg", "jpeg", "png", "webp", "bmp", "gif", "svg"] }],
  });
  if (!picked || Array.isArray(picked)) return null;
  return coverFromDto(await vaultPrepareCover(picked));
}

/** artworkPath (relative to the artwork dir) of a staged cover, for previews. */
export function stagedArtworkPath(cover: PreparedCover): string {
  return `upload-staging\\${(cover.handle as PreparedCoverDto).sha256}.jpg`;
}
