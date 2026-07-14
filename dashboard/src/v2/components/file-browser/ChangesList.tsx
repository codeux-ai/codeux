import type { FunctionComponent } from "preact";
import { FileDiff, GitCompare, Loader2 } from "lucide-preact";
import type { FileBrowserChange, FileBrowserChangeStatus } from "../../../types.js";
import { buildInteractionTransition } from "../../lib/motion/tokens.js";

interface ChangesListProps {
  files: FileBrowserChange[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
  loadingPath?: string | null;
}

const STATUS_META: Record<FileBrowserChangeStatus, { label: string; glyph: string; class: string }> = {
  added: { label: "Added", glyph: "A", class: "bg-status-green/15 text-status-green border-status-green/30" },
  modified: { label: "Modified", glyph: "M", class: "bg-sky-500/15 text-sky-500 border-sky-500/30" },
  deleted: { label: "Deleted", glyph: "D", class: "bg-status-red/15 text-status-red border-status-red/30" },
  renamed: { label: "Renamed", glyph: "R", class: "bg-ember-500/15 text-ember-500 border-ember-500/30" },
};

const splitPath = (path: string): { dir: string; name: string } => {
  const index = path.lastIndexOf("/");
  if (index === -1) {
    return { dir: "", name: path };
  }
  return { dir: path.slice(0, index + 1), name: path.slice(index + 1) };
};

const selectionTransition = buildInteractionTransition("selectionMovement", "background-color, border-color, color, box-shadow");
const badgeTransition = buildInteractionTransition("asyncFeedback", "opacity, transform");

export const ChangesList: FunctionComponent<ChangesListProps> = ({ files, selectedPath, onSelect, loadingPath = null }) => {
  if (files.length === 0) {
    return (
      <div class="flex h-full flex-col items-center justify-center gap-3 p-10 text-center" role="status">
        <div class="flex h-14 w-14 items-center justify-center rounded-2xl bg-signal-500/10 text-signal-500">
          <GitCompare class="h-6 w-6" strokeWidth={1.8} />
        </div>
        <div class="text-sm font-semibold text-slate-700 dark:text-slate-200">No changes detected</div>
        <p class="max-w-xs text-xs leading-5 text-slate-500 dark:text-slate-400">
          This feature branch matches the default branch. Changes will appear here as tasks land work.
        </p>
      </div>
    );
  }

  return (
    <div class="flex min-w-0 h-full flex-col overflow-y-auto dashboard-scrollbar p-2" role="listbox" aria-label="Changed files">
      <div class="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {files.length} changed {files.length === 1 ? "file" : "files"} available. {selectedPath ? `Selected change ${selectedPath}.` : "No change selected."}
      </div>
      {files.map((change) => {
        const meta = STATUS_META[change.status];
        const { dir, name } = splitPath(change.path);
        const isSelected = selectedPath === change.path;
        const isLoading = loadingPath === change.path;
        const loadingDescriptionId = `changed-file-${change.path.replace(/[^a-zA-Z0-9_-]/g, "-")}-loading`;
        return (
          <button
            key={change.path}
            type="button"
            role="option"
            aria-selected={isSelected}
            aria-busy={isLoading}
            aria-describedby={isLoading ? loadingDescriptionId : undefined}
            aria-label={`${meta.label} file ${change.path}, ${change.additions} additions, ${change.deletions} deletions${isLoading ? ", loading diff" : ""}`}
            onClick={() => onSelect(change.path)}
            title={isLoading ? `Loading diff for ${change.path}` : change.path}
            class={`group flex w-full items-center gap-3 rounded-xl border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 ${
              isSelected
                ? "border-signal-500/25 bg-signal-500/[0.12]"
                : "border-transparent hover:bg-black/[0.04] dark:hover:bg-white/[0.05]"
            }`}
            style={{ transition: selectionTransition }}
          >
            <span
              class={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border text-[11px] font-black ${meta.class}`}
              title={meta.label}
              aria-label={meta.label}
            >
              {meta.glyph}
            </span>
            <span class="min-w-0 flex-1">
              <span class="min-w-0 flex items-center gap-1.5">
                <span class="break-words text-[13px] font-semibold leading-5 text-slate-800 dark:text-slate-100">{name}</span>
              </span>
              {dir && <span class="block break-words font-mono text-[11px] leading-4 text-slate-400 dark:text-slate-500">{dir}</span>}
            </span>
            <span class="flex shrink-0 items-center gap-2 font-mono text-[11px] tabular-nums">
              {change.additions > 0 && <span class="text-status-green">+{change.additions}</span>}
              {change.deletions > 0 && <span class="text-status-red">−{change.deletions}</span>}
              {isLoading ? (
                <span id={loadingDescriptionId} class="inline-flex items-center gap-1 rounded-full border border-signal-500/20 bg-signal-500/[0.08] px-1.5 py-0.5 text-[10px] font-semibold text-signal-700 dark:text-signal-300" style={{ transition: badgeTransition }}>
                  <Loader2 aria-hidden="true" class="h-3 w-3 animate-spin motion-reduce:animate-none" strokeWidth={2} />
                  Loading
                </span>
              ) : (
                <FileDiff class="h-3.5 w-3.5 text-slate-300 transition-colors group-hover:text-slate-500 motion-reduce:transition-none dark:text-slate-600" strokeWidth={2} />
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
};
