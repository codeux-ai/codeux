import type { FunctionComponent } from "preact";
import { useRef, useState } from "preact/hooks";
import { AlertTriangle, Boxes, CheckCircle2, Loader2, RefreshCw } from "lucide-react";
import type { EmbeddingModelWithStatus, MemoryStats, ReembedProgress } from "../../lib/memory-api.js";
import { ModelCard } from "./ModelCard.js";
import { ConfirmDialog } from "../ui/ConfirmDialog.js";
import { useConfirmDialog } from "../../hooks/use-confirm-dialog.js";
import { useInteractionTokens } from "../../lib/motion/index.js";
import { useMemoryI18n } from "../../i18n/messages/memory.js";

interface EmbeddingModelCatalogProps {
  models: EmbeddingModelWithStatus[];
  stats: MemoryStats;
  reembed: ReembedProgress | null;
  onDownload: (id: string) => void | Promise<void>;
  onSelect: (id: string) => void | Promise<void>;
  onDelete: (id: string) => void | Promise<void>;
  onReembed: () => void | Promise<void>;
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
  const { formatNumber, t, tp } = useMemoryI18n();
  const [actionStatus, setActionStatus] = useState<{ status: "idle" | "pending" | "success" | "error"; message: string | null }>({ status: "idle", message: null });
  const [pendingModelAction, setPendingModelAction] = useState<{ modelId: string; action: "download" | "select" | "delete" | "reembed" } | null>(null);
  const actionLockRef = useRef(false);
  const catalogRef = useRef<HTMLElement>(null);
  const { isOpen: isConfirmOpen, options: confirmOptions, requestConfirm, handleConfirm, handleCancel } = useConfirmDialog();
  const interactionTokens = useInteractionTokens();
  const downloadedCount = models.filter((model) => model.downloaded).length;
  const downloadingCount = models.filter((model) => model.downloading).length;
  const activeModel = models.find((model) => model.active);
  const catalogStatus = t("catalogStatus", { available: formatNumber(models.length), downloaded: formatNumber(downloadedCount), downloading: formatNumber(downloadingCount), activeStatus: activeModel ? t("activeModelStatus", { name: activeModel.displayName }) : t("noActiveModel") });
  const controlTransitionStyle = {
    transitionDuration: interactionTokens.controlFeedback.duration,
    transitionTimingFunction: interactionTokens.controlFeedback.ease,
  };
  const asyncTransitionStyle = {
    transitionDuration: interactionTokens.asyncFeedback.duration,
    transitionTimingFunction: interactionTokens.asyncFeedback.ease,
  };
  const runModelAction = async (
    modelId: string,
    actionName: "download" | "select" | "delete" | "reembed",
    message: string,
    successMessage: string,
    action: () => void | Promise<void>
  ): Promise<void> => {
    if (actionLockRef.current || pendingModelAction) {
      return;
    }

    actionLockRef.current = true;
    setPendingModelAction({ modelId, action: actionName });
    setActionStatus({ status: "pending", message });
    try {
      await action();
      setActionStatus({ status: "success", message: successMessage });
    } catch (error) {
      setActionStatus({
        status: "error",
        message: error instanceof Error ? error.message : t("modelActionFailed")
      });
    } finally {
      setPendingModelAction(null);
      window.setTimeout(() => {
        actionLockRef.current = false;
      }, 0);
    }
  };

