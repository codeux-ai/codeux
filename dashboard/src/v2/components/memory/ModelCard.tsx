import { FunctionComponent } from "preact";
import { HardDrive, Download, Power, RefreshCw, Trash2, Loader2 } from "lucide-preact";
import type { EmbeddingModelWithStatus } from "../../lib/memory-api.js";

function formatBytes(bytes: number): string {
    if (bytes < 1e6) return `${(bytes / 1024).toFixed(0)} KB`;
    if (bytes < 1e9) return `${(bytes / 1e6).toFixed(0)} MB`;
    return `${(bytes / 1e9).toFixed(1)} GB`;
}

export const ModelCard: FunctionComponent<{
    model: EmbeddingModelWithStatus;
    onDownload: (id: string) => void;
    onSelect: (id: string) => void;
    onDelete: (id: string) => void;
    onReembed: () => void;
    reembedding: boolean;
    staleCount: number;
}> = ({ model, onDownload, onSelect, onDelete, onReembed, reembedding, staleCount }) => {
    const progressPercent = Math.round(model.downloadProgress * 100);
    const statusLabel = model.active ? "Active" : model.downloaded ? "Ready" : model.downloading ? "Downloading" : "Available";
    return (
    <div className="flex flex-col gap-3 rounded-lg border border-black/[0.08] bg-white/70 p-4 shadow-[0_4px_18px_rgba(15,23,42,0.06)] backdrop-blur-xl dark:border-white/[0.08] dark:bg-void-800/55 dark:shadow-[0_4px_18px_rgba(0,0,0,0.22)]">
        <div className="flex items-center justify-between">
            <div className="flex flex-1 items-center gap-2 min-w-0">
                <HardDrive className="w-4 h-4 text-signal-500" strokeWidth={2} />
                <span className="text-sm font-bold text-slate-800 dark:text-white truncate block min-w-0">{model.displayName}</span>
            </div>
            <span className={`rounded-md px-2 py-1 text-[9px] font-bold uppercase tracking-[0.14em] ${
                model.active
                    ? "bg-signal-500/10 text-signal-500"
                    : model.downloading
                        ? "bg-sky-500/10 text-sky-500"
                        : "bg-black/[0.04] text-slate-500 dark:bg-white/[0.05] dark:text-slate-400"
            }`}>{statusLabel}</span>
        </div>
        <p className="text-[11px] text-slate-500 leading-relaxed">{model.description}</p>
        <div className="grid grid-cols-3 gap-2 text-[10px] font-mono text-slate-500 dark:text-slate-400">
            <span className="rounded-md bg-black/[0.035] px-2 py-1 dark:bg-white/[0.04]">{model.dimension}d</span>
            <span className="rounded-md bg-black/[0.035] px-2 py-1 dark:bg-white/[0.04]">{formatBytes(model.sizeBytes)}</span>
            <span className="truncate rounded-md bg-black/[0.035] px-2 py-1 dark:bg-white/[0.04]">{model.language}</span>
        </div>
        {model.downloading && (
            <div className="flex flex-col gap-1.5 rounded-lg border border-sky-500/15 bg-sky-500/[0.06] p-3">
                <div className="h-1.5 w-full bg-black/[0.06] dark:bg-white/[0.06] rounded-full overflow-hidden">
                    <div className="h-full rounded-full bg-sky-500 transition-all duration-300"
                        style={{ width: `${progressPercent}%` }} />
                </div>
                <span className="flex items-center gap-1.5 text-[10px] font-mono text-sky-600 dark:text-sky-300">
                    <Loader2 className="w-3 h-3 animate-spin" strokeWidth={2} />
                    Downloading model files {progressPercent}%
                </span>
            </div>
        )}
        <div className="flex flex-wrap items-center gap-2 pt-1">
            {!model.downloaded && !model.downloading && (
                <button onClick={() => onDownload(model.id)}
                    disabled={model.downloading || reembedding}
                    aria-disabled={model.downloading || reembedding}
                    className="flex items-center gap-1.5 rounded-lg bg-signal-500 px-3 py-1.5 text-[11px] font-bold text-white shadow-[0_2px_8px_rgba(0,224,160,0.2)] transition-colors duration-200 hover:bg-signal-400 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-signal-500">
                    <Download className="w-3 h-3" strokeWidth={2.5} />
                    Download
                </button>
            )}
            {model.downloaded && !model.active && (
                <button onClick={() => onSelect(model.id)}
                    disabled={model.downloading || reembedding}
                    aria-disabled={model.downloading || reembedding}
                    className="flex items-center gap-1.5 rounded-lg bg-signal-500/10 px-3 py-1.5 text-[11px] font-bold text-signal-500 transition-colors duration-200 hover:bg-signal-500/20 disabled:cursor-not-allowed disabled:opacity-50">
                    <Power className="w-3 h-3" strokeWidth={2.5} />
                    Activate
                </button>
            )}
            {model.active && !reembedding && (
                <button onClick={onReembed}
                    disabled={model.downloading || reembedding}
                    aria-disabled={model.downloading || reembedding}
                    className="flex items-center gap-1.5 rounded-lg bg-amber-500/10 px-3 py-1.5 text-[11px] font-bold text-amber-600 transition-colors duration-200 hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-50 dark:text-amber-400">
                    <RefreshCw className="w-3 h-3" strokeWidth={2.5} />
                    Re-embed{staleCount > 0 ? ` (${staleCount} stale)` : " All"}
                </button>
            )}
            {model.active && reembedding && (
                <span className="flex items-center gap-1.5 rounded-lg bg-signal-500/10 px-3 py-1.5 text-[11px] font-bold text-signal-500">
                    <RefreshCw className="w-3 h-3 animate-spin" strokeWidth={2.5} />
                    Re-embedding…
                </span>
            )}
            {model.downloaded && (
                <button onClick={() => onDelete(model.id)}
                    disabled={model.downloading || reembedding || model.active}
                    aria-label={`Delete ${model.displayName}`}
                    aria-disabled={model.downloading || reembedding || model.active}
                    className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-bold text-slate-400 transition-colors duration-200 hover:bg-rose-500/10 hover:text-rose-500 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-slate-400">
                    <Trash2 className="w-3 h-3" strokeWidth={2} />
                </button>
            )}
            {model.error && (
                <span role="status" className="rounded-md border border-rose-500/20 bg-rose-500/10 px-2 py-1 text-[10px] font-medium text-rose-500">{model.error}</span>
            )}
        </div>
    </div>
    );
};
