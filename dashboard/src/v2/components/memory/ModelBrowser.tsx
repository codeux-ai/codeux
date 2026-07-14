import type { FunctionComponent, JSX } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { AlertTriangle, Boxes, CheckCircle2, ChevronDown, Loader2, Plus, RefreshCw, Search, X } from "lucide-preact";
import type { EmbeddingModelWithStatus, MemoryStats, ReembedProgress } from "../../lib/memory-api.js";
import { createCustomEmbeddingModel, listEmbeddingModels } from "../../lib/memory-api.js";
import { useInteractionTokens } from "../../lib/motion/index.js";
import { useConfirmDialog } from "../../hooks/use-confirm-dialog.js";
import { ConfirmDialog } from "../ui/ConfirmDialog.js";
import { ModelCard } from "./ModelCard.js";
import { AvantgardeSelect } from "../ui/AvantgardeSelect.js";
import { useMemoryI18n, type MemoryTextKey } from "../../i18n/messages/memory.js";
import type { DashboardMessageVariables } from "../../i18n/locales.js";

interface ModelBrowserProps {
  models: EmbeddingModelWithStatus[];
  stats: MemoryStats;
  reembed: ReembedProgress | null;
  onModelsChanged: (models: EmbeddingModelWithStatus[]) => void;
  onDownload: (id: string) => void | Promise<void>;
  onSelect: (id: string) => void | Promise<void>;
  onDelete: (id: string) => void | Promise<void>;
  onReembed: () => void | Promise<void>;
  onConfirmationOpenChange?: (open: boolean) => void;
}

type ModelAction = "download" | "select" | "delete" | "reembed";
type ActionStatus = { status: "idle" | "pending" | "success" | "error"; message: string | null };
type InstallFilter = "all" | "available" | "downloaded" | "downloading" | "unavailable";
type SourceFilter = "all" | "built_in" | "custom";
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

type MemoryTranslate = (key: MemoryTextKey, variables?: DashboardMessageVariables) => string;

function normalizeCatalogText(value: string, locale: string): string {
  return value.trim().toLocaleLowerCase(locale);
}

function matchesInstallFilter(model: EmbeddingModelWithStatus, filter: InstallFilter): boolean {
  if (filter === "all") return true;
  if (filter === "unavailable") return Boolean(model.error);
  if (filter === "downloading") return !model.error && model.downloading;
  if (filter === "downloaded") return !model.error && !model.downloading && model.downloaded;
  return !model.downloaded && !model.downloading && !model.error;
}

function formatModelSize(bytes: number, formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string, t: MemoryTranslate): string {
  if (!bytes) return t("modelBundle");
  if (bytes >= 1_000_000_000) return `${formatNumber(bytes / 1_000_000_000, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} GB`;
  return `${formatNumber(bytes / 1_000_000, { maximumFractionDigits: 0 })} MB`;
}

function validateHuggingFaceSource(value: string, t: MemoryTranslate): string | null {
  const trimmed = value.trim();
  if (!trimmed) return t("validationHfRequired");

  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    try {
      const url = new URL(trimmed);
      if (url.protocol !== "https:" || url.hostname !== "huggingface.co") {
        return t("validationHfHttps");
      }
      const segments = url.pathname.split("/").filter(Boolean);
      return segments.length >= 2 ? null : t("validationHfOwnerRepo");
    } catch {
      return t("validationHfUrl");
    }
  }

  if (trimmed.includes("://")) {
    return t("validationHfOnly");
  }

  return HUGGING_FACE_REPO_PATTERN.test(trimmed) ? null : t("validationHfFormat");
}

function validateRepositoryPath(value: string, field: string, t: MemoryTranslate): string | null {
  const trimmed = value.trim();
  if (!trimmed) return t("validationFieldRequired", { field });
  if (trimmed.includes("\\") || trimmed.startsWith("/") || trimmed.includes("?") || trimmed.includes("#")) {
    return t("validationRelativePath", { field });
  }
  if (trimmed.split("/").some((segment) => !segment || segment === "." || segment === "..")) {
    return t("validationPathSegments", { field });
  }
  return null;
}

