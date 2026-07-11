import type { FunctionComponent, JSX } from "preact";
import { useRef, useState } from "preact/hooks";
import { AlertTriangle, Boxes, CheckCircle2, Loader2, Plus, RefreshCw } from "lucide-preact";
import type { EmbeddingModelWithStatus, MemoryStats, ReembedProgress } from "../../lib/memory-api.js";
import { createCustomEmbeddingModel, listEmbeddingModels } from "../../lib/memory-api.js";
import { useInteractionTokens } from "../../lib/motion/index.js";
import { useConfirmDialog } from "../../hooks/use-confirm-dialog.js";
import { ConfirmDialog } from "../ui/ConfirmDialog.js";
import { ModelCard } from "./ModelCard.js";

interface ModelBrowserProps {
  models: EmbeddingModelWithStatus[];
  stats: MemoryStats;
  reembed: ReembedProgress | null;
  onModelsChanged: (models: EmbeddingModelWithStatus[]) => void;
  onDownload: (id: string) => void | Promise<void>;
  onSelect: (id: string) => void | Promise<void>;
  onDelete: (id: string) => void | Promise<void>;
  onReembed: () => void | Promise<void>;
}

type ModelAction = "download" | "select" | "delete" | "reembed";
type ActionStatus = { status: "idle" | "pending" | "success" | "error"; message: string | null };
type CustomModelForm = {
  displayName: string;
  huggingFaceRepoOrUrl: string;
  onnxModelFile: string;
  tokenizerFiles: string;
  dimension: string;
  approximateSizeBytes: string;
  language: string;
  licenseName: string;
  licenseUrl: string;
  commercialUseAllowed: boolean;
};

const DEFAULT_CUSTOM_FORM: CustomModelForm = {
  displayName: "",
  huggingFaceRepoOrUrl: "",
  onnxModelFile: "onnx/model.onnx",
  tokenizerFiles: "tokenizer.json\ntokenizer_config.json",
  dimension: "",
  approximateSizeBytes: "",
  language: "English",
  licenseName: "",
  licenseUrl: "",
  commercialUseAllowed: false,
};

const HUGGING_FACE_REPO_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/;

function formatModelSize(bytes: number): string {
  if (!bytes) return "The model bundle";
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
  return `${Math.round(bytes / 1_000_000)} MB`;
}

function validateHuggingFaceSource(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return "Hugging Face repo or URL is required.";

  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    try {
      const url = new URL(trimmed);
      if (url.protocol !== "https:" || url.hostname !== "huggingface.co") {
        return "Use an https://huggingface.co model URL.";
      }
      const segments = url.pathname.split("/").filter(Boolean);
      return segments.length >= 2 ? null : "Hugging Face URL must include owner and repository.";
    } catch {
      return "Enter a valid Hugging Face URL.";
    }
  }

  if (trimmed.includes("://")) {
    return "Only Hugging Face repositories or URLs are supported.";
  }

  return HUGGING_FACE_REPO_PATTERN.test(trimmed) ? null : "Use owner/repo format for Hugging Face repositories.";
}

function validateRepositoryPath(value: string, field: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return `${field} is required.`;
  if (trimmed.includes("\\") || trimmed.startsWith("/") || trimmed.includes("?") || trimmed.includes("#")) {
    return `${field} must be a relative repository path.`;
  }
  if (trimmed.split("/").some((segment) => !segment || segment === "." || segment === "..")) {
    return `${field} must not contain empty, current, or parent path segments.`;
  }
  return null;
}

function parseTokenizerFiles(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((file) => file.trim())
    .filter(Boolean);
}

