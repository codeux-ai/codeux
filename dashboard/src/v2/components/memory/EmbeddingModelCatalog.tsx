import type { FunctionComponent } from "preact";
import { useRef, useState } from "preact/hooks";
import { AlertTriangle, Boxes, CheckCircle2, Loader2, RefreshCw } from "lucide-react";
import type { EmbeddingModelWithStatus, MemoryStats, ReembedProgress } from "../../lib/memory-api.js";
import { ModelCard } from "./ModelCard.js";
import { ConfirmDialog } from "../ui/ConfirmDialog.js";
import { useConfirmDialog } from "../../hooks/use-confirm-dialog.js";
import { useInteractionTokens } from "../../lib/motion/index.js";

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
  const [actionStatus, setActionStatus] = useState<{ status: "idle" | "pending" | "success" | "error"; message: string | null }>({ status: "idle", message: null });
  const [pendingModelAction, setPendingModelAction] = useState<{ modelId: string; action: "download" | "select" | "delete" | "reembed" } | null>(null);
  const actionLockRef = useRef(false);
  const catalogRef = useRef<HTMLElement>(null);
  const { isOpen: isConfirmOpen, options: confirmOptions, requestConfirm, handleConfirm, handleCancel } = useConfirmDialog();
  const interactionTokens = useInteractionTokens();
  const downloadedCount = models.filter((model) => model.downloaded).length;
  const downloadingCount = models.filter((model) => model.downloading).length;
  const activeModel = models.find((model) => model.active);
  const catalogStatus = `${models.length} models available. ${downloadedCount} downloaded. ${downloadingCount} downloading. ${activeModel ? `${activeModel.displayName} active.` : "No active model."}`;
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
        message: error instanceof Error ? error.message : "Model action failed. Try again."
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
      title: "Delete Embedding Model",
      body: `Delete ${model.displayName} from local storage? Memories remain stored, but this model must be downloaded again before it can be activated.`,
      confirmLabel: "Delete Model",
      cancelLabel: "Cancel",
      destructive: true,
    });

    if (!confirmed) {
      setPendingModelAction(null);
      window.setTimeout(() => {
        actionLockRef.current = false;
      }, 0);
      requestAnimationFrame(() => {
        catalogRef.current?.querySelector<HTMLElement>(`[aria-label="Delete ${model.displayName}"]`)?.focus();
      });
      return;
    }

    setActionStatus({ status: "pending", message: `Deleting ${model.displayName}...` });
    try {
      await onDelete(model.id);
      setActionStatus({ status: "success", message: `${model.displayName} deleted.` });
    } catch (error) {
      setActionStatus({
        status: "error",
        message: error instanceof Error ? error.message : "Model action failed. Try again."
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
                Local embeddings
              </p>
              <h2 id="embedding-model-catalog-title" className="mt-1 text-base font-semibold tracking-tight text-slate-900 dark:text-white">
                Embedding model catalog
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500 dark:text-slate-400">
                Download compatible ONNX models, activate the local embedding runtime, and re-embed stale memories when model dimensions change.
              </p>
            </div>
          </div>

          <dl className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-end">
            <div className="rounded-xl border border-black/[0.05] bg-black/[0.025] px-3 py-2.5 dark:border-white/[0.06] dark:bg-white/[0.03]">
              <dt className="text-[9px] font-bold uppercase tracking-[0.16em] text-slate-400">Available</dt>
              <dd className="mt-1 font-mono text-sm font-semibold text-slate-800 dark:text-slate-100">{models.length}</dd>
            </div>
            <div className="rounded-xl border border-signal-500/15 bg-signal-500/[0.07] px-3 py-2.5">
              <dt className="text-[9px] font-bold uppercase tracking-[0.16em] text-signal-700/70 dark:text-signal-300/70">Downloaded</dt>
              <dd className="mt-1 font-mono text-sm font-semibold text-signal-700 dark:text-signal-300">{downloadedCount}</dd>
            </div>
            <div className="rounded-xl border border-ember-500/20 bg-ember-500/[0.07] px-3 py-2.5">
              <dt className="text-[9px] font-bold uppercase tracking-[0.16em] text-ember-600/75 dark:text-ember-400/75">Stale</dt>
              <dd className="mt-1 font-mono text-sm font-semibold text-ember-600 dark:text-ember-400">{stats.staleEmbeddings}</dd>
            </div>
            <div className="rounded-xl border border-black/[0.05] bg-black/[0.025] px-3 py-2.5 dark:border-white/[0.06] dark:bg-white/[0.03]">
              <dt className="text-[9px] font-bold uppercase tracking-[0.16em] text-slate-400">Active</dt>
              <dd className="mt-1 max-w-[9rem] truncate font-mono text-sm font-semibold text-slate-800 dark:text-slate-100">
                {activeModel?.displayName ?? "None"}
              </dd>
            </div>
          </dl>
        </div>

        {downloadingCount > 0 && (
          <div className="flex items-center gap-3 rounded-2xl border border-signal-500/18 bg-signal-500/[0.07] px-4 py-3 text-signal-700 transition-[background-color,border-color,color] dark:text-signal-300" role="status" aria-live="polite" style={asyncTransitionStyle}>
            <Loader2 className="h-4 w-4 shrink-0 animate-spin motion-reduce:animate-none" strokeWidth={2.4} />
            <p className="text-xs font-bold">
              {downloadingCount} {downloadingCount === 1 ? "model is" : "models are"} downloading.
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
                {stats.staleEmbeddings} {stats.staleEmbeddings === 1 ? "memory needs" : "memories need"} re-embedding.
              </p>
              <p className="mt-1 text-[11px] leading-4 text-ember-600/75 dark:text-ember-400/70">
                These memories were embedded with a different model and stay out of semantic search until vectors are rebuilt.
              </p>
            </div>
            <button type="button" onClick={() => {
              void runModelAction(activeModel?.id ?? "catalog", "reembed", "Starting memory re-embedding...", "Memory re-embedding started.", onReembed);
            }}
              data-model-action="reembed-all"
              disabled={Boolean(pendingModelAction)}
              aria-busy={pendingModelAction?.action === "reembed"}
              style={controlTransitionStyle}
              className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-xl border border-ember-500/25 bg-ember-500/[0.12] px-4 py-2 text-[11px] font-bold uppercase tracking-[0.12em] text-ember-600 transition-all hover:-translate-y-px hover:bg-ember-500/[0.18] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/45 focus-visible:ring-offset-2 focus-visible:ring-offset-[#F9F8F4] disabled:cursor-wait disabled:opacity-70 dark:text-ember-400 dark:focus-visible:ring-offset-void-900">
              <RefreshCw className="h-3.5 w-3.5" strokeWidth={2.5} />
              Re-embed All
            </button>
          </div>
        )}

        {reembed?.active && (
          <div className="flex items-center gap-3 rounded-2xl border border-signal-500/18 bg-signal-500/[0.07] px-4 py-3 text-signal-700 dark:text-signal-300" role="status" aria-live="polite" style={asyncTransitionStyle}>
            <Loader2 className="h-4 w-4 shrink-0 animate-spin motion-reduce:animate-none" strokeWidth={2.4} />
            <p className="text-xs font-bold">
              Re-embedding memories: {reembed.completed}/{reembed.total}
            </p>
            <div className="h-2 min-w-[8rem] flex-1 overflow-hidden rounded-full bg-black/[0.06] dark:bg-white/[0.08]" role="progressbar" aria-label="Memory re-embedding progress" aria-valuemin={0} aria-valuemax={reembed.total || 0} aria-valuenow={reembed.completed}>
              <div className="h-full rounded-full bg-signal-500 transition-[width]" style={{ ...asyncTransitionStyle, width: `${reembed.total > 0 ? Math.round((reembed.completed / reembed.total) * 100) : 0}%` }} />
            </div>
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

        <div className="grid grid-cols-1 items-stretch gap-3 xl:grid-cols-2">
          {models.map((model) => (
            <ModelCard key={model.id} model={model}
              onDownload={(id) => {
                const selected = models.find((item) => item.id === id);
                void runModelAction(id, "download", `Downloading ${selected?.displayName ?? "embedding model"}...`, `${selected?.displayName ?? "Embedding model"} download started.`, () => onDownload(id));
              }}
              onSelect={(id) => {
                const selected = models.find((item) => item.id === id);
                void runModelAction(id, "select", `Activating ${selected?.displayName ?? "embedding model"}...`, `${selected?.displayName ?? "Embedding model"} is active.`, () => onSelect(id));
              }}
              onDelete={(id) => {
                const selected = models.find((item) => item.id === id);
                if (selected) {
                  void runDeleteModelAction(selected);
                }
              }}
              onReembed={() => {
                void runModelAction(model.id, "reembed", "Starting memory re-embedding...", "Memory re-embedding started.", onReembed);
              }}
              reembedding={!!reembed?.active}
              staleCount={stats.staleEmbeddings}
              actionPending={pendingModelAction?.modelId === model.id ? pendingModelAction.action : null}
              actionBlocked={Boolean(pendingModelAction && pendingModelAction.modelId !== model.id)} />
          ))}
          {models.length === 0 && (
            <div className="rounded-[1.5rem] border border-dashed border-black/[0.08] bg-black/[0.02] px-6 py-12 text-center text-sm font-medium text-slate-400 dark:border-white/[0.08] dark:bg-white/[0.02] lg:col-span-2" role="status" aria-live="polite">
              <p>Embedding models are not available yet.</p>
              <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">Refresh the catalog or check the local embedding runtime if this panel stays empty.</p>
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
