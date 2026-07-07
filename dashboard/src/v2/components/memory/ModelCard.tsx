import { FunctionComponent } from "preact";
import { useRef, useState } from "preact/hooks";
import { CheckCircle2, Download, HardDrive, Loader2, Power, RefreshCw, Trash2, WifiOff } from "lucide-react";
import { useInteractionTokens } from "../../lib/motion/index.js";
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
const baseButtonClass = "inline-flex min-h-9 max-w-full min-w-0 items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.1em] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/45 focus-visible:ring-offset-2 focus-visible:ring-offset-[#F9F8F4] disabled:cursor-not-allowed disabled:opacity-45 dark:focus-visible:ring-offset-void-900";
const signalButtonClass = `${baseButtonClass} bg-signal-500 text-white dark:text-void-950 shadow-[0_10px_24px_rgba(0,224,160,0.18)] hover:-translate-y-px hover:bg-signal-400 disabled:hover:translate-y-0 disabled:hover:bg-signal-500`;
const quietSignalButtonClass = `${baseButtonClass} border border-signal-500/20 bg-signal-500/[0.08] text-signal-700 hover:-translate-y-px hover:border-signal-500/35 hover:bg-signal-500/[0.14] dark:text-signal-300 disabled:hover:translate-y-0 disabled:hover:bg-signal-500/[0.08]`;
const emberButtonClass = `${baseButtonClass} border border-ember-500/25 bg-ember-500/[0.1] text-ember-600 hover:-translate-y-px hover:bg-ember-500/[0.16] dark:text-ember-400 disabled:hover:translate-y-0 disabled:hover:bg-ember-500/[0.1]`;
const deleteButtonClass = "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-transparent text-slate-400 transition-all hover:border-status-red/20 hover:bg-status-red/[0.08] hover:text-status-red focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-status-red/35 focus-visible:ring-offset-2 focus-visible:ring-offset-[#F9F8F4] disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:border-transparent disabled:hover:bg-transparent disabled:hover:text-slate-400 dark:focus-visible:ring-offset-void-900";

