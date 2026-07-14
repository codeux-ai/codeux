import type { FunctionComponent } from "preact";
import { useRef, useState } from "preact/hooks";
import { CheckCircle2, Download, ExternalLink, HardDrive, Loader2, Power, RefreshCw, Trash2, WifiOff } from "lucide-preact";
import { useInteractionTokens } from "../../lib/motion/index.js";
import { getSafeUrl } from "../../lib/safe-url.js";
import type { EmbeddingModelWithStatus } from "../../lib/memory-api.js";
import { useMemoryI18n, type MemoryTextKey } from "../../i18n/messages/memory.js";

function formatBytes(bytes: number, formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string): string {
  if (bytes < 1e6) return `${formatNumber(bytes / 1024, { maximumFractionDigits: 0 })} KB`;
  if (bytes < 1e9) return `${formatNumber(bytes / 1e6, { maximumFractionDigits: 0 })} MB`;
  return `${formatNumber(bytes / 1e9, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} GB`;
}

function getStatusKey(model: EmbeddingModelWithStatus): MemoryTextKey {
  if (model.error) return "modelStatusUnavailable";
  if (model.downloading) return "modelStatusDownloading";
  if (model.active) return "modelStatusActive";
  if (model.downloaded) return "modelStatusDownloaded";
  return "modelStatusAvailable";
}

function getStatusClass(model: EmbeddingModelWithStatus): string {
  if (model.error) return "border-status-red/25 bg-status-red/[0.08] text-status-red";
  if (model.downloading) return "border-signal-500/25 bg-signal-500/[0.1] text-signal-600 dark:text-signal-300";
  if (model.active) return "border-signal-500/30 bg-signal-500/[0.12] text-signal-700 dark:text-signal-300";
  if (model.downloaded) return "border-black/[0.07] bg-black/[0.035] text-slate-600 dark:border-white/[0.08] dark:bg-white/[0.05] dark:text-slate-300";
  return "border-black/[0.06] bg-black/[0.025] text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-slate-400";
}

const actionLabelClass = "min-w-0 text-center leading-4";
const baseButtonClass = "inline-flex min-h-8 max-w-full min-w-0 items-center justify-center gap-1.5 rounded-md px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-[0.1em] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/45 focus-visible:ring-offset-2 focus-visible:ring-offset-[#F9F8F4] disabled:cursor-not-allowed disabled:opacity-45 dark:focus-visible:ring-offset-void-900";
const signalButtonClass = `${baseButtonClass} bg-signal-500 text-white shadow-[0_8px_18px_rgba(0,224,160,0.16)] hover:-translate-y-px hover:bg-signal-400 dark:text-void-950 disabled:hover:translate-y-0 disabled:hover:bg-signal-500`;
const quietSignalButtonClass = `${baseButtonClass} border border-signal-500/20 bg-signal-500/[0.08] text-signal-700 hover:-translate-y-px hover:border-signal-500/35 hover:bg-signal-500/[0.14] dark:text-signal-300 disabled:hover:translate-y-0 disabled:hover:bg-signal-500/[0.08]`;
const emberButtonClass = `${baseButtonClass} border border-ember-500/25 bg-ember-500/[0.1] text-ember-600 hover:-translate-y-px hover:bg-ember-500/[0.16] dark:text-ember-400 disabled:hover:translate-y-0 disabled:hover:bg-ember-500/[0.1]`;
const deleteButtonClass = "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-transparent text-slate-400 transition-all hover:border-status-red/20 hover:bg-status-red/[0.08] hover:text-status-red focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-status-red/35 focus-visible:ring-offset-2 focus-visible:ring-offset-[#F9F8F4] disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:border-transparent disabled:hover:bg-transparent disabled:hover:text-slate-400 dark:focus-visible:ring-offset-void-900";

