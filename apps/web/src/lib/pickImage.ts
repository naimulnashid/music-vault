import type { PreparedCover } from "@musicvault/core";
import { prepareCover } from "./uploadPrepare";

/** Opens the file picker for one image and prepares it as a vault cover; null when cancelled. */
export function pickImage(): Promise<PreparedCover | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) prepareCover(file).then(resolve, reject);
      else resolve(null);
    };
    input.addEventListener("cancel", () => resolve(null));
    input.click();
  });
}
