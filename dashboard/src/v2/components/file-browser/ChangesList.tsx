import type { FunctionComponent } from "preact";
import { FileDiff, GitCompare } from "lucide-preact";
import type { FileBrowserChange, FileBrowserChangeStatus } from "../../../types.js";

interface ChangesListProps {
  files: FileBrowserChange[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
}

const STATUS_META: Record<FileBrowserChangeStatus, { label: string; glyph: string; class: string }> = {
  added: { label: "Added", glyph: "A", class: "border-status-green/35 bg-status-green/10 text-status-green" },
  modified: { label: "Modified", glyph: "M", class: "border-signal-500/30 bg-signal-500/10 text-signal-700 dark:text-signal-300" },
  deleted: { label: "Deleted", glyph: "D", class: "border-status-red/35 bg-status-red/10 text-status-red" },
  renamed: { label: "Renamed", glyph: "R", class: "border-ember-500/35 bg-ember-500/10 text-ember-600 dark:text-ember-500" },
};

const splitPath = (path: string): { dir: string; name: string } => {
  const index = path.lastIndexOf("/");
  if (index === -1) {
    return { dir: "", name: path };
  }
  return { dir: path.slice(0, index + 1), name: path.slice(index + 1) };
};

export const ChangesList: FunctionComponent<ChangesListProps> = ({ files, selectedPath, onSelect }) => {
  if (files.length === 0) {
    return (
      <div class="flex h-full flex-col items-center justify-center gap-3 p-6 text-center sm:p-10" role="status" aria-label="Changes list empty state">
        <div class="flex h-14 w-14 items-center justify-center rounded-2xl border border-signal-500/15 bg-signal-500/10 text-signal-500">
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
    <div class="dashboard-scrollbar flex h-full min-w-0 flex-col gap-1 overflow-y-auto p-2" role="list" aria-label="Changed files">
      {files.map((change) => {
        const meta = STATUS_META[change.status];
        const { dir, name } = splitPath(change.path);
        const isSelected = selectedPath === change.path;
        return (
          <button
            key={change.path}
            type="button"
            onClick={() => onSelect(change.path)}
            aria-label={`${meta.label} file ${change.path}, ${change.additions} additions and ${change.deletions} deletions`}
            title={change.path}
            class={`group flex w-full min-w-0 items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 ${
              isSelected
                ? "border-signal-500/30 bg-signal-500/[0.12] ring-1 ring-inset ring-signal-500/20"
                : "border-transparent hover:border-black/[0.06] hover:bg-black/[0.035] dark:hover:border-white/[0.07] dark:hover:bg-white/[0.05]"
            }`}
          >
            <span
              class={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border text-[11px] font-black ${meta.class}`}
              title={meta.label}
            >
              {meta.glyph}
            </span>
            <span class="min-w-0 flex-1">
              <span class="flex min-w-0 items-center gap-1.5">
                <span class="min-w-0 break-all text-[13px] font-semibold leading-5 text-slate-800 dark:text-slate-100">{name}</span>
              </span>
              {dir && <span class="mt-0.5 block min-w-0 break-all font-mono text-[11px] leading-4 text-slate-400 dark:text-slate-500">{dir}</span>}
              {change.oldPath && (
                <span class="mt-1 block min-w-0 break-all font-mono text-[10px] leading-4 text-slate-400 dark:text-slate-500">
                  from {change.oldPath}
                </span>
              )}
            </span>
            <span class="mt-1 flex shrink-0 items-center gap-2 font-mono text-[11px] tabular-nums" aria-hidden="true">
              {change.additions > 0 && <span class="text-status-green">+{change.additions}</span>}
              {change.deletions > 0 && <span class="text-status-red">−{change.deletions}</span>}
              <FileDiff class="h-3.5 w-3.5 text-slate-300 transition-colors group-hover:text-slate-500 dark:text-slate-600" strokeWidth={2} />
            </span>
          </button>
        );
      })}
    </div>
  );
};
