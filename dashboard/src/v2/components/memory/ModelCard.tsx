import { FunctionComponent } from "preact";
import { HardDrive, Download, Power, RefreshCw, Trash2, Loader2 } from "lucide-react";
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
}> = ({ model, onDownload, onSelect, onDelete, onReembed, reembedding, staleCount }) => (
    <div className="flex flex-col gap-3 p-4 rounded-[1.25rem]
                   bg-white/60 dark:bg-void-800/50 backdrop-blur-xl
                   border border-black/[0.06] dark:border-white/[0.06]
                   shadow-[0_2px_12px_rgba(0,0,0,0.04)] dark:shadow-[0_2px_12px_rgba(0,0,0,0.2)]">
        <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
                <HardDrive className="w-4 h-4 text-signal-500" strokeWidth={2} />
                <span className="text-sm font-bold text-slate-800 dark:text-white">{model.displayName}</span>
            </div>
            {model.active && (
                <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-signal-500 bg-signal-500/10 px-2 py-0.5 rounded-full">Active</span>
            )}
        </div>
        <p className="text-[11px] text-slate-500 leading-relaxed">{model.description}</p>
        <div className="flex items-center gap-3 text-[10px] font-mono text-slate-400">
            <span>{model.dimension}d</span>
            <span>{formatBytes(model.sizeBytes)}</span>
            <span>{model.language}</span>
        </div>
        {model.downloading && (
            <div className="flex flex-col gap-1.5">
                <div className="h-1.5 w-full bg-black/[0.06] dark:bg-white/[0.06] rounded-full overflow-hidden">
                    <div className="h-full rounded-full bg-signal-500 transition-all duration-300"
                        style={{ width: `${Math.round(model.downloadProgress * 100)}%` }} />
                </div>
                <span className="text-[9px] font-mono text-slate-400 flex items-center gap-1.5">
                    <Loader2 className="w-3 h-3 animate-spin" strokeWidth={2} />
                    Downloading {Math.round(model.downloadProgress * 100)}%
                </span>
            </div>
        )}
        <div className="flex items-center gap-2 pt-1">
            {!model.downloaded && !model.downloading && (
                <button onClick={() => onDownload(model.id)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold
                               bg-signal-500 text-void-900 hover:bg-signal-400 transition-colors duration-200
                               shadow-[0_2px_8px_rgba(0,224,160,0.25)]">
                    <Download className="w-3 h-3" strokeWidth={2.5} />
                    Download
                </button>
            )}
            {model.downloaded && !model.active && (
                <button onClick={() => onSelect(model.id)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold
                               bg-signal-500/10 text-signal-500 hover:bg-signal-500/20 transition-colors duration-200">
                    <Power className="w-3 h-3" strokeWidth={2.5} />
                    Activate
                </button>
            )}
            {model.active && !reembedding && (
                <button onClick={onReembed}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold
                               bg-signal-500/10 text-signal-500 hover:bg-signal-500/20 transition-colors duration-200">
                    <RefreshCw className="w-3 h-3" strokeWidth={2.5} />
                    Re-embed{staleCount > 0 ? ` (${staleCount} stale)` : " All"}
                </button>
            )}
            {model.active && reembedding && (
                <span className="flex items-center gap-1.5 text-[11px] font-bold text-signal-500">
                    <RefreshCw className="w-3 h-3 animate-spin" strokeWidth={2.5} />
                    Re-embedding…
                </span>
            )}
            {model.downloaded && (
                <button onClick={() => onDelete(model.id)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold
                               text-slate-400 hover:text-status-red transition-colors duration-200">
                    <Trash2 className="w-3 h-3" strokeWidth={2} />
                </button>
            )}
            {model.error && (
                <span className="text-[10px] text-status-red font-medium">{model.error}</span>
            )}
        </div>
    </div>
);