function getHuggingFaceUrl(model: EmbeddingModelWithStatus): string | undefined {
  if (!model.huggingFaceRepo) return undefined;
  return getSafeUrl(`https://huggingface.co/${model.huggingFaceRepo}`);
}

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
  const { formatNumber, t, tp } = useMemoryI18n();
  const [localPendingAction, setLocalPendingAction] = useState<"download" | "select" | "delete" | "reembed" | null>(null);
  const activationLockRef = useRef(false);
  const progress = Math.max(0, Math.min(100, Math.round(model.downloadProgress * 100)));
  const statusLabel = t(getStatusKey(model));
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
  const sourceUrl = getHuggingFaceUrl(model);
  const activePendingLabel = pendingAction === "download"
    ? t("downloadRequestPending")
    : pendingAction === "select"
      ? t("activationRequestPending")
      : pendingAction === "delete"
        ? t("deleteRequestPending")
        : pendingAction === "reembed"
          ? t("reembedRequestPending")
          : "";
  const disabledReason = model.downloading
    ? t("modelDownloadInProgress")
    : reembedding
      ? t("memoryReembeddingInProgress")
      : isBlockedByOtherAction
        ? t("anotherModelActionPending")
        : activePendingLabel;
  const cardActionCopy = model.active && model.downloaded
    ? t("activeModelActionCopy")
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
      className={`group grid min-h-[8.75rem] gap-3 rounded-lg border p-3 shadow-[0_6px_18px_rgba(15,23,42,0.04)] transition-all focus-within:ring-2 focus-within:ring-signal-500/25 focus-within:ring-offset-2 focus-within:ring-offset-[#F9F8F4] dark:shadow-[0_10px_26px_rgba(0,0,0,0.18)] dark:focus-within:ring-offset-void-900 ${
        model.active
          ? "border-signal-500/25 bg-signal-500/[0.055]"
          : model.error
            ? "border-status-red/20 bg-status-red/[0.035]"
            : "border-black/[0.06] bg-white/64 dark:border-white/[0.06] dark:bg-void-800/54"
      }`}
      style={controlTransitionStyle}
    >
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="flex min-w-0 gap-2.5">
          <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${
            model.error
              ? "border-status-red/20 bg-status-red/[0.08] text-status-red"
              : "border-signal-500/20 bg-signal-500/[0.1] text-signal-600 dark:text-signal-300"
          }`}>
            {model.error ? <WifiOff className="h-4 w-4" strokeWidth={2.2} /> : <HardDrive className="h-4 w-4" strokeWidth={2.2} />}
          </div>
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold leading-tight tracking-tight text-slate-900 dark:text-white">
              {model.displayName}
            </h3>
            <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500 dark:text-slate-400">
              {model.description}
            </p>
          </div>
        </div>
        <span className={`inline-flex max-w-[8rem] shrink-0 items-center justify-center gap-1.5 rounded-full border px-2 py-1 text-center text-[9px] font-bold uppercase leading-3 tracking-[0.12em] transition-[background-color,border-color,color] ${getStatusClass(model)}`} style={controlTransitionStyle}>
          {model.active && <CheckCircle2 className="h-3 w-3" strokeWidth={2.4} />}
          {model.downloading && <Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" strokeWidth={2.4} />}
          {statusLabel}
        </span>
      </div>

      <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div className="min-w-0">
          <dl className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] leading-5 text-slate-500 dark:text-slate-400">
            <div className="inline-flex gap-1">
              <dt className="font-bold uppercase tracking-[0.1em] text-slate-400">{t("dim")}</dt>
              <dd className="font-mono font-semibold text-slate-700 dark:text-slate-200">{formatNumber(model.dimension)}d</dd>
            </div>
            <div className="inline-flex gap-1">
              <dt className="font-bold uppercase tracking-[0.1em] text-slate-400">{t("size")}</dt>
              <dd className="font-mono font-semibold text-slate-700 dark:text-slate-200">{formatBytes(model.sizeBytes, formatNumber)}</dd>
            </div>
            <div className="inline-flex min-w-0 gap-1">
              <dt className="font-bold uppercase tracking-[0.1em] text-slate-400">{t("lang")}</dt>
              <dd className="truncate font-mono font-semibold text-slate-700 dark:text-slate-200">{model.language}</dd>
            </div>
            <div className="inline-flex gap-1">
              <dt className="font-bold uppercase tracking-[0.1em] text-slate-400">{t("source")}</dt>
              <dd className="font-mono font-semibold text-slate-700 dark:text-slate-200">{t(model.source === "custom" ? "customHf" : "builtIn")}</dd>
            </div>
          </dl>
          {sourceUrl && (
            <a
              href={sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-flex max-w-full items-center gap-1 truncate text-[11px] font-bold text-signal-700 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/45 focus-visible:ring-offset-2 focus-visible:ring-offset-[#F9F8F4] dark:text-signal-300 dark:focus-visible:ring-offset-void-900"
            >
              <ExternalLink className="h-3 w-3 shrink-0" strokeWidth={2.4} />
              <span className="truncate">{model.huggingFaceRepo}</span>
            </a>
          )}
        </div>

        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <a href={model.license.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[10px] font-bold text-signal-600 hover:underline dark:text-signal-300">
            <ExternalLink className="h-3 w-3" /> {model.license.name} · {t(model.source === "custom" ? "operatorAsserted" : "commercialUse")}
          </a>
        </div>

        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
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
              <span className={actionLabelClass}>{t(pendingAction === "download" ? "starting" : "download")}</span>
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
              <span className={actionLabelClass}>{t(pendingAction === "select" ? "activating" : "activate")}</span>
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
              <span className={actionLabelClass}>{pendingAction === "reembed" ? t("starting") : staleCount > 0 ? t("reembedCount", { count: formatNumber(staleCount) }) : t("reembedAllShort")}</span>
            </button>
          )}
          {model.active && reembedding && (
            <span className={`${baseButtonClass} border border-signal-500/20 bg-signal-500/[0.08] text-signal-700 dark:text-signal-300`} aria-busy="true" style={controlTransitionStyle}>
              <RefreshCw className="h-3.5 w-3.5 shrink-0 animate-spin motion-reduce:animate-none" strokeWidth={2.5} />
              <span className={actionLabelClass}>{t("reembedding")}</span>
            </span>
          )}
          {model.downloaded && (
            <button type="button" onClick={() => { void runAction("delete", () => onDelete(model.id)); }}
              data-model-action="delete"
              disabled={deleteDisabled}
              aria-label={t(model.active ? "deleteActiveDisabled" : "deleteNamedModel", { name: model.displayName })}
              aria-disabled={deleteDisabled}
              aria-busy={pendingAction === "delete"}
              aria-describedby={actionReasonId}
              title={deleteDisabled ? (model.active ? t("activeCannotDelete") : disabledReason) : t("deleteDownloadedConfirm")}
              style={controlTransitionStyle}
              className={deleteButtonClass}>
              {pendingAction === "delete" ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" strokeWidth={2} /> : <Trash2 className="h-4 w-4" strokeWidth={2} />}
            </button>
          )}
        </div>
      </div>

      <div id={cardStatusId} className="min-h-5" aria-live="polite" aria-atomic="true">
        {model.downloading && (
          <div className="flex items-center gap-2 text-[11px] font-semibold text-signal-700 dark:text-signal-300">
            <div className="h-1.5 min-w-[6rem] flex-1 overflow-hidden rounded-full bg-black/[0.06] dark:bg-white/[0.08]" role="progressbar" aria-label={t("modelDownloadProgress", { name: model.displayName })} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
              <div className="h-full rounded-full bg-signal-500 transition-[width]" style={{ ...asyncTransitionStyle, width: `${progress}%` }} />
            </div>
            <span className="font-mono">{formatNumber(progress / 100, { style: "percent", maximumFractionDigits: 0 })}</span>
          </div>
        )}
        {model.active && staleCount > 0 && !model.downloading && (
          <p className="text-[11px] font-bold leading-5 text-ember-600 dark:text-ember-400">
            {tp("staleMemoriesShort", staleCount, { formattedCount: formatNumber(staleCount) })}
          </p>
        )}
        {model.error && !model.downloading && (
          <p className="text-[11px] font-semibold leading-5 text-status-red">
            {model.error}
          </p>
        )}
      </div>
      <p id={actionReasonId} className="min-h-4 text-[10px] font-semibold leading-4 text-slate-400 dark:text-slate-500">
        {cardActionCopy || t(model.downloaded ? "keyboardActions" : "downloadFetchProgress")}
      </p>
    </article>
  );
};
