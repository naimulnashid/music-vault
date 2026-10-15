import type { ReactNode } from "react";
import { X } from "lucide-react";
import { useUiStore } from "../store/uiStore";
import { IconButton } from "./ui/Button";

/** Title row of a side panel (queue, lyrics, sound, visualizer) with a close button. */
export function PanelHeader({ title, children }: { title: string; children?: ReactNode }) {
  const closePanel = useUiStore((s) => s.closePanel);
  return (
    <div className="h-14 shrink-0 flex items-center gap-2 pl-5 pr-2">
      <h2 className="flex-1 text-base font-bold truncate">{title}</h2>
      {children}
      <IconButton label="Close" onClick={closePanel}>
        <X className="w-[18px] h-[18px]" />
      </IconButton>
    </div>
  );
}