function validateCustomForm(form: CustomModelForm): { ok: true; input: {
  displayName: string;
  huggingFaceRepoOrUrl: string;
  onnxModelFile: string;
  tokenizerFiles: string[];
  dimension: number;
  approximateSizeBytes: number;
  language: string;
  licenseName: string;
  licenseUrl: string;
  commercialUseAllowed: true;
} } | { ok: false; message: string } {
  if (!form.displayName.trim()) return { ok: false, message: "Display name is required." };
  const sourceError = validateHuggingFaceSource(form.huggingFaceRepoOrUrl);
  if (sourceError) return { ok: false, message: sourceError };

  const onnxModelFile = form.onnxModelFile.trim();
  const onnxError = validateRepositoryPath(onnxModelFile, "ONNX model file");
  if (onnxError) return { ok: false, message: onnxError };
  if (!onnxModelFile.endsWith(".onnx")) return { ok: false, message: "ONNX model file must end with .onnx." };

  const tokenizerFiles = parseTokenizerFiles(form.tokenizerFiles);
  if (tokenizerFiles.length === 0) return { ok: false, message: "Tokenizer files are required." };
  for (const file of tokenizerFiles) {
    const pathError = validateRepositoryPath(file, "Tokenizer file");
    if (pathError) return { ok: false, message: pathError };
  }
  if (!tokenizerFiles.some((file) => file.split("/").at(-1) === "tokenizer.json")) {
    return { ok: false, message: "Tokenizer files must include tokenizer.json." };
  }

  const dimension = Number(form.dimension);
  if (!Number.isInteger(dimension) || dimension <= 0) {
    return { ok: false, message: "Dimension must be a positive integer." };
  }

  const approximateSizeBytes = Number(form.approximateSizeBytes);
  if (!Number.isInteger(approximateSizeBytes) || approximateSizeBytes < 0) {
    return { ok: false, message: "Approximate size must be a non-negative integer." };
  }

  if (!form.language.trim()) return { ok: false, message: "Language is required." };
  if (!form.licenseName.trim()) return { ok: false, message: "Upstream license name is required." };
  try {
    const licenseUrl = new URL(form.licenseUrl.trim());
    if (licenseUrl.protocol !== "https:") return { ok: false, message: "License URL must use HTTPS." };
  } catch {
    return { ok: false, message: "Enter a valid upstream license URL." };
  }
  if (!form.commercialUseAllowed) return { ok: false, message: "Confirm that the upstream model permits commercial use." };

  return {
    ok: true,
    input: {
      displayName: form.displayName.trim(),
      huggingFaceRepoOrUrl: form.huggingFaceRepoOrUrl.trim(),
      onnxModelFile,
      tokenizerFiles,
      dimension,
      approximateSizeBytes,
      language: form.language.trim(),
      licenseName: form.licenseName.trim(),
      licenseUrl: form.licenseUrl.trim(),
      commercialUseAllowed: true,
    },
  };
}

function formFieldClass(hasError: boolean): string {
  return `min-h-10 rounded-lg border bg-white/72 px-3 py-2 text-sm text-slate-900 transition-colors placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/45 focus-visible:ring-offset-2 focus-visible:ring-offset-[#F9F8F4] dark:bg-void-900/60 dark:text-white dark:focus-visible:ring-offset-void-900 ${
    hasError
      ? "border-status-red/45"
      : "border-black/[0.08] dark:border-white/[0.08]"
  }`;
}

