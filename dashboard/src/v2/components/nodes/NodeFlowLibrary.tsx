import type { FunctionComponent } from "preact";
import { Plus, Trash2, Workflow } from "lucide-preact";
import type { NodeFlowRecord } from "../../types.js";
import { summarizeNodeFlow } from "../../lib/node-flow-view-models.js";

interface NodeFlowLibraryProps {
  flows: NodeFlowRecord[];
  selectedFlowId: string | null;
  loading?: boolean;
  onSelect: (flowId: string) => void;
  onCreate: () => void;
  onDelete: (flowId: string) => void;
}

export const NodeFlowLibrary: FunctionComponent<NodeFlowLibraryProps> = ({
  flows,
  selectedFlowId,
  loading = false,
  onSelect,
  onCreate,
  onDelete,
}) => {
  return (
    <aside className="flex min-w-0 flex-col gap-3 xl:w-[320px] xl:shrink-0">
      <div className="flex items-center justify-between gap-3 px-1">
        <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
          {flows.length} Flow{flows.length === 1 ? "" : "s"}
        </span>
        <button
          type="button"
          onClick={onCreate}
          className="inline-flex items-center gap-2 rounded-full bg-signal-500 px-3 py-1.5 text-xs font-bold text-white shadow-sm transition hover:bg-signal-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/40 dark:text-void-900"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          New
        </button>
      </div>
      {loading ? (
        <div role="status" aria-live="polite" className="rounded-2xl border border-black/[0.06] bg-white/60 p-4 text-sm text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.04]">
          Loading flows…
        </div>
      ) : flows.length === 0 ? (
        <button
          type="button"
          onClick={onCreate}
          className="flex min-h-48 flex-col items-center justify-center gap-3 rounded-[1.6rem] border border-dashed border-black/[0.08] bg-white/45 p-6 text-center transition hover:border-signal-500/40 hover:bg-signal-500/[0.05] focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/40 dark:border-white/[0.08] dark:bg-white/[0.03]"
        >
          <Workflow className="h-9 w-9 text-signal-500" strokeWidth={1.6} aria-hidden="true" />
          <span className="text-sm font-bold text-slate-800 dark:text-slate-100">Create Node Flow</span>
          <span className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">Project workflow drafts appear here.</span>
        </button>
      ) : (
        <div className="flex flex-col gap-2.5">
          {flows.map((flow) => {
            const summary = summarizeNodeFlow(flow);
            const selected = flow.id === selectedFlowId;
            return (
              <div
                key={flow.id}
                className={`group grid grid-cols-[minmax(0,1fr)_2rem] gap-2 rounded-[1.25rem] border p-3 transition ${
                  selected
                    ? "border-signal-500/45 bg-signal-500/[0.08]"
                    : "border-black/[0.06] bg-white/60 hover:border-signal-500/25 dark:border-white/[0.06] dark:bg-white/[0.035]"
                }`}
              >
                <button
                  type="button"
                  onClick={() => onSelect(flow.id)}
                  className="min-w-0 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/40"
                  aria-current={selected ? "true" : undefined}
                >
                  <span className="block truncate text-sm font-bold text-slate-900 dark:text-white">{summary.title}</span>
                  <span className="mt-1 line-clamp-2 text-xs leading-relaxed text-slate-500 dark:text-slate-400">{summary.description}</span>
                  <span className="mt-3 flex flex-wrap gap-2 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">
                    <span>{summary.nodeCount} nodes</span>
                    <span>{summary.edgeCount} edges</span>
                    <span>{summary.versionLabel}</span>
                  </span>
                </button>
                <button
                  type="button"
                  aria-label={`Delete node flow ${flow.title}`}
                  onClick={() => onDelete(flow.id)}
                  className="flex h-8 w-8 items-center justify-center rounded-xl text-slate-400 transition hover:bg-status-red/[0.08] hover:text-status-red focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/40"
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </aside>
  );
};
