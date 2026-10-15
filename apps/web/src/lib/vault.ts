import { createSupabaseVaultApi, SignedUrlCache, type VaultApi } from "@musicvault/core";
import { getSupabaseBrowser } from "./supabase/browser";

/**
 * Web side of the vault: the shared API client and signed-URL cache. Audio
 * and covers are fetched straight from R2 with pre-signed URLs (no proxy),
 * which the bucket's CORS policy allows for this site's origin.
 */

let api: VaultApi | null = null;
let urls: SignedUrlCache | null = null;

export function vaultApi(): VaultApi | null {
  const supabase = getSupabaseBrowser();
  if (!supabase) return null;
  api ??= createSupabaseVaultApi(supabase);
  return api;
}

export function signedUrls(): SignedUrlCache | null {
  const vault = vaultApi();
  if (!vault) return null;
  urls ??= new SignedUrlCache(vault);
  return urls;
}

/** MIME type sent with an audio upload. */
export function audioMime(ext: string): string {
  switch (ext) {
    case "mp3":
      return "audio/mpeg";
    case "flac":
      return "audio/flac";
    case "wav":
      return "audio/wav";
    case "ogg":
    case "oga":
    case "opus":
      return "audio/ogg";
    case "m4a":
    case "mp4":
    case "alac":
      return "audio/mp4";
    case "aac":
      return "audio/aac";
    case "aiff":
    case "aif":
      return "audio/aiff";
    default:
      return "application/octet-stream";
  }
}

/**
 * PUTs a blob to a pre-signed URL. XMLHttpRequest rather than fetch: it is
 * the only browser API that reports upload progress.
 */
export function putBlob(
  url: string,
  body: Blob,
  contentType: string,
  onProgress?: (sent: number, total: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded, e.total);
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`Upload rejected (${xhr.status}) ${xhr.responseText.slice(0, 200)}`));
    xhr.onerror = () => reject(new Error("Upload failed — check your connection (or the bucket's CORS settings)."));
    xhr.send(body);
  });
}
