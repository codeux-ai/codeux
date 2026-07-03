import { FunctionComponent } from "preact";
import { CheckCircle2, Download, HardDrive, Loader2, Power, RefreshCw, Trash2, WifiOff } from "lucide-react";
import type { EmbeddingModelWithStatus } from "../../lib/memory-api.js";

function formatBytes(bytes: number): string {
  if (bytes < 1e6) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1e9) return `${(bytes / 1e6).toFixed(0)} MB`;
  return `${(bytes / 1e9).toFixed(1)} GB`;
}

function getStatusLabel(model: EmbeddingModelWithStatus): string {
  if (model.error) return "Unavailable";
  if (model.downloading) return "Downloading";
  if (model.active) return "Active";
  if (model.downloaded) return "Downloaded";
  return "Available";
}

function getStatusClass(model: EmbeddingModelWithStatus): string {
  if (model.error) return "border-status-red/25 bg-status-red/[0.08] text-status-red";
  if (model.downloading) return "border-signal-500/25 bg-signal-500/[0.1] text-signal-600 dark:text-signal-300";
  if (model.active) return "border-signal-500/30 bg-signal-500/[0.12] text-signal-700 dark:text-signal-300";
  if (model.downloaded) return "border-white/[0.1] bg-white/[0.05] text-slate-600 dark:text-slate-300";
  return "border-black/[0.06] bg-black/[0.03] text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-slate-400";
}

const actionLabelClass = "min-w-0 text-center leading-4";
const baseButtonClass = "inline-flex min-h-9 max-w-full min-w-0 items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.1em] transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/45 focus-visible:ring-offset-2 focus-visible:ring-offset-[#F9F8F4] disabled:cursor-not-allowed disabled:opacity-45 dark:focus-visible:ring-offset-void-900";
const signalButtonClass = `${baseButtonClass} bg-signal-500 text-void-950 shadow-[0_10px_24px_rgba(0,224,160,0.18)] hover:-translate-y-px hover:bg-signal-400 disabled:hover:translate-y-0 disabled:hover:bg-signal-500`;
const quietSignalButtonClass = `${baseButtonClass} border border-signal-500/20 bg-signal-500/[0.08] text-signal-700 hover:-translate-y-px hover:border-signal-500/35 hover:bg-signal-500/[0.14] dark:text-signal-300 disabled:hover:translate-y-0 disabled:hover:bg-signal-500/[0.08]`;
const emberButtonClass = `${baseButtonClass} border border-ember-500/25 bg-ember-500/[0.1] text-ember-600 hover:-translate-y-px hover:bg-ember-500/[0.16] dark:text-ember-400 disabled:hover:translate-y-0 disabled:hover:bg-ember-500/[0.1]`;
const deleteButtonClass = "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-transparent text-slate-400 transition-all duration-200 hover:border-status-red/20 hover:bg-status-red/[0.08] hover:text-status-red focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-status-red/35 focus-visible:ring-offset-2 focus-visible:ring-offset-[#F9F8F4] disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:border-transparent disabled:hover:bg-transparent disabled:hover:text-slate-400 dark:focus-visible:ring-offset-void-900";

