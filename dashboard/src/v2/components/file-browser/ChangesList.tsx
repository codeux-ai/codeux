import type { FunctionComponent } from "preact";
import { FileDiff, GitCompare } from "lucide-preact";
import type { FileBrowserChange, FileBrowserChangeStatus } from "../../../types.js";

interface ChangesListProps {
  files: FileBrowserChange[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
}

const STATUS_META: Record<FileBrowserChangeStatus, { label: string; glyph: string; class: string }> = {
  added: { label: "Added", glyph: "A", class: "bg-status-green/15 text-status-green border-status-green/30" },
  modified: { label: "Modified", glyph: "M", class: "bg-sky-500/15 text-sky-500 border-sky-500/30" },
  deleted: { label: "Deleted", glyph: "D", class: "bg-status-red/15 text-status-red border-status-red/30" },
  renamed: { label: "Renamed", glyph: "R", class: "bg-violet-500/15 text-violet-400 border-violet-500/30" },
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
      <div class="flex h-full flex-col items-center justify-center gap-3 p-10 text-center">
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
    <div class="flex h-full flex-col overflow-y-auto dashboard-scrollbar p-2">
      {files.map((change) => {
        const meta = STATUS_META[change.status];
        const { dir, name } = splitPath(change.path);
        const isSelected = selectedPath === change.path;
        return (
          <button
            key={change.path}
            type="button"
            onClick={() => onSelect(change.path)}
            class={`group flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors ${
              isSelected
                ? "bg-signal-500/12 ring-1 ring-inset ring-signal-500/25"
                : "hover:bg-black/[0.04] dark:hover:bg-white/[0.05]"
            }`}
          >
            <span
              class={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border text-[11px] font-black ${meta.class}`}
              title={meta.label}
            >
              {meta.glyph}
            </span>
            <span class="min-w-0 flex-1">
              <span class="flex items-center gap-1.5 truncate">
                <span class="truncate text-[13px] font-semibold text-slate-800 dark:text-slate-100">{name}</span>
              </span>
              {dir && <span class="block truncate font-mono text-[11px] text-slate-400 dark:text-slate-500">{dir}</span>}
            </span>
            <span class="flex shrink-0 items-center gap-2 font-mono text-[11px]">
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
