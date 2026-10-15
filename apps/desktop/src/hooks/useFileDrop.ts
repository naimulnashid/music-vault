import { useEffect, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { AUDIO_EXTS } from "@musicvault/core";
import { useUploadStore } from "../store/uploadStore";

const AUDIO_EXTENSIONS = AUDIO_EXTS.map((e) => `.${e}`);

function isImportable(path: string): boolean {
  const lower = path.toLowerCase();
  // Directories have no audio extension but are still accepted (the uploader
  // walks them), so only reject paths with a *different* extension.
  const lastSegment = lower.split(/[/\\]/).pop() ?? "";
  const dotIndex = lastSegment.lastIndexOf(".");
  if (dotIndex <= 0) return true; // no extension — assume directory
  return AUDIO_EXTENSIONS.some((ext) => lower.endsWith(ext)) || lower.endsWith(".lrc");
}

/**
 * OS drag-and-drop: dropped audio files or folders open the vault upload
 * dialog (nothing uploads until confirmed). Returns whether a drag is
 * currently hovering the window (for the drop-target overlay).
 */
export function useFileDrop(): boolean {
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    void getCurrentWebview()
      .onDragDropEvent((event) => {
        if (event.payload.type === "over") {
          setDragOver(true);
        } else if (event.payload.type === "drop") {
          setDragOver(false);
          const paths = event.payload.paths.filter(isImportable);
          if (paths.length === 0) return;
          useUploadStore.getState().openWith(paths.filter((p) => !p.toLowerCase().endsWith(".lrc")));
        } else {
          setDragOver(false);
        }
      })
      .then((un) => {
        if (disposed) un();
        else unlisten = un;
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  return dragOver;
}
