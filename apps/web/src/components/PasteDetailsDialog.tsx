import { useState } from "react";
import { ClipboardPaste, Copy } from "lucide-react";
import { UPLOAD_JSON_TEMPLATE } from "@musicvault/core";
import { useUploadStore } from "../store/uploadStore";
import { Dialog } from "./ui/Dialog";
import { Button } from "./ui/Button";

const TEMPLATE = JSON.stringify(UPLOAD_JSON_TEMPLATE, null, 2);

/**
 * Paste song details as JSON (core uploadJson.ts) to fill the upload form:
 * for one row (`rowId`), or for every row a pasted song matches by title.
 * The fields stay editable afterwards. Kept 1:1 between desktop and web.
 */
export function PasteDetailsDialog({ open, rowId, onClose }: { open: boolean; rowId?: string; onClose: () => void }) {
  const pasteDetails = useUploadStore((s) => s.pasteDetails);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const close = () => {
    setText("");
    setError(null);
    setResult(null);
    onClose();
  };

  const fill = () => {
    try {
      const message = pasteDetails(text, rowId);
      setError(null);
      setResult(message);
      setText("");
    } catch (err) {
      setResult(null);
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const copyTemplate = async () => {
    try {
      await navigator.clipboard.writeText(TEMPLATE);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Couldn't copy. Select the template below and copy it instead.");
    }
  };

  return (
    <Dialog open={open} onClose={close} title={rowId ? "Paste details for this song" : "Paste song details"} widthClass="max-w-2xl">
      <div className="px-5 pb-5 space-y-3">
        <p className="text-xs text-muted">
          {rowId
            ? "One song as { … }. Only the fields you include change, and you can still edit them before uploading."
            : "One song as { … } or several as [ { … }, { … } ]. Each fills the file with the same title. Only the fields you include change, and you can still edit them before uploading."}
        </p>
        <textarea
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && text.trim()) fill();
          }}
          spellCheck={false}
          rows={10}
          placeholder={'{ "title": "…", "artist": "…", "mood": "Romantic, Yearning" }'}
          className="mv-field font-mono text-xs resize-y"
        />
        {error && <p className="text-xs text-danger">{error}</p>}
        {result && <p className="text-xs text-accent">{result}</p>}
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => void copyTemplate()} icon={<Copy className="w-4 h-4" />}>
            {copied ? "Copied" : "Copy template"}
          </Button>
          <div className="flex-1" />
          <Button variant="secondary" onClick={close}>
            {result ? "Done" : "Cancel"}
          </Button>
          <Button variant="primary" onClick={fill} disabled={!text.trim()} icon={<ClipboardPaste className="w-4 h-4" />}>
            Fill
          </Button>
        </div>
        <details className="text-xs text-muted">
          <summary className="cursor-pointer hover:text-fg">Template</summary>
          <pre className="mt-2 p-3 rounded-lg bg-surface-2 text-fg overflow-x-auto select-text">{TEMPLATE}</pre>
        </details>
      </div>
    </Dialog>
  );
}