export const ModelCard: FunctionComponent<{
  model: EmbeddingModelWithStatus;
  onDownload: (id: string) => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onReembed: () => void;
  reembedding: boolean;
  staleCount: number;
}> = ({ model, onDownload, onSelect, onDelete, onReembed, reembedding, staleCount }) => {
  const progress = Math.round(model.downloadProgress * 100);
  const statusLabel = getStatusLabel(model);
  const downloadDisabled = model.downloading || reembedding;
  const selectDisabled = model.downloading || reembedding;
  const reembedDisabled = model.downloading || reembedding;
  const deleteDisabled = model.downloading || reembedding || model.active;

  return (
    <article className={`group relative flex h-full min-h-[17rem] flex-col overflow-hidden rounded-[1.25rem] border p-4 shadow-[0_8px_24px_rgba(15,23,42,0.045)] backdrop-blur-2xl transition-all duration-200 focus-within:ring-2 focus-within:ring-signal-500/25 focus-within:ring-offset-2 focus-within:ring-offset-[#F9F8F4] dark:shadow-[0_12px_34px_rgba(0,0,0,0.22)] dark:focus-within:ring-offset-void-900 ${
      model.active
        ? "border-signal-500/25 bg-signal-500/[0.06] dark:bg-signal-500/[0.05]"
        : model.error
          ? "border-status-red/20 bg-status-red/[0.035]"
          : "border-black/[0.06] bg-white/68 dark:border-white/[0.06] dark:bg-void-800/58"
    }`}>
      <div className="flex flex-1 flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 gap-2.5">
            <div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${
              model.error
                ? "border-status-red/20 bg-status-red/[0.08] text-status-red"
                : "border-signal-500/20 bg-signal-500/[0.1] text-signal-600 dark:text-signal-300"
            }`}>
              {model.error ? <WifiOff className="h-4 w-4" strokeWidth={2.2} /> : <HardDrive className="h-4 w-4" strokeWidth={2.2} />}
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-black leading-tight tracking-tight text-slate-900 dark:text-white">
                {model.displayName}
              </h3>
              <p className="mt-1.5 line-clamp-2 text-xs leading-5 text-slate-500 dark:text-slate-400">
                {model.description}
              </p>
            </div>
          </div>
          <span className={`inline-flex max-w-[9rem] shrink-0 items-center justify-center gap-1.5 rounded-full border px-2.5 py-1 text-center text-[9px] font-bold uppercase leading-3 tracking-[0.12em] ${getStatusClass(model)}`}>
            {model.active && <CheckCircle2 className="h-3 w-3" strokeWidth={2.4} />}
            {model.downloading && <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2.4} />}
            {statusLabel}
          </span>
        </div>

        <dl className="grid grid-cols-3 gap-1.5">
          <div className="rounded-xl border border-black/[0.04] bg-black/[0.025] px-2.5 py-2 dark:border-white/[0.05] dark:bg-white/[0.03]">
            <dt className="text-[9px] font-bold uppercase tracking-[0.12em] text-slate-400">Dim</dt>
            <dd className="mt-0.5 break-words font-mono text-xs font-semibold text-slate-700 dark:text-slate-200">{model.dimension}d</dd>
          </div>
          <div className="rounded-xl border border-black/[0.04] bg-black/[0.025] px-2.5 py-2 dark:border-white/[0.05] dark:bg-white/[0.03]">
            <dt className="text-[9px] font-bold uppercase tracking-[0.12em] text-slate-400">Size</dt>
            <dd className="mt-0.5 break-words font-mono text-xs font-semibold text-slate-700 dark:text-slate-200">{formatBytes(model.sizeBytes)}</dd>
          </div>
          <div className="rounded-xl border border-black/[0.04] bg-black/[0.025] px-2.5 py-2 dark:border-white/[0.05] dark:bg-white/[0.03]">
            <dt className="text-[9px] font-bold uppercase tracking-[0.12em] text-slate-400">Lang</dt>
            <dd className="mt-0.5 truncate font-mono text-xs font-semibold text-slate-700 dark:text-slate-200">{model.language}</dd>
          </div>
        </dl>

        <div className="min-h-[3.25rem]">
          {model.downloading && (
            <div className="rounded-xl border border-signal-500/15 bg-signal-500/[0.06] p-3">
              <div className="flex items-center justify-between gap-3">
                <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-signal-700 dark:text-signal-300">
                  <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2.4} />
                  Downloading
                </span>
                <span className="font-mono text-[10px] font-semibold text-signal-700 dark:text-signal-300">{progress}%</span>
              </div>
              <div className="mt-2.5 h-2 w-full overflow-hidden rounded-full bg-black/[0.06] dark:bg-white/[0.08]" role="progressbar" aria-label={`${model.displayName} download progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
                <div className="h-full rounded-full bg-signal-500 transition-all duration-300" style={{ width: `${progress}%` }} />
              </div>
            </div>
          )}
          {model.active && staleCount > 0 && !model.downloading && (
            <div className="rounded-xl border border-ember-500/20 bg-ember-500/[0.07] p-3">
              <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-ember-600 dark:text-ember-400">
                {staleCount} {staleCount === 1 ? "stale memory" : "stale memories"}
              </p>
              <p className="mt-1 text-[11px] leading-4 text-ember-600/75 dark:text-ember-400/70">
                Re-embed to align stored vectors with this active model.
              </p>
            </div>
          )}
          {model.error && !model.downloading && (
            <p className="rounded-xl border border-status-red/15 bg-status-red/[0.06] p-3 text-[11px] font-medium leading-4 text-status-red">
              {model.error}
            </p>
          )}
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2 border-t border-black/[0.05] pt-3 dark:border-white/[0.06]">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
          {!model.downloaded && !model.downloading && (
            <button type="button" onClick={() => onDownload(model.id)}
              disabled={downloadDisabled}
              aria-disabled={downloadDisabled}
              className={signalButtonClass}>
              <Download className="h-3.5 w-3.5 shrink-0" strokeWidth={2.5} />
              <span className={actionLabelClass}>Download</span>
            </button>
          )}
          {model.downloaded && !model.active && (
            <button type="button" onClick={() => onSelect(model.id)}
              disabled={selectDisabled}
              aria-disabled={selectDisabled}
              className={quietSignalButtonClass}>
              <Power className="h-3.5 w-3.5 shrink-0" strokeWidth={2.5} />
              <span className={actionLabelClass}>Activate</span>
            </button>
          )}
          {model.active && !reembedding && (
            <button type="button" onClick={onReembed}
              disabled={reembedDisabled}
              aria-disabled={reembedDisabled}
              className={staleCount > 0 ? emberButtonClass : quietSignalButtonClass}>
              <RefreshCw className="h-3.5 w-3.5 shrink-0" strokeWidth={2.5} />
              <span className={actionLabelClass}>Re-embed{staleCount > 0 ? ` ${staleCount}` : " All"}</span>
            </button>
          )}
          {model.active && reembedding && (
            <span className={`${baseButtonClass} border border-signal-500/20 bg-signal-500/[0.08] text-signal-700 dark:text-signal-300`}>
              <RefreshCw className="h-3.5 w-3.5 shrink-0 animate-spin" strokeWidth={2.5} />
              <span className={actionLabelClass}>Re-embedding</span>
            </span>
          )}
        </div>
        {model.downloaded && (
          <button type="button" onClick={() => onDelete(model.id)}
            disabled={deleteDisabled}
            aria-label={model.active ? `Delete ${model.displayName} disabled while active` : `Delete ${model.displayName}`}
            aria-disabled={deleteDisabled}
            className={deleteButtonClass}>
            <Trash2 className="h-4 w-4" strokeWidth={2} />
          </button>
        )}
      </div>
    </article>
  );
};
