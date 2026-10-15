import { useMemo, useState } from "react";
import { defaultConditionFor, emptySmartRules, type SmartRules } from "@musicvault/core";
import type { Playlist } from "../types";
import { useLibraryStore } from "../store/libraryStore";
import { useHistoryStore } from "../store/historyStore";
import { useUiStore } from "../store/uiStore";
import { evaluateSmartPlaylist } from "../lib/smartEval";
import { SmartRulesEditor } from "./SmartRulesEditor";
import { Button } from "./ui/Button";
import { Dialog } from "./ui/Dialog";

/**
 * Creates a smart playlist, or edits an existing one's rules. Nothing is
 * saved until Save: the playlist is created with its rules in one step, so it
 * never shows up holding the whole library while the rules are still empty.
 */
export function SmartPlaylistDialog({
  open,
  onClose,
  playlist,
}: {
  open: boolean;
  onClose: () => void;
  /** Edit this playlist; omitted = create a new one. */
  playlist?: Playlist;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={playlist ? "Edit smart playlist" : "New smart playlist"}
      widthClass="max-w-2xl"
    >
      {/* Remounted on every open so the draft starts from the saved rules. */}
      {open && <SmartPlaylistForm playlist={playlist} onClose={onClose} />}
    </Dialog>
  );
}

function SmartPlaylistForm({ playlist, onClose }: { playlist?: Playlist; onClose: () => void }) {
  const tracks = useLibraryStore((s) => s.tracks);
  const createSmartPlaylist = useLibraryStore((s) => s.createSmartPlaylist);
  const updateSmartRules = useLibraryStore((s) => s.updateSmartRules);
  const renamePlaylist = useLibraryStore((s) => s.renamePlaylist);
  const playCounts = useHistoryStore((s) => s.playCounts);
  const lastPlayedAt = useHistoryStore((s) => s.lastPlayedAt);
  const showPlaylist = useUiStore((s) => s.showPlaylist);

  const [name, setName] = useState(playlist?.name ?? "");
  const [rules, setRules] = useState<SmartRules>(() => {
    if (playlist) return playlist.smartRules ?? emptySmartRules();
    const fresh = emptySmartRules();
    return { ...fresh, root: { ...fresh.root, rules: [defaultConditionFor("genre")] } };
  });
  const [saving, setSaving] = useState(false);

  const matches = useMemo(
    () => evaluateSmartPlaylist(rules, tracks, { playCounts, lastPlayedAt }).length,
    [rules, tracks, playCounts, lastPlayedAt],
  );

  const trimmed = name.trim();
  const hasRules = rules.root.rules.length > 0 || rules.limit !== undefined;
  const canSave = trimmed.length > 0 && hasRules && !saving;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      if (playlist) {
        if (trimmed !== playlist.name) await renamePlaylist(playlist.id, trimmed);
        await updateSmartRules(playlist.id, rules);
      } else {
        showPlaylist(await createSmartPlaylist(trimmed, rules));
      }
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="flex-1 min-h-0 overflow-y-auto px-5 pb-4 space-y-4">
        <label className="block">
          <span className="text-xs font-semibold text-muted">Name</span>
          <input
            autoFocus={!playlist}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void save();
            }}
            placeholder="Smart playlist name"
            className="mv-field mt-1"
          />
        </label>
        <div>
          <span className="text-xs font-semibold text-muted">Rules</span>
          <div className="mt-1 p-4 rounded-xl bg-surface-2/50 border border-line">
            <SmartRulesEditor rules={rules} onChange={setRules} />
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 px-5 py-3 border-t border-line">
        <p className="flex-1 min-w-0 text-xs text-muted truncate">
          {hasRules ? `${matches} song${matches === 1 ? "" : "s"} match` : "Add at least one rule"}
        </p>
        <Button variant="ghost" onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button variant="primary" onClick={() => void save()} disabled={!canSave}>
          Save
        </Button>
      </div>
    </>
  );
}