  const runDeleteModelAction = async (model: EmbeddingModelWithStatus): Promise<void> => {
    if (pendingModelAction || actionLockRef.current) {
      return;
    }

    actionLockRef.current = true;
    setPendingModelAction({ modelId: model.id, action: "delete" });
    const confirmed = await requestConfirm({
      title: t("deleteEmbeddingModel"),
      body: t("deleteModelBody", { name: model.displayName }),
      confirmLabel: t("deleteModel"),
      cancelLabel: t("cancel"),
      destructive: true,
    });

    if (!confirmed) {
      setPendingModelAction(null);
      window.setTimeout(() => {
        actionLockRef.current = false;
      }, 0);
      requestAnimationFrame(() => {
        catalogRef.current?.querySelector<HTMLElement>(`[aria-label="${t("deleteNamedModel", { name: model.displayName })}"]`)?.focus();
      });
      return;
    }

    setActionStatus({ status: "pending", message: t("deletingModel", { name: model.displayName }) });
    try {
      await onDelete(model.id);
      setActionStatus({ status: "success", message: t("modelDeleted", { name: model.displayName }) });
    } catch (error) {
      setActionStatus({
        status: "error",
        message: error instanceof Error ? error.message : t("modelActionFailed")
      });
    } finally {
      setPendingModelAction(null);
      window.setTimeout(() => {
        actionLockRef.current = false;
      }, 0);
      requestAnimationFrame(() => {
        catalogRef.current?.querySelector<HTMLElement>("[data-model-action]")?.focus();
      });
    }
  };

