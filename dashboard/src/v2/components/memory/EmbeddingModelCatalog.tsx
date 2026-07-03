import type { FunctionComponent } from "preact";
import { AlertTriangle, Boxes, CheckCircle2, Loader2, RefreshCw } from "lucide-react";
import type { EmbeddingModelWithStatus, MemoryStats, ReembedProgress } from "../../lib/memory-api.js";
import { ModelCard } from "./ModelCard.js";

interface EmbeddingModelCatalogProps {
  models: EmbeddingModelWithStatus[];
  stats: MemoryStats;
  reembed: ReembedProgress | null;
  onDownload: (id: string) => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onReembed: () => void;
}

export const EmbeddingModelCatalog: FunctionComponent<EmbeddingModelCatalogProps> = ({
  models,
  stats,
  reembed,
  onDownload,
  onSelect,
  onDelete,
  onReembed,
}) => {
  const downloadedCount = models.filter((model) => model.downloaded).length;
  const downloadingCount = models.filter((model) => model.downloading).length;
  const activeModel = models.find((model) => model.active);

  return (
    <section aria-labelledby="embedding-model-catalog-title" className="relative overflow-hidden rounded-[2rem] border border-black/[0.06] bg-white/72 p-4 shadow-[0_18px_48px_rgba(15,23,42,0.07)] backdrop-blur-2xl dark:border-white/[0.06] dark:bg-void-800/62 dark:shadow-[0_18px_48px_rgba(0,0,0,0.3)] md:p-6">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-signal-500/35 to-transparent" />
      <div className="relative z-10 flex flex-col gap-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex min-w-0 gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-signal-500/20 bg-signal-500/[0.1] text-signal-600 shadow-[0_0_30px_rgba(0,224,160,0.12)] dark:text-signal-300">
              <Boxes className="h-5 w-5" strokeWidth={2.2} />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-signal-600 dark:text-signal-400">
                Local embeddings
              </p>
              <h2 id="embedding-model-catalog-title" className="mt-1 text-xl font-black tracking-tight text-slate-900 dark:text-white">
                Embedding model catalog
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500 dark:text-slate-400">
                Download compatible ONNX models, activate the local embedding runtime, and re-embed stale memories when model dimensions change.
              </p>
            </div>
          </div>

          <dl className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-end">
            <div className="rounded-2xl border border-black/[0.05] bg-black/[0.025] px-4 py-3 dark:border-white/[0.06] dark:bg-white/[0.03]">
              <dt className="text-[9px] font-bold uppercase tracking-[0.16em] text-slate-400">Available</dt>
              <dd className="mt-1 font-mono text-sm font-semibold text-slate-800 dark:text-slate-100">{models.length}</dd>
            </div>
            <div className="rounded-2xl border border-signal-500/15 bg-signal-500/[0.07] px-4 py-3">
              <dt className="text-[9px] font-bold uppercase tracking-[0.16em] text-signal-700/70 dark:text-signal-300/70">Downloaded</dt>
              <dd className="mt-1 font-mono text-sm font-semibold text-signal-700 dark:text-signal-300">{downloadedCount}</dd>
            </div>
            <div className="rounded-2xl border border-ember-500/20 bg-ember-500/[0.07] px-4 py-3">
              <dt className="text-[9px] font-bold uppercase tracking-[0.16em] text-ember-600/75 dark:text-ember-400/75">Stale</dt>
              <dd className="mt-1 font-mono text-sm font-semibold text-ember-600 dark:text-ember-400">{stats.staleEmbeddings}</dd>
            </div>
            <div className="rounded-2xl border border-black/[0.05] bg-black/[0.025] px-4 py-3 dark:border-white/[0.06] dark:bg-white/[0.03]">
              <dt className="text-[9px] font-bold uppercase tracking-[0.16em] text-slate-400">Active</dt>
              <dd className="mt-1 max-w-[9rem] truncate font-mono text-sm font-semibold text-slate-800 dark:text-slate-100">
                {activeModel?.displayName ?? "None"}
              </dd>
            </div>
          </dl>
        </div>

        {downloadingCount > 0 && (
          <div className="flex items-center gap-3 rounded-2xl border border-signal-500/18 bg-signal-500/[0.07] px-4 py-3 text-signal-700 dark:text-signal-300" role="status" aria-live="polite">
            <Loader2 className="h-4 w-4 shrink-0 animate-spin" strokeWidth={2.4} />
            <p className="text-xs font-bold">
              {downloadingCount} {downloadingCount === 1 ? "model is" : "models are"} downloading.
            </p>
          </div>
        )}

        {stats.staleEmbeddings > 0 && !reembed?.active && (
          <div className="flex flex-col gap-3 rounded-2xl border border-ember-500/22 bg-ember-500/[0.07] px-4 py-4 text-ember-600 dark:text-ember-400 sm:flex-row sm:items-center">
            <AlertTriangle className="h-4 w-4 shrink-0" strokeWidth={2.4} />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold">
                {stats.staleEmbeddings} {stats.staleEmbeddings === 1 ? "memory needs" : "memories need"} re-embedding.
              </p>
              <p className="mt-1 text-[11px] leading-4 text-ember-600/75 dark:text-ember-400/70">
                These memories were embedded with a different model and stay out of semantic search until vectors are rebuilt.
              </p>
            </div>
            <button type="button" onClick={onReembed}
              className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-xl border border-ember-500/25 bg-ember-500/[0.12] px-4 py-2 text-[11px] font-bold uppercase tracking-[0.12em] text-ember-600 transition-all duration-200 hover:-translate-y-px hover:bg-ember-500/[0.18] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/45 focus-visible:ring-offset-2 focus-visible:ring-offset-[#F9F8F4] dark:text-ember-400 dark:focus-visible:ring-offset-void-900">
              <RefreshCw className="h-3.5 w-3.5" strokeWidth={2.5} />
              Re-embed All
            </button>
          </div>
        )}

        {reembed?.active && (
          <div className="flex items-center gap-3 rounded-2xl border border-signal-500/18 bg-signal-500/[0.07] px-4 py-3 text-signal-700 dark:text-signal-300" role="status" aria-live="polite">
            <Loader2 className="h-4 w-4 shrink-0 animate-spin" strokeWidth={2.4} />
            <p className="text-xs font-bold">
              Re-embedding memories: {reembed.completed}/{reembed.total}
            </p>
          </div>
        )}

        {reembed && !reembed.active && reembed.completed > 0 && stats.staleEmbeddings === 0 && (
          <div className="flex items-center gap-3 rounded-2xl border border-signal-500/18 bg-signal-500/[0.07] px-4 py-3 text-signal-700 dark:text-signal-300" role="status" aria-live="polite">
            <CheckCircle2 className="h-4 w-4 shrink-0" strokeWidth={2.4} />
            <p className="text-xs font-bold">
              Re-embedding complete: {reembed.completed} {reembed.completed === 1 ? "memory" : "memories"} updated.
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3">
          {models.map((model) => (
            <ModelCard key={model.id} model={model}
              onDownload={onDownload}
              onSelect={onSelect}
              onDelete={onDelete}
              onReembed={onReembed}
              reembedding={!!reembed?.active}
              staleCount={stats.staleEmbeddings} />
          ))}
          {models.length === 0 && (
            <p className="rounded-[1.5rem] border border-dashed border-black/[0.08] bg-black/[0.02] px-6 py-12 text-center text-sm font-medium text-slate-400 dark:border-white/[0.08] dark:bg-white/[0.02] lg:col-span-2">
              Loading embedding models...
            </p>
          )}
        </div>
      </div>
    </section>
  );
};