export const ModelCard: FunctionComponent<{
  model: EmbeddingModelWithStatus;
  onDownload: (id: string) => void | Promise<void>;
  onSelect: (id: string) => void | Promise<void>;
  onDelete: (id: string) => void | Promise<void>;
  onReembed: () => void | Promise<void>;
  reembedding: boolean;
  staleCount: number;
  actionPending?: "download" | "select" | "delete" | "reembed" | null;
  actionBlocked?: boolean;
}> = ({ model, onDownload, onSelect, onDelete, onReembed, reembedding, staleCount, actionPending = null, actionBlocked = false }) => {
  const interactionTokens = useInteractionTokens();
  const [localPendingAction, setLocalPendingAction] = useState<"download" | "select" | "delete" | "reembed" | null>(null);
  const activationLockRef = useRef(false);
  const progress = Math.round(model.downloadProgress * 100);
  const statusLabel = getStatusLabel(model);
  const pendingAction = actionPending ?? localPendingAction;
  const hasPendingAction = Boolean(pendingAction);
  const isBlockedByOtherAction = actionBlocked && !hasPendingAction;
  const downloadDisabled = model.downloading || reembedding || hasPendingAction || isBlockedByOtherAction;
  const selectDisabled = model.downloading || reembedding || hasPendingAction || isBlockedByOtherAction;
  const reembedDisabled = model.downloading || reembedding || hasPendingAction || isBlockedByOtherAction;
  const deleteDisabled = model.downloading || reembedding || model.active || hasPendingAction || isBlockedByOtherAction;
  const controlTransitionStyle = {
    transitionDuration: interactionTokens.controlFeedback.duration,
    transitionTimingFunction: interactionTokens.controlFeedback.ease,
  };
  const asyncTransitionStyle = {
    transitionDuration: interactionTokens.asyncFeedback.duration,
    transitionTimingFunction: interactionTokens.asyncFeedback.ease,
  };
  const cardStatusId = `model-card-status-${model.id}`;
  const actionReasonId = `model-action-reason-${model.id}`;
  const progressText = `Download progress ${progress}%.`;
  const activePendingLabel = pendingAction === "download"
    ? "Download request pending."
    : pendingAction === "select"
      ? "Activation request pending."
      : pendingAction === "delete"
        ? "Delete confirmation or request pending."
        : pendingAction === "reembed"
          ? "Re-embed request pending."
          : "";
  const disabledReason = model.downloading
    ? "Model download is in progress."
    : reembedding
      ? "Memory re-embedding is in progress."
      : isBlockedByOtherAction
        ? "Another model action is pending. Wait for it to finish before starting a new action."
      : activePendingLabel;
  const cardActionCopy = model.active && model.downloaded
    ? "Active model. Re-embed is available; deletion is disabled until another model is activated."
    : disabledReason;

  const runAction = async (action: "download" | "select" | "delete" | "reembed", callback: () => void | Promise<void>): Promise<void> => {
    if (activationLockRef.current || localPendingAction || actionPending || actionBlocked) {
      return;
    }

    activationLockRef.current = true;
    setLocalPendingAction(action);
    try {
      await callback();
    } finally {
      setLocalPendingAction(null);
      window.setTimeout(() => {
        activationLockRef.current = false;
      }, 0);
    }
  };

  return (
    <article
      aria-describedby={`${cardStatusId} ${actionReasonId}`}
      aria-busy={model.downloading || reembedding || hasPendingAction}
      className={`group relative flex h-full min-h-[17rem] flex-col overflow-hidden rounded-[1.25rem] border p-4 shadow-[0_8px_24px_rgba(15,23,42,0.045)] backdrop-blur-2xl transition-all focus-within:ring-2 focus-within:ring-signal-500/25 focus-within:ring-offset-2 focus-within:ring-offset-[#F9F8F4] dark:shadow-[0_12px_34px_rgba(0,0,0,0.22)] dark:focus-within:ring-offset-void-900 ${
      model.active
        ? "border-signal-500/25 bg-signal-500/[0.06] dark:bg-signal-500/[0.05]"
        : model.error
          ? "border-status-red/20 bg-status-red/[0.035]"
          : "border-black/[0.06] bg-white/68 dark:border-white/[0.06] dark:bg-void-800/58"
    }`}
      style={controlTransitionStyle}
    >
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
              <h3 className="text-sm font-semibold leading-tight tracking-tight text-slate-900 dark:text-white">
                {model.displayName}
              </h3>
              <p className="mt-1.5 line-clamp-2 text-xs leading-5 text-slate-500 dark:text-slate-400">
                {model.description}
              </p>
            </div>
          </div>
          <span className={`inline-flex max-w-[9rem] shrink-0 items-center justify-center gap-1.5 rounded-full border px-2.5 py-1 text-center text-[9px] font-bold uppercase leading-3 tracking-[0.12em] transition-[background-color,border-color,color] ${getStatusClass(model)}`} style={controlTransitionStyle}>
            {model.active && <CheckCircle2 className="h-3 w-3" strokeWidth={2.4} />}
            {model.downloading && <Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" strokeWidth={2.4} />}
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

        <div className="min-h-[3.25rem]" id={cardStatusId} aria-live="polite" aria-atomic="true">
          {model.downloading && (
            <div className="rounded-xl border border-signal-500/15 bg-signal-500/[0.06] p-3">
              <div className="flex items-center justify-between gap-3">
                <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-signal-700 dark:text-signal-300">
                  <Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" strokeWidth={2.4} />
                  Downloading
                </span>
                <span className="font-mono text-[10px] font-semibold text-signal-700 dark:text-signal-300">{progress}%</span>
              </div>
              <div className="mt-2.5 h-2 w-full overflow-hidden rounded-full bg-black/[0.06] dark:bg-white/[0.08]" role="progressbar" aria-label={`${model.displayName} download progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
                <div className="h-full rounded-full bg-signal-500 transition-[width]" style={{ ...asyncTransitionStyle, width: `${progress}%` }} />
              </div>
              <p className="mt-2 text-[11px] font-medium leading-4 text-signal-700/75 dark:text-signal-300/75">{progressText}</p>
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
          {!model.downloading && !model.active && !model.error && model.downloaded && (
            <p className="rounded-xl border border-black/[0.04] bg-black/[0.025] p-3 text-[11px] font-medium leading-4 text-slate-500 dark:border-white/[0.05] dark:bg-white/[0.03] dark:text-slate-400">
              Downloaded and ready to activate.
            </p>
          )}
          {!model.downloading && !model.active && !model.error && !model.downloaded && (
            <p className="rounded-xl border border-black/[0.04] bg-black/[0.025] p-3 text-[11px] font-medium leading-4 text-slate-500 dark:border-white/[0.05] dark:bg-white/[0.03] dark:text-slate-400">
              Available for local download.
            </p>
          )}
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2 border-t border-black/[0.05] pt-3 dark:border-white/[0.06]">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
          {!model.downloaded && !model.downloading && (
            <button type="button" onClick={() => { void runAction("download", () => onDownload(model.id)); }}
              data-model-action="download"
              disabled={downloadDisabled}
              aria-disabled={downloadDisabled}
              aria-busy={pendingAction === "download"}
              aria-describedby={actionReasonId}
              title={downloadDisabled ? disabledReason : undefined}
              style={controlTransitionStyle}
              className={signalButtonClass}>
              {pendingAction === "download" ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin motion-reduce:animate-none" strokeWidth={2.5} /> : <Download className="h-3.5 w-3.5 shrink-0" strokeWidth={2.5} />}
              <span className={actionLabelClass}>{pendingAction === "download" ? "Starting" : "Download"}</span>
            </button>
          )}
          {model.downloaded && !model.active && (
            <button type="button" onClick={() => { void runAction("select", () => onSelect(model.id)); }}
              data-model-action="select"
              disabled={selectDisabled}
              aria-disabled={selectDisabled}
              aria-busy={pendingAction === "select"}
              aria-describedby={actionReasonId}
              title={selectDisabled ? disabledReason : undefined}
              style={controlTransitionStyle}
              className={quietSignalButtonClass}>
              {pendingAction === "select" ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin motion-reduce:animate-none" strokeWidth={2.5} /> : <Power className="h-3.5 w-3.5 shrink-0" strokeWidth={2.5} />}
              <span className={actionLabelClass}>{pendingAction === "select" ? "Activating" : "Activate"}</span>
            </button>
          )}
          {model.active && !reembedding && (
            <button type="button" onClick={() => { void runAction("reembed", onReembed); }}
              data-model-action="reembed"
              disabled={reembedDisabled}
              aria-disabled={reembedDisabled}
              aria-busy={pendingAction === "reembed"}
              aria-describedby={actionReasonId}
              title={reembedDisabled ? disabledReason : undefined}
              style={controlTransitionStyle}
              className={staleCount > 0 ? emberButtonClass : quietSignalButtonClass}>
              <RefreshCw className={`h-3.5 w-3.5 shrink-0 ${pendingAction === "reembed" ? "animate-spin motion-reduce:animate-none" : ""}`} strokeWidth={2.5} />
              <span className={actionLabelClass}>{pendingAction === "reembed" ? "Starting" : `Re-embed${staleCount > 0 ? ` ${staleCount}` : " All"}`}</span>
            </button>
          )}
          {model.active && reembedding && (
            <span className={`${baseButtonClass} border border-signal-500/20 bg-signal-500/[0.08] text-signal-700 dark:text-signal-300`} aria-busy="true" style={controlTransitionStyle}>
              <RefreshCw className="h-3.5 w-3.5 shrink-0 animate-spin motion-reduce:animate-none" strokeWidth={2.5} />
              <span className={actionLabelClass}>Re-embedding</span>
            </span>
          )}
        </div>
        {model.downloaded && (
          <button type="button" onClick={() => { void runAction("delete", () => onDelete(model.id)); }}
            data-model-action="delete"
            disabled={deleteDisabled}
            aria-label={model.active ? `Delete ${model.displayName} disabled while active` : `Delete ${model.displayName}`}
            aria-disabled={deleteDisabled}
            aria-busy={pendingAction === "delete"}
            aria-describedby={actionReasonId}
            title={deleteDisabled ? (model.active ? "Active models cannot be deleted. Activate another model before deleting this one." : disabledReason) : "Delete this downloaded model after confirmation."}
            style={controlTransitionStyle}
            className={deleteButtonClass}>
            {pendingAction === "delete" ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" strokeWidth={2} /> : <Trash2 className="h-4 w-4" strokeWidth={2} />}
          </button>
        )}
      </div>
      <p id={actionReasonId} className="mt-2 min-h-4 text-[10px] font-semibold leading-4 text-slate-400 dark:text-slate-500">
        {cardActionCopy || (model.downloaded ? "Actions remain available from the keyboard; destructive actions ask for confirmation." : "Download starts a local model fetch and reports durable progress.")}
      </p>
    </article>
  );
};