  return (
    <section ref={catalogRef} aria-labelledby="embedding-model-catalog-title" aria-describedby="embedding-model-catalog-status" aria-busy={actionStatus.status === "pending" || Boolean(reembed?.active) || downloadingCount > 0} className="relative overflow-hidden rounded-[1.75rem] border border-black/[0.06] bg-white/72 p-4 shadow-[0_14px_38px_rgba(15,23,42,0.06)] backdrop-blur-2xl transition-[background-color,border-color,box-shadow] dark:border-white/[0.06] dark:bg-void-800/62 dark:shadow-[0_16px_42px_rgba(0,0,0,0.28)] md:p-5" style={controlTransitionStyle}>
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-signal-500/35 to-transparent" />
      <div className="relative z-10 flex flex-col gap-5">
        <p id="embedding-model-catalog-status" className="sr-only" aria-live="polite" aria-atomic="true">
          {catalogStatus}
        </p>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex min-w-0 gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-signal-500/20 bg-signal-500/[0.1] text-signal-600 shadow-[0_0_24px_rgba(0,224,160,0.12)] dark:text-signal-300">
              <Boxes className="h-5 w-5" strokeWidth={2.2} />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-signal-600 dark:text-signal-400">
                {t("localModelBrowser")}
              </p>
              <h2 id="embedding-model-catalog-title" className="mt-1 text-base font-semibold tracking-tight text-slate-900 dark:text-white">
                {t("memoryEmbeddingModels")}
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500 dark:text-slate-400">
                {t("embeddingModelsDescription")}
              </p>
            </div>
          </div>

          <dl className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-end">
            <div className="rounded-xl border border-black/[0.05] bg-black/[0.025] px-3 py-2.5 dark:border-white/[0.06] dark:bg-white/[0.03]">
              <dt className="text-[9px] font-bold uppercase tracking-[0.16em] text-slate-400">{t("available")}</dt>
              <dd className="mt-1 font-mono text-sm font-semibold text-slate-800 dark:text-slate-100">{formatNumber(models.length)}</dd>
            </div>
            <div className="rounded-xl border border-signal-500/15 bg-signal-500/[0.07] px-3 py-2.5">
              <dt className="text-[9px] font-bold uppercase tracking-[0.16em] text-signal-700/70 dark:text-signal-300/70">{t("downloaded")}</dt>
              <dd className="mt-1 font-mono text-sm font-semibold text-signal-700 dark:text-signal-300">{formatNumber(downloadedCount)}</dd>
            </div>
            <div className="rounded-xl border border-ember-500/20 bg-ember-500/[0.07] px-3 py-2.5">
              <dt className="text-[9px] font-bold uppercase tracking-[0.16em] text-ember-600/75 dark:text-ember-400/75">{t("stale")}</dt>
              <dd className="mt-1 font-mono text-sm font-semibold text-ember-600 dark:text-ember-400">{formatNumber(stats.staleEmbeddings)}</dd>
            </div>
            <div className="rounded-xl border border-black/[0.05] bg-black/[0.025] px-3 py-2.5 dark:border-white/[0.06] dark:bg-white/[0.03]">
              <dt className="text-[9px] font-bold uppercase tracking-[0.16em] text-slate-400">{t("active")}</dt>
              <dd className="mt-1 max-w-[9rem] truncate font-mono text-sm font-semibold text-slate-800 dark:text-slate-100">
                {activeModel?.displayName ?? t("none")}
              </dd>
            </div>
          </dl>
        </div>

        {downloadingCount > 0 && (
          <div className="flex items-center gap-3 rounded-2xl border border-signal-500/18 bg-signal-500/[0.07] px-4 py-3 text-signal-700 transition-[background-color,border-color,color] dark:text-signal-300" role="status" aria-live="polite" style={asyncTransitionStyle}>
            <Loader2 className="h-4 w-4 shrink-0 animate-spin motion-reduce:animate-none" strokeWidth={2.4} />
            <p className="text-xs font-bold">
              {tp("modelsDownloading", downloadingCount, { formattedCount: formatNumber(downloadingCount) })}
            </p>
          </div>
        )}

        {actionStatus.message && (
          <div
            className={`flex items-center gap-3 rounded-2xl border px-4 py-3 ${
              actionStatus.status === "error"
                ? "border-status-red/20 bg-status-red/[0.08] text-status-red"
                : "border-signal-500/18 bg-signal-500/[0.07] text-signal-700 dark:text-signal-300"
            }`}
            role={actionStatus.status === "error" ? "alert" : "status"}
            aria-live={actionStatus.status === "error" ? "assertive" : "polite"}
            aria-atomic="true"
            aria-busy={actionStatus.status === "pending"}
            style={asyncTransitionStyle}
          >
            {actionStatus.status === "pending" ? (
              <Loader2 className="h-4 w-4 shrink-0 animate-spin motion-reduce:animate-none" strokeWidth={2.4} />
            ) : actionStatus.status === "success" ? (
              <CheckCircle2 className="h-4 w-4 shrink-0" strokeWidth={2.4} />
            ) : (
              <AlertTriangle className="h-4 w-4 shrink-0" strokeWidth={2.4} />
            )}
            <p className="text-xs font-bold">{actionStatus.message}</p>
          </div>
        )}

        {stats.staleEmbeddings > 0 && !reembed?.active && (
          <div className="flex flex-col gap-3 rounded-2xl border border-ember-500/22 bg-ember-500/[0.07] px-4 py-4 text-ember-600 dark:text-ember-400 sm:flex-row sm:items-center">
            <AlertTriangle className="h-4 w-4 shrink-0" strokeWidth={2.4} />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold">
                {tp("staleMemoriesNeedReembed", stats.staleEmbeddings, { formattedCount: formatNumber(stats.staleEmbeddings) })}
              </p>
              <p className="mt-1 text-[11px] leading-4 text-ember-600/75 dark:text-ember-400/70">
                {t("staleExplanation")}
              </p>
            </div>
            <button type="button" onClick={() => {
              void runModelAction(activeModel?.id ?? "catalog", "reembed", t("startingReembed"), t("reembedStarted"), onReembed);
            }}
              data-model-action="reembed-all"
              disabled={Boolean(pendingModelAction)}
              aria-busy={pendingModelAction?.action === "reembed"}
              style={controlTransitionStyle}
              className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-xl border border-ember-500/25 bg-ember-500/[0.12] px-4 py-2 text-[11px] font-bold uppercase tracking-[0.12em] text-ember-600 transition-all hover:-translate-y-px hover:bg-ember-500/[0.18] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/45 focus-visible:ring-offset-2 focus-visible:ring-offset-[#F9F8F4] disabled:cursor-wait disabled:opacity-70 dark:text-ember-400 dark:focus-visible:ring-offset-void-900">
              <RefreshCw className="h-3.5 w-3.5" strokeWidth={2.5} />
              {t("reembedAll")}
            </button>
          </div>
        )}

        {reembed?.active && (
          <div className="flex items-center gap-3 rounded-2xl border border-signal-500/18 bg-signal-500/[0.07] px-4 py-3 text-signal-700 dark:text-signal-300" role="status" aria-live="polite" style={asyncTransitionStyle}>
            <Loader2 className="h-4 w-4 shrink-0 animate-spin motion-reduce:animate-none" strokeWidth={2.4} />
            <p className="text-xs font-bold">
              {t("reembeddingProgress", { completed: formatNumber(reembed.completed), total: formatNumber(reembed.total) })}
            </p>
            <div className="h-2 min-w-[8rem] flex-1 overflow-hidden rounded-full bg-black/[0.06] dark:bg-white/[0.08]" role="progressbar" aria-label={t("reembedProgressLabel")} aria-valuemin={0} aria-valuemax={reembed.total || 0} aria-valuenow={reembed.completed}>
              <div className="h-full rounded-full bg-signal-500 transition-[width]" style={{ ...asyncTransitionStyle, width: `${reembed.total > 0 ? Math.round((reembed.completed / reembed.total) * 100) : 0}%` }} />
            </div>
          </div>
        )}

        {reembed && !reembed.active && reembed.completed > 0 && stats.staleEmbeddings === 0 && (
          <div className="flex items-center gap-3 rounded-2xl border border-signal-500/18 bg-signal-500/[0.07] px-4 py-3 text-signal-700 dark:text-signal-300" role="status" aria-live="polite">
            <CheckCircle2 className="h-4 w-4 shrink-0" strokeWidth={2.4} />
            <p className="text-xs font-bold">
              {t("reembedComplete", { countLabel: tp("memory", reembed.completed, { formattedCount: formatNumber(reembed.completed) }) })}
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 items-stretch gap-3 xl:grid-cols-2">
          {models.map((model) => (
            <ModelCard key={model.id} model={model}
              onDownload={(id) => {
                const selected = models.find((item) => item.id === id);
                const name = selected?.displayName ?? t("embedding");
                void runModelAction(id, "download", t("downloadingModel", { name }), t("modelDownloadStarted", { name }), () => onDownload(id));
              }}
              onSelect={(id) => {
                const selected = models.find((item) => item.id === id);
                const name = selected?.displayName ?? t("embedding");
                void runModelAction(id, "select", t("activatingModel", { name }), t("modelIsActive", { name }), () => onSelect(id));
              }}
              onDelete={(id) => {
                const selected = models.find((item) => item.id === id);
                if (selected) {
                  void runDeleteModelAction(selected);
                }
              }}
              onReembed={() => {
                void runModelAction(model.id, "reembed", t("startingReembed"), t("reembedStarted"), onReembed);
              }}
              reembedding={!!reembed?.active}
              staleCount={stats.staleEmbeddings}
              actionPending={pendingModelAction?.modelId === model.id ? pendingModelAction.action : null}
              actionBlocked={Boolean(pendingModelAction && pendingModelAction.modelId !== model.id)} />
          ))}
          {models.length === 0 && (
            <div className="rounded-[1.5rem] border border-dashed border-black/[0.08] bg-black/[0.02] px-6 py-12 text-center text-sm font-medium text-slate-400 dark:border-white/[0.08] dark:bg-white/[0.02] lg:col-span-2" role="status" aria-live="polite">
              <p>{t("embeddingModelsUnavailable")}</p>
              <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">{t("embeddingModelsUnavailableHelp")}</p>
            </div>
          )}
        </div>
      </div>
      <ConfirmDialog
        isOpen={isConfirmOpen}
        options={confirmOptions}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />
    </section>
  );
};