function parseTokenizerFiles(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((file) => file.trim())
    .filter(Boolean);
}

function validateCustomForm(form: CustomModelForm, t: MemoryTranslate): { ok: true; input: {
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
  if (!form.displayName.trim()) return { ok: false, message: t("validationDisplayName") };
  const sourceError = validateHuggingFaceSource(form.huggingFaceRepoOrUrl, t);
  if (sourceError) return { ok: false, message: sourceError };

  const onnxModelFile = form.onnxModelFile.trim();
  const onnxError = validateRepositoryPath(onnxModelFile, t("onnxModelFile"), t);
  if (onnxError) return { ok: false, message: onnxError };
  if (!onnxModelFile.endsWith(".onnx")) return { ok: false, message: t("validationOnnxExtension") };

  const tokenizerFiles = parseTokenizerFiles(form.tokenizerFiles);
  if (tokenizerFiles.length === 0) return { ok: false, message: t("validationTokenizerRequired") };
  for (const file of tokenizerFiles) {
    const pathError = validateRepositoryPath(file, t("tokenizerFiles"), t);
    if (pathError) return { ok: false, message: pathError };
  }
  if (!tokenizerFiles.some((file) => file.split("/").at(-1) === "tokenizer.json")) {
    return { ok: false, message: t("validationTokenizerJson") };
  }

  const dimension = Number(form.dimension);
  if (!Number.isInteger(dimension) || dimension <= 0) {
    return { ok: false, message: t("validationDimension") };
  }

  const approximateSizeBytes = Number(form.approximateSizeBytes);
  if (!Number.isInteger(approximateSizeBytes) || approximateSizeBytes < 0) {
    return { ok: false, message: t("validationSize") };
  }

  if (!form.language.trim()) return { ok: false, message: t("validationLanguage") };
  if (!form.licenseName.trim()) return { ok: false, message: t("validationLicenseName") };
  try {
    const licenseUrl = new URL(form.licenseUrl.trim());
    if (licenseUrl.protocol !== "https:") return { ok: false, message: t("validationLicenseHttps") };
  } catch {
    return { ok: false, message: t("validationLicenseUrl") };
  }
  if (!form.commercialUseAllowed) return { ok: false, message: t("validationCommercial") };

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
  onConfirmationOpenChange,
}) => {
  const { formatNumber, locale, t, tp } = useMemoryI18n();
  const [actionStatus, setActionStatus] = useState<ActionStatus>({ status: "idle", message: null });
  const [formStatus, setFormStatus] = useState<ActionStatus>({ status: "idle", message: null });
  const [pendingModelAction, setPendingModelAction] = useState<{ modelId: string; action: ModelAction } | null>(null);
  const [customForm, setCustomForm] = useState<CustomModelForm>(DEFAULT_CUSTOM_FORM);
  const [customFormError, setCustomFormError] = useState<string | null>(null);
  const [catalogQuery, setCatalogQuery] = useState("");
  const [installFilter, setInstallFilter] = useState<InstallFilter>("all");
  const [languageFilter, setLanguageFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [customFormOpen, setCustomFormOpen] = useState(false);
  const actionLockRef = useRef(false);
  const browserRef = useRef<HTMLElement>(null);
  const customFormToggleRef = useRef<HTMLButtonElement>(null);
  const { isOpen: isConfirmOpen, options: confirmOptions, requestConfirm, handleConfirm, handleCancel } = useConfirmDialog();
  useEffect(() => {
    onConfirmationOpenChange?.(isConfirmOpen);
  }, [isConfirmOpen, onConfirmationOpenChange]);
  const interactionTokens = useInteractionTokens();
  const downloadedCount = models.filter((model) => model.downloaded).length;
  const downloadingCount = models.filter((model) => model.downloading).length;
  const customCount = models.filter((model) => model.source === "custom").length;
  const activeModel = models.find((model) => model.active);
  const catalogStatus = t("catalogStatus", {
    available: formatNumber(models.length),
    downloaded: formatNumber(downloadedCount),
    downloading: formatNumber(downloadingCount),
    activeStatus: activeModel ? t("activeModelStatus", { name: activeModel.displayName }) : t("noActiveEmbeddingModel"),
  });
  const languageOptions = useMemo(() => (
    Array.from(new Set(models.map((model) => model.language.trim()).filter(Boolean)))
      .sort((left, right) => left.localeCompare(right, locale, { sensitivity: "base" }))
  ), [locale, models]);
  const filteredModels = useMemo(() => {
    const query = normalizeCatalogText(catalogQuery, locale);
    return models.filter((model) => {
      const searchableText = normalizeCatalogText([
        model.displayName,
        model.id,
        model.description,
        model.language,
        model.license.name,
        model.license.notice,
      ].join(" "), locale);
      return (!query || searchableText.includes(query))
        && matchesInstallFilter(model, installFilter)
        && (languageFilter === "all" || model.language === languageFilter)
        && (sourceFilter === "all" || model.source === sourceFilter);
    });
  }, [catalogQuery, installFilter, languageFilter, locale, models, sourceFilter]);
  const filtersActive = Boolean(catalogQuery.trim())
    || installFilter !== "all"
    || languageFilter !== "all"
    || sourceFilter !== "all";
  const controlTransitionStyle = {
    transitionDuration: interactionTokens.controlFeedback.duration,
    transitionTimingFunction: interactionTokens.controlFeedback.ease,
  };
  const asyncTransitionStyle = {
    transitionDuration: interactionTokens.asyncFeedback.duration,
    transitionTimingFunction: interactionTokens.asyncFeedback.ease,
  };

  const clearCatalogFilters = (): void => {
    setCatalogQuery("");
    setInstallFilter("all");
    setLanguageFilter("all");
    setSourceFilter("all");
  };

  const toggleCustomForm = (): void => {
    setCustomFormOpen((open) => !open);
    setCustomFormError(null);
    if (formStatus.status !== "pending") {
      setFormStatus({ status: "idle", message: null });
    }
    if (customFormOpen) {
      window.setTimeout(() => customFormToggleRef.current?.focus(), 0);
    }
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
        message: error instanceof Error ? error.message : t("modelActionFailed"),
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
        browserRef.current?.querySelector<HTMLElement>(`[aria-label="${t("deleteNamedModel", { name: model.displayName })}"]`)?.focus();
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
        message: error instanceof Error ? error.message : t("modelActionFailed"),
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
    const validated = validateCustomForm(customForm, t);
    if (!validated.ok) {
      setCustomFormError(validated.message);
      setFormStatus({ status: "error", message: validated.message });
      return;
    }

    setCustomFormError(null);
    setFormStatus({ status: "pending", message: t("addingCustomModel") });
    try {
      const created = await createCustomEmbeddingModel(validated.input);
      const refreshed = await listEmbeddingModels();
      onModelsChanged(refreshed);
      setCustomForm(DEFAULT_CUSTOM_FORM);
      setFormStatus({ status: "success", message: t("customModelAdded", { name: created.displayName }) });
      setCustomFormOpen(false);
      window.setTimeout(() => customFormToggleRef.current?.focus(), 0);
    } catch (error) {
      setFormStatus({
        status: "error",
        message: error instanceof Error ? error.message : t("customModelFallbackError"),
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
                {t("localModelBrowser")}
              </p>
              <h2 id="model-browser-title" className="mt-1 text-base font-semibold tracking-tight text-slate-900 dark:text-white">
                {t("memoryEmbeddingModels")}
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500 dark:text-slate-400">
                {t("modelBrowserDescription")}
              </p>
            </div>
          </div>

          <dl className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-end">
            <div className="rounded-lg border border-black/[0.05] bg-black/[0.025] px-3 py-2 dark:border-white/[0.06] dark:bg-white/[0.03]">
              <dt className="text-[9px] font-bold uppercase tracking-[0.16em] text-slate-400">{t("embedding")}</dt>
              <dd className="mt-1 font-mono text-sm font-semibold text-slate-800 dark:text-slate-100">{formatNumber(models.length)}</dd>
            </div>
            <div className="rounded-lg border border-signal-500/15 bg-signal-500/[0.07] px-3 py-2">
              <dt className="text-[9px] font-bold uppercase tracking-[0.16em] text-signal-700/70 dark:text-signal-300/70">{t("downloaded")}</dt>
              <dd className="mt-1 font-mono text-sm font-semibold text-signal-700 dark:text-signal-300">{formatNumber(downloadedCount)}</dd>
            </div>
            <div className="rounded-lg border border-ember-500/20 bg-ember-500/[0.07] px-3 py-2">
              <dt className="text-[9px] font-bold uppercase tracking-[0.16em] text-ember-600/75 dark:text-ember-400/75">{t("stale")}</dt>
              <dd className="mt-1 font-mono text-sm font-semibold text-ember-600 dark:text-ember-400">{formatNumber(stats.staleEmbeddings)}</dd>
            </div>
            <div className="rounded-lg border border-black/[0.05] bg-black/[0.025] px-3 py-2 dark:border-white/[0.06] dark:bg-white/[0.03]">
              <dt className="text-[9px] font-bold uppercase tracking-[0.16em] text-slate-400">{t("custom")}</dt>
              <dd className="mt-1 font-mono text-sm font-semibold text-slate-800 dark:text-slate-100">{formatNumber(customCount)}</dd>
            </div>
          </dl>
        </div>

        {downloadingCount > 0 && (
          <div className="flex items-center gap-3 rounded-lg border border-signal-500/18 bg-signal-500/[0.07] px-4 py-3 text-signal-700 transition-[background-color,border-color,color] dark:text-signal-300" role="status" aria-live="polite" style={asyncTransitionStyle}>
            <Loader2 className="h-4 w-4 shrink-0 animate-spin motion-reduce:animate-none" strokeWidth={2.4} />
            <p className="text-xs font-bold">
              {tp("modelsDownloading", downloadingCount, { formattedCount: formatNumber(downloadingCount) })}
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
              className="inline-flex min-h-9 shrink-0 items-center justify-center gap-2 rounded-lg border border-ember-500/25 bg-ember-500/[0.12] px-3 py-2 text-[11px] font-bold uppercase tracking-[0.12em] text-ember-600 transition-all hover:-translate-y-px hover:bg-ember-500/[0.18] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/45 focus-visible:ring-offset-2 focus-visible:ring-offset-[#F9F8F4] disabled:cursor-wait disabled:opacity-70 dark:text-ember-400 dark:focus-visible:ring-offset-void-900">
              <RefreshCw className="h-3.5 w-3.5" strokeWidth={2.5} />
              {t("reembedAll")}
            </button>
          </div>
        )}

        {reembed?.active && (
          <div className="flex items-center gap-3 rounded-lg border border-signal-500/18 bg-signal-500/[0.07] px-4 py-3 text-signal-700 dark:text-signal-300" role="status" aria-live="polite" style={asyncTransitionStyle}>
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
          <div className="flex items-center gap-3 rounded-lg border border-signal-500/18 bg-signal-500/[0.07] px-4 py-3 text-signal-700 dark:text-signal-300" role="status" aria-live="polite">
            <CheckCircle2 className="h-4 w-4 shrink-0" strokeWidth={2.4} />
            <p className="text-xs font-bold">
              {t("reembedComplete", { countLabel: tp("memory", reembed.completed, { formattedCount: formatNumber(reembed.completed) }) })}
            </p>
          </div>
        )}

        <section aria-labelledby="embedding-models-heading" className="flex flex-col gap-2">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h3 id="embedding-models-heading" className="text-sm font-semibold tracking-tight text-slate-900 dark:text-white">
                {t("embeddingModels")}
              </h3>
              <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
                {t("embeddingModelsDescription")}
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">{activeModel?.displayName ?? t("noActiveModel")}</p>
              <button
                ref={customFormToggleRef}
                type="button"
                aria-expanded={customFormOpen}
                aria-controls="custom-hf-model-panel"
                onClick={toggleCustomForm}
                disabled={formStatus.status === "pending"}
                className="inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-signal-500/20 bg-signal-500/[0.08] px-3 py-2 text-[11px] font-bold text-signal-700 transition-colors hover:bg-signal-500/[0.14] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/45 focus-visible:ring-offset-2 focus-visible:ring-offset-[#F9F8F4] dark:text-signal-300 dark:focus-visible:ring-offset-void-900"
              >
                <Plus className="h-3.5 w-3.5" strokeWidth={2.4} />
                {t(customFormOpen ? "closeCustomForm" : "addCustomModel")}
                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${customFormOpen ? "rotate-180" : ""}`} aria-hidden="true" />
              </button>
            </div>
          </div>

          <div className="grid gap-3 rounded-xl border border-black/[0.06] bg-black/[0.02] p-3 dark:border-white/[0.06] dark:bg-white/[0.025] lg:grid-cols-[minmax(15rem,1fr)_repeat(3,minmax(8rem,auto))]">
            <div className="min-w-0">
              <label htmlFor="embedding-model-search" className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">{t("searchModels")}</label>
              <div className="mt-1.5 flex min-h-10 items-center gap-2 rounded-lg border border-black/[0.08] bg-white/72 px-3 dark:border-white/[0.08] dark:bg-void-900/60">
                <Search className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                <input
                  id="embedding-model-search"
                  type="search"
                  value={catalogQuery}
                  onInput={(event) => setCatalogQuery(event.currentTarget.value)}
                  placeholder={t("modelSearchPlaceholder")}
                  className="min-w-0 flex-1 bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400 dark:text-white"
                />
                {catalogQuery ? (
                  <button type="button" onClick={() => setCatalogQuery("")} aria-label={t("clearModelSearch")} className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-slate-400 hover:bg-black/[0.04] hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/45 dark:hover:bg-white/[0.06] dark:hover:text-white">
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                ) : null}
              </div>
            </div>
            <label className="min-w-0 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
              {t("installState")}
              <AvantgardeSelect
                value={installFilter}
                onChange={(value) => setInstallFilter(value as InstallFilter)}
                className="mt-1.5 w-full min-w-0"
                variant="card"
                options={[
                  { value: "all", label: t("allStates") },
                  { value: "available", label: t("available") },
                  { value: "downloaded", label: t("downloaded") },
                  { value: "downloading", label: t("downloading") },
                  { value: "unavailable", label: t("unavailable") },
                ]}
              />
            </label>
            <label className="min-w-0 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
              {t("language")}
              <AvantgardeSelect
                value={languageFilter}
                onChange={setLanguageFilter}
                className="mt-1.5 w-full min-w-0"
                variant="card"
                options={[
                  { value: "all", label: t("allLanguages") },
                  ...languageOptions.map((language) => ({ value: language, label: language })),
                ]}
              />
            </label>
            <label className="min-w-0 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
              {t("source")}
              <AvantgardeSelect
                value={sourceFilter}
                onChange={(value) => setSourceFilter(value as SourceFilter)}
                className="mt-1.5 w-full min-w-0"
                variant="card"
                options={[
                  { value: "all", label: t("allSources") },
                  { value: "built_in", label: t("builtIn") },
                  { value: "custom", label: t("custom") },
                ]}
              />
            </label>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
            <span role="status" aria-label={t("modelCatalogResults")} aria-live="polite">{t("catalogShowing", { shown: formatNumber(filteredModels.length), total: formatNumber(models.length) })}</span>
            {filtersActive ? <button type="button" onClick={clearCatalogFilters} className="font-bold text-signal-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/45 dark:text-signal-300">{t("clearSearchAndFilters")}</button> : null}
          </div>

          <div className="grid grid-cols-1 gap-2 xl:grid-cols-2">
            {filteredModels.map((model) => (
              <ModelCard key={model.id} model={model}
                onDownload={(id) => {
                  const selected = models.find((item) => item.id === id);
                  if (!selected) return;
                  void (async () => {
                    const accepted = await requestConfirm({
                      title: t("downloadModelTitle", { name: selected.displayName }),
                      body: t("downloadModelBody", { size: formatModelSize(selected.sizeBytes, formatNumber, t), licenseName: selected.license.name, licenseNotice: selected.license.notice }),
                      confirmLabel: t("acceptAndDownload"),
                      cancelLabel: t("cancel"),
                      tone: "neutral",
                    });
                    if (!accepted) return;
                    await runModelAction(id, "download", t("downloadingModel", { name: selected.displayName }), t("modelDownloadStarted", { name: selected.displayName }), () => onDownload(id));
                  })();
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
              <div className="rounded-lg border border-dashed border-black/[0.08] bg-black/[0.02] px-6 py-10 text-center text-sm font-medium text-slate-400 dark:border-white/[0.08] dark:bg-white/[0.02] lg:col-span-2" role="status" aria-live="polite">
                <p>{t("embeddingModelsUnavailable")}</p>
                <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">{t("embeddingModelsUnavailableHelp")}</p>
              </div>
            )}
            {models.length > 0 && filteredModels.length === 0 ? (
              <div className="rounded-lg border border-dashed border-black/[0.08] bg-black/[0.02] px-6 py-10 text-center dark:border-white/[0.08] dark:bg-white/[0.02] xl:col-span-2">
                <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">{t("noModelsMatch")}</p>
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{t("broaderModelSearch")}</p>
                <button type="button" onClick={clearCatalogFilters} className="mt-4 inline-flex min-h-9 items-center justify-center rounded-lg bg-signal-500 px-3 py-2 text-[11px] font-bold text-white hover:bg-signal-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/45 focus-visible:ring-offset-2 dark:text-void-950">{t("showAllModels")}</button>
              </div>
            ) : null}
          </div>
        </section>

        {customFormOpen ? <section id="custom-hf-model-panel" aria-labelledby="custom-hf-model-heading" className="rounded-lg border border-black/[0.06] bg-black/[0.02] p-3 dark:border-white/[0.06] dark:bg-white/[0.025]">
          <div className="flex flex-col gap-1">
            <h3 id="custom-hf-model-heading" className="text-sm font-semibold tracking-tight text-slate-900 dark:text-white">
              {t("addCustomHeading")}
            </h3>
            <p className="text-xs leading-5 text-slate-500 dark:text-slate-400">
              {t("addCustomDescription")}
            </p>
          </div>
          <form className="mt-3 grid gap-3 lg:grid-cols-6" onSubmit={(event) => { void handleCustomSubmit(event); }} noValidate>
            <label className="flex min-w-0 flex-col gap-1.5 lg:col-span-2">
              <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">{t("displayName")}</span>
              <input value={customForm.displayName} onInput={setField("displayName")} className={formFieldClass(Boolean(customFormError))} aria-invalid={Boolean(customFormError)} />
            </label>
            <label className="flex min-w-0 flex-col gap-1.5 lg:col-span-2">
              <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">{t("repoOrUrl")}</span>
              <input value={customForm.huggingFaceRepoOrUrl} onInput={setField("huggingFaceRepoOrUrl")} placeholder="owner/repo or https://huggingface.co/owner/repo" className={formFieldClass(Boolean(customFormError))} aria-invalid={Boolean(customFormError)} />
            </label>
            <label className="flex min-w-0 flex-col gap-1.5 lg:col-span-2">
              <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">{t("onnxModelFile")}</span>
              <input value={customForm.onnxModelFile} onInput={setField("onnxModelFile")} className={formFieldClass(Boolean(customFormError))} aria-invalid={Boolean(customFormError)} />
            </label>
            <label className="flex min-w-0 flex-col gap-1.5 lg:col-span-2">
              <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">{t("tokenizerFiles")}</span>
              <textarea value={customForm.tokenizerFiles} onInput={setField("tokenizerFiles")} rows={3} className={`${formFieldClass(Boolean(customFormError))} resize-y`} aria-invalid={Boolean(customFormError)} />
            </label>
            <label className="flex min-w-0 flex-col gap-1.5">
              <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">{t("dimension")}</span>
              <input value={customForm.dimension} onInput={setField("dimension")} inputMode="numeric" className={formFieldClass(Boolean(customFormError))} aria-invalid={Boolean(customFormError)} />
            </label>
            <label className="flex min-w-0 flex-col gap-1.5">
              <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">{t("sizeBytes")}</span>
              <input value={customForm.approximateSizeBytes} onInput={setField("approximateSizeBytes")} inputMode="numeric" className={formFieldClass(Boolean(customFormError))} aria-invalid={Boolean(customFormError)} />
            </label>
            <label className="flex min-w-0 flex-col gap-1.5">
              <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">{t("language")}</span>
              <input value={customForm.language} onInput={setField("language")} className={formFieldClass(Boolean(customFormError))} aria-invalid={Boolean(customFormError)} />
            </label>
            <label className="flex min-w-0 flex-col gap-1.5 lg:col-span-2">
              <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">{t("upstreamLicense")}</span>
              <input value={customForm.licenseName} onInput={setField("licenseName")} placeholder="MIT or Apache-2.0" className={formFieldClass(Boolean(customFormError))} aria-invalid={Boolean(customFormError)} />
            </label>
            <label className="flex min-w-0 flex-col gap-1.5 lg:col-span-2">
              <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">{t("licenseUrl")}</span>
              <input value={customForm.licenseUrl} onInput={setField("licenseUrl")} placeholder="https://..." className={formFieldClass(Boolean(customFormError))} aria-invalid={Boolean(customFormError)} />
            </label>
            <label className="flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300 lg:col-span-2">
              <input type="checkbox" checked={customForm.commercialUseAllowed} onChange={setField("commercialUseAllowed")} className="h-4 w-4 accent-signal-500" />
              {t("commercialConfirmation")}
            </label>
            <div className="flex items-end">
              <button type="submit" disabled={formStatus.status === "pending"} aria-busy={formStatus.status === "pending"} className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-lg bg-signal-500 px-3 py-2 text-[11px] font-bold uppercase tracking-[0.12em] text-white transition-all hover:-translate-y-px hover:bg-signal-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/45 focus-visible:ring-offset-2 focus-visible:ring-offset-[#F9F8F4] disabled:cursor-wait disabled:opacity-65 disabled:hover:translate-y-0 dark:text-void-950 dark:focus-visible:ring-offset-void-900">
                {formStatus.status === "pending" ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" strokeWidth={2.4} /> : <Plus className="h-4 w-4" strokeWidth={2.4} />}
                {t("add")}
              </button>
            </div>
          </form>
        </section> : null}

        {(customFormError || formStatus.message) && (
          <div className={`flex items-center gap-2 rounded-lg border px-3 py-2 ${formStatus.status === "error" || customFormError ? "border-status-red/20 bg-status-red/[0.08] text-status-red" : "border-signal-500/18 bg-signal-500/[0.07] text-signal-700 dark:text-signal-300"}`} role={formStatus.status === "error" || customFormError ? "alert" : "status"} aria-label={t("customModelStatus")} aria-live={formStatus.status === "error" || customFormError ? "assertive" : "polite"} aria-atomic="true">
            {formStatus.status === "pending" ? <Loader2 className="h-4 w-4 shrink-0 animate-spin motion-reduce:animate-none" strokeWidth={2.4} /> : formStatus.status === "success" ? <CheckCircle2 className="h-4 w-4 shrink-0" strokeWidth={2.4} /> : <AlertTriangle className="h-4 w-4 shrink-0" strokeWidth={2.4} />}
            <p className="text-xs font-bold">{customFormError ?? formStatus.message}</p>
          </div>
        )}

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