export const ModelBrowser: FunctionComponent<ModelBrowserProps> = ({
  models,
  stats,
  reembed,
  onModelsChanged,
  onDownload,
  onSelect,
  onDelete,
  onReembed,
}) => {
  const [actionStatus, setActionStatus] = useState<ActionStatus>({ status: "idle", message: null });
  const [formStatus, setFormStatus] = useState<ActionStatus>({ status: "idle", message: null });
  const [pendingModelAction, setPendingModelAction] = useState<{ modelId: string; action: ModelAction } | null>(null);
  const [customForm, setCustomForm] = useState<CustomModelForm>(DEFAULT_CUSTOM_FORM);
  const [customFormError, setCustomFormError] = useState<string | null>(null);
  const actionLockRef = useRef(false);
  const browserRef = useRef<HTMLElement>(null);
  const { isOpen: isConfirmOpen, options: confirmOptions, requestConfirm, handleConfirm, handleCancel } = useConfirmDialog();
  const interactionTokens = useInteractionTokens();
  const downloadedCount = models.filter((model) => model.downloaded).length;
  const downloadingCount = models.filter((model) => model.downloading).length;
  const customCount = models.filter((model) => model.source === "custom").length;
  const activeModel = models.find((model) => model.active);
  const catalogStatus = `${models.length} embedding models available. ${downloadedCount} downloaded. ${downloadingCount} downloading. ${activeModel ? `${activeModel.displayName} active.` : "No active embedding model."}`;
  const controlTransitionStyle = {
    transitionDuration: interactionTokens.controlFeedback.duration,
    transitionTimingFunction: interactionTokens.controlFeedback.ease,
  };
  const asyncTransitionStyle = {
    transitionDuration: interactionTokens.asyncFeedback.duration,
    transitionTimingFunction: interactionTokens.asyncFeedback.ease,
  };

  const setField = (field: keyof CustomModelForm) => (event: JSX.TargetedEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const target = event.currentTarget;
    const value = target instanceof HTMLInputElement && target.type === "checkbox" ? target.checked : target.value;
    setCustomForm((current) => ({ ...current, [field]: value }));
    setCustomFormError(null);
  };

  const runModelAction = async (
    modelId: string,
    actionName: ModelAction,
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
        message: error instanceof Error ? error.message : "Model action failed. Try again.",
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
        browserRef.current?.querySelector<HTMLElement>(`[aria-label="Delete ${model.displayName}"]`)?.focus();
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
        message: error instanceof Error ? error.message : "Model action failed. Try again.",
      });
    } finally {
      setPendingModelAction(null);
      window.setTimeout(() => {
        actionLockRef.current = false;
      }, 0);
      requestAnimationFrame(() => {
        browserRef.current?.querySelector<HTMLElement>("[data-model-action]")?.focus();
      });
    }
  };

  const handleCustomSubmit = async (event: JSX.TargetedSubmitEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const validated = validateCustomForm(customForm);
    if (!validated.ok) {
      setCustomFormError(validated.message);
      setFormStatus({ status: "error", message: validated.message });
      return;
    }

    setCustomFormError(null);
    setFormStatus({ status: "pending", message: "Adding custom Hugging Face model..." });
    try {
      const created = await createCustomEmbeddingModel(validated.input);
      const refreshed = await listEmbeddingModels();
      onModelsChanged(refreshed);
      setCustomForm(DEFAULT_CUSTOM_FORM);
      setFormStatus({ status: "success", message: `${created.displayName} added to embedding models.` });
    } catch (error) {
      setFormStatus({
        status: "error",
        message: error instanceof Error ? error.message : "Custom Hugging Face model could not be added.",
      });
    }
  };

  return (
    <section ref={browserRef} aria-labelledby="model-browser-title" aria-describedby="model-browser-status" aria-busy={actionStatus.status === "pending" || formStatus.status === "pending" || Boolean(reembed?.active) || downloadingCount > 0} className="relative overflow-hidden rounded-2xl border border-black/[0.06] bg-white/72 p-4 shadow-[0_12px_30px_rgba(15,23,42,0.055)] backdrop-blur-2xl transition-[background-color,border-color,box-shadow] dark:border-white/[0.06] dark:bg-void-800/62 dark:shadow-[0_16px_38px_rgba(0,0,0,0.26)] md:p-5" style={controlTransitionStyle}>
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-signal-500/35 to-transparent" />
      <div className="relative z-10 flex flex-col gap-5">
        <p id="model-browser-status" className="sr-only" aria-live="polite" aria-atomic="true">
          {catalogStatus}
        </p>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex min-w-0 gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-signal-500/20 bg-signal-500/[0.1] text-signal-600 shadow-[0_0_20px_rgba(0,224,160,0.1)] dark:text-signal-300">
              <Boxes className="h-5 w-5" strokeWidth={2.2} />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-signal-600 dark:text-signal-400">
                Local model browser
              </p>
              <h2 id="model-browser-title" className="mt-1 text-base font-semibold tracking-tight text-slate-900 dark:text-white">
                Memory and speech models
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500 dark:text-slate-400">
                Manage local embedding models for memory search and add compatible Hugging Face embedding entries.
              </p>
            </div>
          </div>

          <dl className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-end">
            <div className="rounded-lg border border-black/[0.05] bg-black/[0.025] px-3 py-2 dark:border-white/[0.06] dark:bg-white/[0.03]">
              <dt className="text-[9px] font-bold uppercase tracking-[0.16em] text-slate-400">Embedding</dt>
              <dd className="mt-1 font-mono text-sm font-semibold text-slate-800 dark:text-slate-100">{models.length}</dd>
            </div>
            <div className="rounded-lg border border-signal-500/15 bg-signal-500/[0.07] px-3 py-2">
              <dt className="text-[9px] font-bold uppercase tracking-[0.16em] text-signal-700/70 dark:text-signal-300/70">Downloaded</dt>
              <dd className="mt-1 font-mono text-sm font-semibold text-signal-700 dark:text-signal-300">{downloadedCount}</dd>
            </div>
            <div className="rounded-lg border border-ember-500/20 bg-ember-500/[0.07] px-3 py-2">
              <dt className="text-[9px] font-bold uppercase tracking-[0.16em] text-ember-600/75 dark:text-ember-400/75">Stale</dt>
              <dd className="mt-1 font-mono text-sm font-semibold text-ember-600 dark:text-ember-400">{stats.staleEmbeddings}</dd>
            </div>
            <div className="rounded-lg border border-black/[0.05] bg-black/[0.025] px-3 py-2 dark:border-white/[0.06] dark:bg-white/[0.03]">
              <dt className="text-[9px] font-bold uppercase tracking-[0.16em] text-slate-400">Custom</dt>
              <dd className="mt-1 font-mono text-sm font-semibold text-slate-800 dark:text-slate-100">{customCount}</dd>
            </div>
          </dl>
        </div>

        {downloadingCount > 0 && (
          <div className="flex items-center gap-3 rounded-lg border border-signal-500/18 bg-signal-500/[0.07] px-4 py-3 text-signal-700 transition-[background-color,border-color,color] dark:text-signal-300" role="status" aria-live="polite" style={asyncTransitionStyle}>
            <Loader2 className="h-4 w-4 shrink-0 animate-spin motion-reduce:animate-none" strokeWidth={2.4} />
            <p className="text-xs font-bold">
              {downloadingCount} {downloadingCount === 1 ? "model is" : "models are"} downloading.
            </p>
          </div>
        )}

        {actionStatus.message && (
          <div
            className={`flex items-center gap-3 rounded-lg border px-4 py-3 ${
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
          <div className="flex flex-col gap-3 rounded-lg border border-ember-500/22 bg-ember-500/[0.07] px-4 py-4 text-ember-600 dark:text-ember-400 sm:flex-row sm:items-center">
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
              className="inline-flex min-h-9 shrink-0 items-center justify-center gap-2 rounded-lg border border-ember-500/25 bg-ember-500/[0.12] px-3 py-2 text-[11px] font-bold uppercase tracking-[0.12em] text-ember-600 transition-all hover:-translate-y-px hover:bg-ember-500/[0.18] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/45 focus-visible:ring-offset-2 focus-visible:ring-offset-[#F9F8F4] disabled:cursor-wait disabled:opacity-70 dark:text-ember-400 dark:focus-visible:ring-offset-void-900">
              <RefreshCw className="h-3.5 w-3.5" strokeWidth={2.5} />
              Re-embed All
            </button>
          </div>
        )}

        {reembed?.active && (
          <div className="flex items-center gap-3 rounded-lg border border-signal-500/18 bg-signal-500/[0.07] px-4 py-3 text-signal-700 dark:text-signal-300" role="status" aria-live="polite" style={asyncTransitionStyle}>
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
          <div className="flex items-center gap-3 rounded-lg border border-signal-500/18 bg-signal-500/[0.07] px-4 py-3 text-signal-700 dark:text-signal-300" role="status" aria-live="polite">
            <CheckCircle2 className="h-4 w-4 shrink-0" strokeWidth={2.4} />
            <p className="text-xs font-bold">
              Re-embedding complete: {reembed.completed} {reembed.completed === 1 ? "memory" : "memories"} updated.
            </p>
          </div>
        )}

        <section aria-labelledby="embedding-models-heading" className="flex flex-col gap-2">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h3 id="embedding-models-heading" className="text-sm font-semibold tracking-tight text-slate-900 dark:text-white">
                Embedding Models
              </h3>
              <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
                Download, activate, delete, and re-embed memory vectors from this group only.
              </p>
            </div>
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">{activeModel?.displayName ?? "No active model"}</p>
          </div>

          <div className="grid grid-cols-1 gap-2 xl:grid-cols-2">
            {models.map((model) => (
              <ModelCard key={model.id} model={model}
                onDownload={(id) => {
                  const selected = models.find((item) => item.id === id);
                  if (!selected) return;
                  void (async () => {
                    const accepted = await requestConfirm({
                      title: `Download ${selected.displayName}`,
                      body: `${formatModelSize(selected.sizeBytes)} will be downloaded directly from Hugging Face. By continuing, you accept ${selected.license.name}. ${selected.license.notice}`,
                      confirmLabel: "Accept & Download",
                      cancelLabel: "Cancel",
                      tone: "neutral",
                    });
                    if (!accepted) return;
                    await runModelAction(id, "download", `Downloading ${selected.displayName}...`, `${selected.displayName} download started.`, () => onDownload(id));
                  })();
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
              <div className="rounded-lg border border-dashed border-black/[0.08] bg-black/[0.02] px-6 py-10 text-center text-sm font-medium text-slate-400 dark:border-white/[0.08] dark:bg-white/[0.02] lg:col-span-2" role="status" aria-live="polite">
                <p>Embedding models are not available yet.</p>
                <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">Refresh the catalog or check the local embedding runtime if this panel stays empty.</p>
              </div>
            )}
          </div>
        </section>

        <section aria-labelledby="custom-hf-model-heading" className="rounded-lg border border-black/[0.06] bg-black/[0.02] p-3 dark:border-white/[0.06] dark:bg-white/[0.025]">
          <div className="flex flex-col gap-1">
            <h3 id="custom-hf-model-heading" className="text-sm font-semibold tracking-tight text-slate-900 dark:text-white">
              Add Custom Hugging Face Embedding Model
            </h3>
            <p className="text-xs leading-5 text-slate-500 dark:text-slate-400">
              Add ONNX embedding models with tokenizer files. Speech input and output models are managed in the speech catalog above.
            </p>
          </div>
          <form className="mt-3 grid gap-3 lg:grid-cols-6" onSubmit={(event) => { void handleCustomSubmit(event); }} noValidate>
            <label className="flex min-w-0 flex-col gap-1.5 lg:col-span-2">
              <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">Display name</span>
              <input value={customForm.displayName} onInput={setField("displayName")} className={formFieldClass(Boolean(customFormError))} aria-invalid={Boolean(customFormError)} />
            </label>
            <label className="flex min-w-0 flex-col gap-1.5 lg:col-span-2">
              <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">Repo or URL</span>
              <input value={customForm.huggingFaceRepoOrUrl} onInput={setField("huggingFaceRepoOrUrl")} placeholder="owner/repo or https://huggingface.co/owner/repo" className={formFieldClass(Boolean(customFormError))} aria-invalid={Boolean(customFormError)} />
            </label>
            <label className="flex min-w-0 flex-col gap-1.5 lg:col-span-2">
              <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">ONNX model file</span>
              <input value={customForm.onnxModelFile} onInput={setField("onnxModelFile")} className={formFieldClass(Boolean(customFormError))} aria-invalid={Boolean(customFormError)} />
            </label>
            <label className="flex min-w-0 flex-col gap-1.5 lg:col-span-2">
              <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">Tokenizer files</span>
              <textarea value={customForm.tokenizerFiles} onInput={setField("tokenizerFiles")} rows={3} className={`${formFieldClass(Boolean(customFormError))} resize-y`} aria-invalid={Boolean(customFormError)} />
            </label>
            <label className="flex min-w-0 flex-col gap-1.5">
              <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">Dimension</span>
              <input value={customForm.dimension} onInput={setField("dimension")} inputMode="numeric" className={formFieldClass(Boolean(customFormError))} aria-invalid={Boolean(customFormError)} />
            </label>
            <label className="flex min-w-0 flex-col gap-1.5">
              <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">Size bytes</span>
              <input value={customForm.approximateSizeBytes} onInput={setField("approximateSizeBytes")} inputMode="numeric" className={formFieldClass(Boolean(customFormError))} aria-invalid={Boolean(customFormError)} />
            </label>
            <label className="flex min-w-0 flex-col gap-1.5">
              <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">Language</span>
              <input value={customForm.language} onInput={setField("language")} className={formFieldClass(Boolean(customFormError))} aria-invalid={Boolean(customFormError)} />
            </label>
            <label className="flex min-w-0 flex-col gap-1.5 lg:col-span-2">
              <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">Upstream license</span>
              <input value={customForm.licenseName} onInput={setField("licenseName")} placeholder="MIT or Apache-2.0" className={formFieldClass(Boolean(customFormError))} aria-invalid={Boolean(customFormError)} />
            </label>
            <label className="flex min-w-0 flex-col gap-1.5 lg:col-span-2">
              <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">License URL</span>
              <input value={customForm.licenseUrl} onInput={setField("licenseUrl")} placeholder="https://..." className={formFieldClass(Boolean(customFormError))} aria-invalid={Boolean(customFormError)} />
            </label>
            <label className="flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300 lg:col-span-2">
              <input type="checkbox" checked={customForm.commercialUseAllowed} onChange={setField("commercialUseAllowed")} className="h-4 w-4 accent-signal-500" />
              I verified that the model terms permit commercial use.
            </label>
            <div className="flex items-end">
              <button type="submit" disabled={formStatus.status === "pending"} aria-busy={formStatus.status === "pending"} className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-lg bg-signal-500 px-3 py-2 text-[11px] font-bold uppercase tracking-[0.12em] text-white transition-all hover:-translate-y-px hover:bg-signal-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/45 focus-visible:ring-offset-2 focus-visible:ring-offset-[#F9F8F4] disabled:cursor-wait disabled:opacity-65 disabled:hover:translate-y-0 dark:text-void-950 dark:focus-visible:ring-offset-void-900">
                {formStatus.status === "pending" ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" strokeWidth={2.4} /> : <Plus className="h-4 w-4" strokeWidth={2.4} />}
                Add
              </button>
            </div>
          </form>
          {(customFormError || formStatus.message) && (
            <div className={`mt-3 flex items-center gap-2 rounded-lg border px-3 py-2 ${formStatus.status === "error" || customFormError ? "border-status-red/20 bg-status-red/[0.08] text-status-red" : "border-signal-500/18 bg-signal-500/[0.07] text-signal-700 dark:text-signal-300"}`} role={formStatus.status === "error" || customFormError ? "alert" : "status"} aria-live={formStatus.status === "error" || customFormError ? "assertive" : "polite"} aria-atomic="true">
              {formStatus.status === "pending" ? <Loader2 className="h-4 w-4 shrink-0 animate-spin motion-reduce:animate-none" strokeWidth={2.4} /> : formStatus.status === "success" ? <CheckCircle2 className="h-4 w-4 shrink-0" strokeWidth={2.4} /> : <AlertTriangle className="h-4 w-4 shrink-0" strokeWidth={2.4} />}
              <p className="text-xs font-bold">{customFormError ?? formStatus.message}</p>
            </div>
          )}
        </section>

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
