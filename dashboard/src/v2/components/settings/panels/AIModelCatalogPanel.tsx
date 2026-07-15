import type { FunctionComponent } from "preact";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { ArrowRight, Boxes, Check, Download, ExternalLink, Headphones, Loader2, Mic, Search, Settings2, Sparkles, Trash2, Volume2, Waves, X } from "lucide-preact";
import type { SpeechModelStatus, SpeechProviderMode, SpeechSettings } from "../../../../types.js";
import type { SettingsPageState } from "../../../hooks/use-settings-page-state.js";
import {
  deleteEmbeddingModel,
  downloadEmbeddingModel,
  getMemoryStats,
  getReembedProgress,
  listEmbeddingModels,
  selectEmbeddingModel,
  startReembed,
  type EmbeddingModelWithStatus,
  type MemoryStats,
  type ReembedProgress,
} from "../../../lib/memory-api.js";
import { deleteSpeechModel, downloadSpeechModel, listSpeechModels } from "../../../lib/speech-api.js";
import { ModelBrowser } from "../../memory/ModelBrowser.js";
import { NumberInput, Row, SecretInput, SelectInput, TextInput, Toggle } from "../SettingsFormFields.js";
import { SectionCard, useSettingsDetailWorkspace } from "./SharedPanelComponents.js";
import { useConfirmDialog } from "../../../hooks/use-confirm-dialog.js";
import { ConfirmDialog } from "../../ui/ConfirmDialog.js";
import { AvantgardeSelect } from "../../ui/AvantgardeSelect.js";
import {
  getRecommendedSynthesisModel,
  getRecommendedVoice,
  getSynthesisLanguageOptions,
  getVoiceLanguageCode,
  isRecommendedForLanguage,
} from "../../../lib/speech-model-recommendations.js";
import { useDashboardI18n } from "../../../i18n/index.js";
import { settingsModelsMessages } from "../../../i18n/messages/settings-models.js";
import { translateDashboardMessage, type DashboardLocale } from "../../../i18n/locales.js";
import { createDashboardFormatters } from "../../../i18n/formatters.js";

const EMPTY_STATS: MemoryStats = { sprint: 0, agent: 0, project: 0, activeModel: null, staleEmbeddings: 0 };
type CatalogTab = "all" | "transcription" | "synthesis" | "embedding";

export function formatModelSize(bytes: number, locale: DashboardLocale = "en"): string {
  const { formatNumber } = createDashboardFormatters(locale);
  if (!bytes) return translateDashboardMessage(settingsModelsMessages, locale, "sizeVaries");
  if (bytes >= 1_000_000_000) return translateDashboardMessage(settingsModelsMessages, locale, "gigabytes", { size: formatNumber(bytes / 1_000_000_000, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) });
  return translateDashboardMessage(settingsModelsMessages, locale, "megabytes", { size: formatNumber(Math.round(bytes / 1_000_000)) });
}

function getModelLanguages(model: SpeechModelStatus): Array<{ code: string; label: string }> {
  if (model.languages?.length) return model.languages;
  return [{ code: model.language === "English" ? "en" : model.language.toLocaleLowerCase(), label: model.language }];
}

const SpeechModelCard: FunctionComponent<{
  model: SpeechModelStatus;
  active: boolean;
  busy: boolean;
  onDownload: () => void;
  onActivate: () => void;
  onDelete: () => void;
  recommendationLabel?: string;
}> = ({ model, active, busy, onDownload, onActivate, onDelete, recommendationLabel }) => {
  const { locale, formatNumber, translate: t } = useDashboardI18n();
  const Icon = model.kind === "transcription" ? Mic : Volume2;
  const licenseApproved = model.license.commercialUseAllowed
    && Boolean(model.license.id.trim() && model.license.name.trim())
    && model.license.url.startsWith("https://");
  const repairRequired = active && !model.downloaded && !model.downloading;
  return (
    <article className={`relative overflow-hidden rounded-2xl border p-4 transition-colors ${active ? "border-signal-500/35 bg-signal-500/[0.07]" : "border-black/[0.06] bg-white/65 dark:border-white/[0.07] dark:bg-white/[0.035]"}`}>
      <div aria-hidden className={`absolute inset-y-4 left-0 w-1 rounded-r-full ${active ? "bg-signal-500" : "bg-transparent"}`} />
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-signal-500/20 bg-signal-500/[0.09] text-signal-600 dark:text-signal-300">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <h4 className="font-semibold text-slate-900 dark:text-white">{model.displayName}</h4>
              <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">{model.adapter} · {model.language} · {formatModelSize(model.sizeBytes, locale)}</p>
              {recommendationLabel ? <span className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-signal-500/20 bg-signal-500/[0.08] px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.12em] text-signal-700 dark:text-signal-300"><Sparkles className="h-3 w-3" aria-hidden="true" /> {t(settingsModelsMessages, "preferredFor", { language: recommendationLabel })}</span> : null}
            </div>
            <span className={`rounded-full border px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.12em] ${repairRequired ? "border-amber-500/25 text-amber-600" : active ? "border-signal-500/25 text-signal-700 dark:text-signal-300" : model.downloaded ? "border-slate-400/20 text-slate-500" : "border-amber-500/20 text-amber-600"}`}>
              {!licenseApproved ? t(settingsModelsMessages, "unavailable") : repairRequired ? t(settingsModelsMessages, "repairRequired") : model.downloading ? formatNumber(model.downloadProgress, { style: "percent", maximumFractionDigits: 0 }) : active ? t(settingsModelsMessages, "active") : model.downloaded ? t(settingsModelsMessages, "installed") : t(settingsModelsMessages, "available")}
            </span>
          </div>
          <p className="mt-2 text-xs leading-5 text-slate-500 dark:text-slate-400">{model.description}</p>
          <div className="mt-2 rounded-xl border border-black/[0.06] bg-black/[0.025] px-3 py-2 text-[11px] leading-4 text-slate-500 dark:border-white/[0.07] dark:bg-white/[0.03] dark:text-slate-400">
            <span className="font-bold text-slate-700 dark:text-slate-200">{model.license.name}</span> · {licenseApproved ? t(settingsModelsMessages, "commercialUsePermitted") : t(settingsModelsMessages, "downloadBlockedTerms")} {model.license.notice}
            {" "}<a href={model.license.url} target="_blank" rel="noreferrer" className="font-bold text-signal-600 hover:underline dark:text-signal-300">{t(settingsModelsMessages, "reviewTerms")}</a>
          </div>
          {model.downloading ? (
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-black/[0.06] dark:bg-white/[0.08]" role="progressbar" aria-label={t(settingsModelsMessages, "downloadProgress", { model: model.displayName })} aria-valuenow={Math.round(model.downloadProgress * 100)} aria-valuemin={0} aria-valuemax={100}>
              <div className="h-full rounded-full bg-signal-500 transition-[width]" style={{ width: `${Math.round(model.downloadProgress * 100)}%` }} />
            </div>
          ) : null}
          {model.error ? <p className="mt-2 text-xs font-semibold text-status-red" role="alert">{model.error}</p> : null}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {!model.downloaded ? (
              <button type="button" onClick={onDownload} disabled={busy || model.downloading || !licenseApproved} aria-label={t(settingsModelsMessages, "downloadModel", { model: model.displayName })} title={licenseApproved ? undefined : t(settingsModelsMessages, "licenseNotApproved")} className="inline-flex min-h-9 items-center gap-2 rounded-xl bg-signal-500 px-3 py-2 text-[11px] font-bold text-white hover:bg-signal-400 disabled:cursor-wait disabled:opacity-60 dark:text-void-950">
                {model.downloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} {licenseApproved ? t(settingsModelsMessages, "download") : t(settingsModelsMessages, "unavailable")}
              </button>
            ) : (
              <button type="button" onClick={onActivate} disabled={busy || active} className="inline-flex min-h-9 items-center gap-2 rounded-xl bg-signal-500 px-3 py-2 text-[11px] font-bold text-white hover:bg-signal-400 disabled:cursor-default disabled:opacity-65 dark:text-void-950">
                <Check className="h-3.5 w-3.5" /> {active ? t(settingsModelsMessages, "active") : t(settingsModelsMessages, model.kind === "transcription" ? "useForInput" : "useForChat")}
              </button>
            )}
            <a href={model.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-black/[0.07] px-3 py-2 text-[11px] font-bold text-slate-500 hover:text-slate-900 dark:border-white/[0.08] dark:hover:text-white">
              <ExternalLink className="h-3.5 w-3.5" /> {t(settingsModelsMessages, "source")}
            </a>
            {model.downloaded && !active ? (
              <button type="button" onClick={onDelete} disabled={busy} aria-label={t(settingsModelsMessages, "deleteModel", { model: model.displayName })} className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-status-red/20 text-status-red hover:bg-status-red/[0.08] disabled:opacity-50">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </article>
  );
};

const CatalogSummaryRow: FunctionComponent<{
  icon: typeof Mic;
  title: string;
  value: string;
  detail: string;
  status: string;
}> = ({ icon: Icon, title, value, detail, status }) => (
  <div className="flex min-w-0 items-center gap-3 rounded-2xl border border-[color:var(--border-hairline)] bg-black/[0.02] px-4 py-3 dark:bg-white/[0.025]">
    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-signal-500/18 bg-signal-500/[0.08] text-signal-600 dark:text-signal-300">
      <Icon className="h-4 w-4" aria-hidden="true" />
    </div>
    <div className="min-w-0 flex-1">
      <p className="text-[9px] font-bold uppercase tracking-[0.16em] text-slate-400">{title}</p>
      <p className="mt-0.5 truncate text-sm font-semibold text-slate-900 dark:text-white">{value}</p>
      <p className="mt-0.5 truncate text-[11px] text-slate-500 dark:text-slate-400">{detail}</p>
    </div>
    <span className="shrink-0 rounded-full border border-signal-500/18 bg-signal-500/[0.06] px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.12em] text-signal-700 dark:text-signal-300">{status}</span>
  </div>
);

export const AIModelCatalogPanel: FunctionComponent<{ state: SettingsPageState }> = ({ state }) => {
  const { locale, formatNumber, translate: t, translatePlural: tp } = useDashboardI18n();
  const { editableSettings, selectedProject, updateEditableSettings } = state;
  const projectId = selectedProject?.id || "";
  const [embeddingModels, setEmbeddingModels] = useState<EmbeddingModelWithStatus[]>([]);
  const [speechModels, setSpeechModels] = useState<SpeechModelStatus[]>([]);
  const [stats, setStats] = useState<MemoryStats>(EMPTY_STATS);
  const [reembed, setReembed] = useState<ReembedProgress | null>(null);
  const [busyModelId, setBusyModelId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [speechSettingsOpen, setSpeechSettingsOpen] = useState(false);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const speechSettingsButtonRef = useRef<HTMLButtonElement>(null);
  const modelCatalogButtonRef = useRef<HTMLButtonElement>(null);
  const [catalogTab, setCatalogTab] = useState<CatalogTab>("all");
  const [catalogSearch, setCatalogSearch] = useState("");
  const [catalogLanguage, setCatalogLanguage] = useState("all");
  const [catalogInstallState, setCatalogInstallState] = useState("all");
  const [, setEmbeddingConfirmationOpen] = useState(false);
  const { isOpen: isLicenseOpen, options: licenseOptions, requestConfirm: requestLicenseAcceptance, handleConfirm: acceptLicense, handleCancel: cancelLicense } = useConfirmDialog();
  const detailWorkspace = useSettingsDetailWorkspace();

  const refresh = useCallback(async (): Promise<void> => {
    const [nextEmbedding, nextSpeech, nextStats] = await Promise.all([
      listEmbeddingModels(),
      listSpeechModels(),
      projectId ? getMemoryStats(projectId) : Promise.resolve(EMPTY_STATS),
    ]);
    setEmbeddingModels(nextEmbedding);
    setSpeechModels(nextSpeech);
    setStats(nextStats);
  }, [projectId]);

  useEffect(() => {
    void refresh().catch((cause) => setError(cause instanceof Error ? cause.message : t(settingsModelsMessages, "catalogLoadError")));
  }, [refresh, t]);

  const isDownloading = speechModels.some((model) => model.downloading) || embeddingModels.some((model) => model.downloading);
  useEffect(() => {
    if (!isDownloading) return;
    const timer = window.setInterval(() => void refresh().catch(() => undefined), 1500);
    return () => window.clearInterval(timer);
  }, [isDownloading, refresh]);

  if (!editableSettings) return null;
  const providerOptions = [
    { value: "local_onnx", label: t(settingsModelsMessages, "local") },
    { value: "external_api", label: t(settingsModelsMessages, "api") },
  ];
  const transcriptionLanguageOptions = [
    { value: "", label: t(settingsModelsMessages, "autoDetect") },
    { value: "en", label: t(settingsModelsMessages, "languageEnglish") },
    { value: "de", label: t(settingsModelsMessages, "languageGerman") },
    { value: "es", label: t(settingsModelsMessages, "languageSpanish") },
    { value: "fr", label: t(settingsModelsMessages, "languageFrench") },
    { value: "it", label: t(settingsModelsMessages, "languageItalian") },
    { value: "pt", label: t(settingsModelsMessages, "languagePortuguese") },
    { value: "hi", label: t(settingsModelsMessages, "languageHindi") },
    { value: "ja", label: t(settingsModelsMessages, "languageJapanese") },
    { value: "zh", label: t(settingsModelsMessages, "languageMandarinChinese") },
  ];
  const synthesisModel = speechModels.find((model) => model.id === editableSettings.speech.synthesis.localModelId);
  const transcriptionModel = speechModels.find((model) => model.id === editableSettings.speech.localModelId);
  const activeEmbeddingModel = embeddingModels.find((model) => model.active);
  const selectedVoice = synthesisModel?.voices.find((voice) => voice.id === editableSettings.speech.synthesis.voice);
  const localTranscriptionLanguageOptions = transcriptionModel?.languages?.length
    ? [
      ...(transcriptionModel.supportsAutomaticLanguageDetection ? [{ value: "", label: t(settingsModelsMessages, "autoDetect") }] : []),
      ...transcriptionModel.languages.map((language) => ({ value: language.code, label: language.label })),
    ]
    : transcriptionLanguageOptions;
  const synthesisLanguageOptions = getSynthesisLanguageOptions(speechModels, locale);
  const selectedSynthesisLanguage = synthesisModel
    ? getVoiceLanguageCode(synthesisModel, selectedVoice) ?? getModelLanguages(synthesisModel)[0]?.code ?? ""
    : "";
  const selectedSynthesisLanguageLabel = synthesisLanguageOptions.find((language) => language.code === selectedSynthesisLanguage)?.label
    ?? synthesisModel?.language
    ?? t(settingsModelsMessages, "chooseLanguage");
  const recommendedSynthesisModel = getRecommendedSynthesisModel(speechModels, selectedSynthesisLanguage);
  const compatibleVoices = synthesisModel?.voices.filter((voice) => getVoiceLanguageCode(synthesisModel, voice) === selectedSynthesisLanguage) ?? [];
  const voiceOptions = compatibleVoices.length
    ? compatibleVoices.map((voice) => ({ value: voice.id, label: `${voice.label} · ${voice.language}` }))
    : [{ value: editableSettings.speech.synthesis.voice, label: editableSettings.speech.synthesis.voice }];

  const run = async (modelId: string, action: () => Promise<void>): Promise<void> => {
    setBusyModelId(modelId);
    setError(null);
    try {
      await action();
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t(settingsModelsMessages, "modelActionFailed"));
    } finally {
      setBusyModelId(null);
    }
  };

  const updateSpeech = (updater: (speech: SpeechSettings) => SpeechSettings): void => {
    updateEditableSettings((current) => ({ ...current, speech: updater(current.speech) }));
  };

  const groups = {
    transcription: speechModels.filter((model) => model.kind === "transcription"),
    synthesis: speechModels.filter((model) => model.kind === "synthesis"),
  };
  const filteredGroups = (() => {
    const filtersActive = catalogTab === "transcription" || catalogTab === "synthesis";
    const normalized = catalogSearch.trim().toLocaleLowerCase(locale);
    const matches = (model: SpeechModelStatus): boolean => {
      const matchesSearch = !filtersActive || !normalized || [
        model.displayName,
        model.id,
        model.description,
        model.language,
        model.adapter,
        model.license.name,
        ...getModelLanguages(model).flatMap((language) => [language.code, language.label]),
      ].some((value) => value.toLocaleLowerCase(locale).includes(normalized));
      const matchesLanguage = !filtersActive || catalogLanguage === "all" || getModelLanguages(model).some((language) => language.code === catalogLanguage);
      const matchesInstallState = !filtersActive || catalogInstallState === "all"
        || (catalogInstallState === "installed" ? model.downloaded : !model.downloaded);
      return matchesSearch && matchesLanguage && matchesInstallState;
    };
    return {
      transcription: groups.transcription.filter(matches),
      synthesis: groups.synthesis.filter(matches),
    };
  })();

  const requestSpeechDownload = async (model: SpeechModelStatus): Promise<void> => {
    const accepted = await requestLicenseAcceptance({
      title: t(settingsModelsMessages, "downloadConfirmationTitle", { model: model.displayName }),
      body: t(settingsModelsMessages, "downloadConfirmationBody", {
        size: formatModelSize(model.sizeBytes, locale),
        license: model.license.name,
        notice: model.license.notice,
      }),
      confirmLabel: t(settingsModelsMessages, "acceptAndDownload"),
      cancelLabel: t(settingsModelsMessages, "cancel"),
      tone: "neutral",
    });
    if (!accepted) return;
    await run(model.id, () => downloadSpeechModel(model.id, model.license.id));
  };

  const applySynthesisLanguage = (languageCode: string): void => {
    const model = getRecommendedSynthesisModel(speechModels, languageCode);
    if (!model) return;
    const voice = getRecommendedVoice(model, languageCode);
    updateSpeech((speech) => ({
      ...speech,
      synthesis: {
        ...speech.synthesis,
        providerMode: "local_onnx",
        localModelId: model.id,
        voice: voice?.id ?? model.defaultVoice ?? speech.synthesis.voice,
      },
    }));
  };

  const openSynthesisCatalog = (languageCode = selectedSynthesisLanguage): void => {
    setCatalogTab("synthesis");
    setCatalogLanguage(languageCode || "all");
    setCatalogSearch("");
    setCatalogInstallState("all");
    setSpeechSettingsOpen(false);
    setCatalogOpen(true);
    detailWorkspace.openSection("local-ai-model-catalog");
  };

  const openSpeechSettings = (): void => {
    setCatalogOpen(false);
    setSpeechSettingsOpen(true);
    detailWorkspace.openSection("local-ai-speech-runtime");
  };

  const openModelCatalog = (): void => {
    setSpeechSettingsOpen(false);
    setCatalogOpen(true);
    detailWorkspace.openSection("local-ai-model-catalog");
  };

  const closeLocalAiWorkspace = (): void => {
    const returnFocusTo = catalogOpen ? modelCatalogButtonRef : speechSettingsButtonRef;
    setSpeechSettingsOpen(false);
    setCatalogOpen(false);
    detailWorkspace.closeSection();
    window.setTimeout(() => returnFocusTo.current?.focus({ preventScroll: true }), 0);
  };

  const speechInputSummary = editableSettings.speech.providerMode === "external_api"
    ? editableSettings.speech.externalTranscription.model || t(settingsModelsMessages, "externalApi")
    : transcriptionModel?.displayName || editableSettings.speech.localModelId;
  const speechOutputSummary = editableSettings.speech.synthesis.providerMode === "external_api"
    ? editableSettings.speech.synthesis.externalSynthesis.model || t(settingsModelsMessages, "externalApi")
    : synthesisModel?.displayName || editableSettings.speech.synthesis.localModelId;
  const speechOutputStatus = editableSettings.speech.synthesis.providerMode === "local_onnx" && speechModels.length > 0 && !synthesisModel?.downloaded
    ? t(settingsModelsMessages, "downloadRequired")
    : editableSettings.speech.synthesis.enabled
      ? t(settingsModelsMessages, "enabled")
      : synthesisModel?.downloaded
        ? t(settingsModelsMessages, "ready")
        : t(settingsModelsMessages, "off");
  const tabOptions: Array<{ id: CatalogTab; label: string }> = [
    { id: "all", label: t(settingsModelsMessages, "all") },
    { id: "transcription", label: t(settingsModelsMessages, "speechInput") },
    { id: "synthesis", label: t(settingsModelsMessages, "speechOutput") },
    { id: "embedding", label: t(settingsModelsMessages, "memory") },
  ];
  const catalogLanguageOptions = (() => {
    const languages = new Map<string, string>();
    const modelsForTab = catalogTab === "transcription"
      ? groups.transcription
      : catalogTab === "synthesis"
        ? groups.synthesis
        : speechModels;
    for (const model of modelsForTab) {
      for (const language of getModelLanguages(model)) languages.set(language.code, language.label);
    }
    return [...languages.entries()].sort((left, right) => left[1].localeCompare(right[1], locale));
  })();

  return (
    <>
      <SectionCard
        title={t(settingsModelsMessages, "localAiRuntime")}
        watermark="MODELS"
        icon={<Boxes strokeWidth={2.3} />}
        accent="cyan"
        drilldown={false}
        featured
        summary={t(settingsModelsMessages, "localAiRuntimeSummary")}
      >
        {error ? <div className="mb-1 rounded-xl border border-status-red/20 bg-status-red/[0.07] px-4 py-3 text-xs font-semibold text-status-red" role="alert">{error}</div> : null}
        <div className="grid gap-3 xl:grid-cols-3">
          <CatalogSummaryRow icon={Mic} title={t(settingsModelsMessages, "speechInput")} value={speechInputSummary} detail={editableSettings.speech.providerMode === "external_api" ? editableSettings.speech.externalTranscription.language || t(settingsModelsMessages, "autoLanguage") : editableSettings.speech.localLanguage || transcriptionModel?.language || t(settingsModelsMessages, "autoLanguage")} status={editableSettings.speech.enabled ? t(settingsModelsMessages, "enabled") : t(settingsModelsMessages, "off")} />
          <CatalogSummaryRow icon={Headphones} title={t(settingsModelsMessages, "speechOutput")} value={speechOutputSummary} detail={editableSettings.speech.synthesis.providerMode === "external_api" ? editableSettings.speech.synthesis.externalSynthesis.voice : selectedSynthesisLanguageLabel} status={speechOutputStatus} />
          <CatalogSummaryRow icon={Waves} title={t(settingsModelsMessages, "memoryEmbeddings")} value={activeEmbeddingModel?.displayName || stats.activeModel || t(settingsModelsMessages, "notConfigured")} detail={`${tp(settingsModelsMessages, "installedModels", embeddingModels.filter((model) => model.downloaded).length, { count: formatNumber(embeddingModels.filter((model) => model.downloaded).length) })} · ${tp(settingsModelsMessages, "staleEmbeddings", stats.staleEmbeddings, { count: formatNumber(stats.staleEmbeddings) })}`} status={activeEmbeddingModel ? t(settingsModelsMessages, "active") : t(settingsModelsMessages, "available")} />
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <button ref={speechSettingsButtonRef} type="button" onClick={openSpeechSettings} aria-controls="speech-settings-workspace" aria-expanded={speechSettingsOpen} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-[color:var(--border-hairline)] bg-black/[0.025] px-4 py-2 text-xs font-bold text-slate-700 transition-colors hover:border-signal-500/25 hover:bg-signal-500/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-signal)] dark:bg-white/[0.035] dark:text-slate-200">
            <Settings2 className="h-4 w-4" aria-hidden="true" /> {t(settingsModelsMessages, "configureSpeech")}
          </button>
          <button ref={modelCatalogButtonRef} type="button" onClick={openModelCatalog} aria-controls="model-catalog-workspace" aria-expanded={catalogOpen} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-signal-500 px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-signal-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-signal)] focus-visible:ring-offset-2 dark:text-void-950">
            <Boxes className="h-4 w-4" aria-hidden="true" /> {t(settingsModelsMessages, "manageLocalModels")}
          </button>
        </div>
      </SectionCard>

      {speechSettingsOpen ? <section id="speech-settings-workspace" aria-labelledby="speech-settings-dialog-title" className="rounded-[1.75rem] border border-[color:var(--border-hairline)] bg-[var(--surface-glass)] p-4 shadow-[var(--elevation-base)] sm:p-6">
        <header className="flex items-start justify-between gap-4 border-b border-[color:var(--border-hairline)] pb-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-signal-600 dark:text-signal-300">{t(settingsModelsMessages, "aiModels")}</p>
            <h2 id="speech-settings-dialog-title" className="mt-1 font-display text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">{t(settingsModelsMessages, "speechRuntime")}</h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t(settingsModelsMessages, "speechRuntimeDescription")}</p>
          </div>
          <button type="button" onClick={closeLocalAiWorkspace} aria-label={t(settingsModelsMessages, "backToAiModels")} className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-xl border border-[color:var(--border-hairline)] px-3 text-xs font-bold text-slate-500 hover:bg-black/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-signal)] dark:hover:bg-white/[0.05]"><ArrowRight className="h-4 w-4 rotate-180" /> {t(settingsModelsMessages, "back")}</button>
        </header>
        <div className="mt-5 grid gap-5 xl:grid-cols-2">
          <div className="order-2 overflow-hidden rounded-2xl border border-black/[0.06] xl:order-1 dark:border-white/[0.07]">
            <div className="flex items-center justify-between gap-3 border-b border-black/[0.06] bg-black/[0.025] px-4 py-3 dark:border-white/[0.06] dark:bg-white/[0.035]">
              <div className="flex items-center gap-2"><Mic className="h-4 w-4 text-signal-500" /><span className="text-xs font-bold uppercase tracking-[0.14em]">{t(settingsModelsMessages, "speechToText")}</span></div>
              <Toggle aria-label={t(settingsModelsMessages, "enableSpeechToText")} value={editableSettings.speech.enabled} onChange={(enabled) => updateSpeech((speech) => ({ ...speech, enabled }))} />
            </div>
            <Row label={t(settingsModelsMessages, "provider")} description={t(settingsModelsMessages, "providerSpeechInputDescription")}>
              <SelectInput aria-label={t(settingsModelsMessages, "speechToTextProvider")} value={editableSettings.speech.providerMode} onChange={(providerMode) => updateSpeech((speech) => ({ ...speech, providerMode: providerMode as SpeechProviderMode }))} options={providerOptions} />
            </Row>
            {editableSettings.speech.providerMode === "local_onnx" ? <Row label={t(settingsModelsMessages, "language")} description={transcriptionModel?.supportsAutomaticLanguageDetection ? t(settingsModelsMessages, "localLanguageAutoDescription") : t(settingsModelsMessages, "localLanguageEnglishDescription")}>
              {transcriptionModel?.supportsAutomaticLanguageDetection ? <SelectInput aria-label={t(settingsModelsMessages, "speechToTextLanguage")} value={editableSettings.speech.localLanguage || ""} onChange={(localLanguage) => updateSpeech((speech) => ({ ...speech, localLanguage: localLanguage || null }))} options={localTranscriptionLanguageOptions} /> : <span className="inline-flex min-h-10 items-center rounded-xl border border-[color:var(--border-hairline)] bg-black/[0.025] px-4 text-sm font-semibold text-slate-600 dark:bg-white/[0.035] dark:text-slate-300">{transcriptionModel?.language || t(settingsModelsMessages, "languageEnglish")}</span>}
            </Row> : null}
            {editableSettings.speech.providerMode === "external_api" ? <>
              <Row label={t(settingsModelsMessages, "language")} description={t(settingsModelsMessages, "languageHintDescription")}><SelectInput aria-label={t(settingsModelsMessages, "speechToTextLanguage")} value={editableSettings.speech.externalTranscription.language || ""} onChange={(language) => updateSpeech((speech) => ({ ...speech, externalTranscription: { ...speech.externalTranscription, language: language || null } }))} options={transcriptionLanguageOptions} /></Row>
              <Row label={t(settingsModelsMessages, "apiEndpoint")} description={t(settingsModelsMessages, "transcriptionEndpointDescription")}><TextInput aria-label={t(settingsModelsMessages, "speechToTextApiEndpoint")} value={editableSettings.speech.externalTranscription.baseUrl} onChange={(baseUrl) => updateSpeech((speech) => ({ ...speech, externalTranscription: { ...speech.externalTranscription, baseUrl } }))} /></Row>
              <Row label={t(settingsModelsMessages, "apiModel")} description={t(settingsModelsMessages, "transcriptionModelExample")}><TextInput aria-label={t(settingsModelsMessages, "speechToTextApiModel")} value={editableSettings.speech.externalTranscription.model} onChange={(model) => updateSpeech((speech) => ({ ...speech, externalTranscription: { ...speech.externalTranscription, model } }))} /></Row>
              <Row label={t(settingsModelsMessages, "apiKey")} description={t(settingsModelsMessages, "selectedScopeSecretDescription")} last><SecretInput aria-label={t(settingsModelsMessages, "speechToTextApiKey")} value={editableSettings.speech.externalTranscription.apiKey} onChange={(apiKey) => updateSpeech((speech) => ({ ...speech, externalTranscription: { ...speech.externalTranscription, apiKey } }))} /></Row>
            </> : null}
          </div>

          <div className="order-1 overflow-hidden rounded-2xl border border-signal-500/20 bg-gradient-to-br from-signal-500/[0.055] to-transparent xl:order-2 dark:border-signal-500/20">
            <div className="flex items-center justify-between gap-3 border-b border-black/[0.06] bg-black/[0.025] px-4 py-3 dark:border-white/[0.06] dark:bg-white/[0.035]">
              <div className="flex items-center gap-2"><Headphones className="h-4 w-4 text-signal-500" /><span className="text-xs font-bold uppercase tracking-[0.14em]">{t(settingsModelsMessages, "textToSpeech")}</span></div>
              <Toggle aria-label={t(settingsModelsMessages, "enableTextToSpeech")} value={editableSettings.speech.synthesis.enabled} onChange={(enabled) => updateSpeech((speech) => ({ ...speech, synthesis: { ...speech.synthesis, enabled } }))} />
            </div>
            {editableSettings.speech.synthesis.providerMode === "local_onnx" && synthesisLanguageOptions.length > 0 ? <Row label={t(settingsModelsMessages, "yourLanguage")} description={t(settingsModelsMessages, "languageRecommendationDescription")}><SelectInput aria-label={t(settingsModelsMessages, "textToSpeechLanguage")} value={selectedSynthesisLanguage} onChange={applySynthesisLanguage} options={synthesisLanguageOptions.map((language) => ({ value: language.code, label: language.label }))} /></Row> : null}
            {editableSettings.speech.synthesis.providerMode === "local_onnx" && recommendedSynthesisModel ? <div className="mx-3 mb-3 rounded-2xl border border-signal-500/20 bg-white/70 p-4 dark:bg-white/[0.035]">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-signal-500/[0.1] px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.13em] text-signal-700 dark:text-signal-300"><Sparkles className="h-3 w-3" aria-hidden="true" /> {t(settingsModelsMessages, "preferredFor", { language: selectedSynthesisLanguageLabel })}</span>
                    <span className="rounded-full border border-signal-500/20 px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.12em] text-signal-700 dark:text-signal-300">{t(settingsModelsMessages, "selected")}</span>
                    <span className={`rounded-full border px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.12em] ${recommendedSynthesisModel.downloaded ? "border-emerald-500/20 text-emerald-600" : "border-amber-500/20 text-amber-600"}`}>{recommendedSynthesisModel.downloaded ? t(settingsModelsMessages, "installed") : t(settingsModelsMessages, "downloadRequired")}</span>
                    <span className="rounded-full border border-slate-400/20 px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.12em] text-slate-500">{editableSettings.speech.synthesis.enabled ? t(settingsModelsMessages, "outputEnabled") : t(settingsModelsMessages, "outputOff")}</span>
                  </div>
                  <p className="mt-2 text-sm font-semibold text-slate-900 dark:text-white">{recommendedSynthesisModel.displayName}</p>
                  <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">{recommendedSynthesisModel.downloaded ? t(settingsModelsMessages, "selectedMatchingVoice") : t(settingsModelsMessages, "nothingDownloads", { size: formatModelSize(recommendedSynthesisModel.sizeBytes, locale) })}</p>
                </div>
                {!recommendedSynthesisModel.downloaded ? <button type="button" aria-label={t(settingsModelsMessages, "downloadRecommendedFor", { model: recommendedSynthesisModel.displayName, language: selectedSynthesisLanguageLabel })} onClick={() => void requestSpeechDownload(recommendedSynthesisModel)} disabled={busyModelId === recommendedSynthesisModel.id || recommendedSynthesisModel.downloading} className="inline-flex min-h-10 w-full shrink-0 items-center justify-center gap-2 rounded-xl bg-signal-500 px-4 py-2 text-xs font-bold text-white hover:bg-signal-400 disabled:cursor-wait disabled:opacity-60 sm:w-auto dark:text-void-950">
                  {recommendedSynthesisModel.downloading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Download className="h-4 w-4" aria-hidden="true" />} {recommendedSynthesisModel.downloading ? formatNumber(recommendedSynthesisModel.downloadProgress, { style: "percent", maximumFractionDigits: 0 }) : t(settingsModelsMessages, "downloadRecommended")}
                </button> : <span className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.07] px-4 py-2 text-xs font-bold text-emerald-700 dark:text-emerald-300"><Check className="h-4 w-4" aria-hidden="true" /> {t(settingsModelsMessages, "modelInstalled")}</span>}
              </div>
              {recommendedSynthesisModel.downloading ? <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-black/[0.06] dark:bg-white/[0.08]" role="progressbar" aria-label={t(settingsModelsMessages, "downloadProgress", { model: recommendedSynthesisModel.displayName })} aria-valuenow={Math.round(recommendedSynthesisModel.downloadProgress * 100)} aria-valuemin={0} aria-valuemax={100}><div className="h-full rounded-full bg-signal-500 transition-[width]" style={{ width: `${Math.round(recommendedSynthesisModel.downloadProgress * 100)}%` }} /></div> : null}
              <button type="button" onClick={() => openSynthesisCatalog()} className="mt-3 inline-flex min-h-9 items-center gap-1.5 text-[11px] font-bold text-signal-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-signal)] dark:text-signal-300">{t(settingsModelsMessages, "compareCompatibleModels")} <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" /></button>
            </div> : null}
            <Row label={t(settingsModelsMessages, "provider")} description={t(settingsModelsMessages, "synthesisProviderDescription")}><SelectInput aria-label={t(settingsModelsMessages, "textToSpeechProvider")} value={editableSettings.speech.synthesis.providerMode} onChange={(providerMode) => updateSpeech((speech) => ({ ...speech, synthesis: { ...speech.synthesis, providerMode: providerMode as SpeechProviderMode } }))} options={providerOptions} /></Row>
            {editableSettings.speech.synthesis.providerMode === "local_onnx" ? <Row label={t(settingsModelsMessages, "localVoice")} description={t(settingsModelsMessages, "localVoiceDescription")}><SelectInput aria-label={t(settingsModelsMessages, "localTextToSpeechVoice")} value={editableSettings.speech.synthesis.voice} onChange={(voice) => updateSpeech((speech) => ({ ...speech, synthesis: { ...speech.synthesis, voice } }))} options={voiceOptions} /></Row> : null}
            <Row label={t(settingsModelsMessages, "speechSpeed")} description={t(settingsModelsMessages, "speechSpeedDescription")}><NumberInput value={editableSettings.speech.synthesis.speed} min={0.5} max={2} step={0.05} onChange={(speed) => updateSpeech((speech) => ({ ...speech, synthesis: { ...speech.synthesis, speed } }))} /></Row>
            {editableSettings.speech.synthesis.providerMode === "external_api" ? <>
              <Row label={t(settingsModelsMessages, "apiEndpoint")} description={t(settingsModelsMessages, "synthesisEndpointDescription")}><TextInput aria-label={t(settingsModelsMessages, "textToSpeechApiEndpoint")} value={editableSettings.speech.synthesis.externalSynthesis.baseUrl} onChange={(baseUrl) => updateSpeech((speech) => ({ ...speech, synthesis: { ...speech.synthesis, externalSynthesis: { ...speech.synthesis.externalSynthesis, baseUrl } } }))} /></Row>
              <Row label={t(settingsModelsMessages, "apiModel")} description={t(settingsModelsMessages, "synthesisModelDescription")}><TextInput aria-label={t(settingsModelsMessages, "textToSpeechApiModel")} value={editableSettings.speech.synthesis.externalSynthesis.model} onChange={(model) => updateSpeech((speech) => ({ ...speech, synthesis: { ...speech.synthesis, externalSynthesis: { ...speech.synthesis.externalSynthesis, model } } }))} /></Row>
              <Row label={t(settingsModelsMessages, "apiVoice")} description={t(settingsModelsMessages, "synthesisVoiceDescription")}><TextInput aria-label={t(settingsModelsMessages, "textToSpeechApiVoice")} value={editableSettings.speech.synthesis.externalSynthesis.voice} onChange={(voice) => updateSpeech((speech) => ({ ...speech, synthesis: { ...speech.synthesis, externalSynthesis: { ...speech.synthesis.externalSynthesis, voice } } }))} /></Row>
              <Row label={t(settingsModelsMessages, "apiFormat")} description={t(settingsModelsMessages, "apiFormatDescription")}><SelectInput aria-label={t(settingsModelsMessages, "textToSpeechApiFormat")} value={editableSettings.speech.synthesis.externalSynthesis.format} onChange={(format) => updateSpeech((speech) => ({ ...speech, synthesis: { ...speech.synthesis, externalSynthesis: { ...speech.synthesis.externalSynthesis, format: format as typeof speech.synthesis.externalSynthesis.format } } }))} options={[{ value: "mp3", label: "MP3" }, { value: "wav", label: "WAV" }, { value: "opus", label: "Opus" }, { value: "aac", label: "AAC" }, { value: "flac", label: "FLAC" }]} /></Row>
              <Row label={t(settingsModelsMessages, "apiKey")} description={t(settingsModelsMessages, "synthesisKeyDescription")} last><SecretInput aria-label={t(settingsModelsMessages, "textToSpeechApiKey")} value={editableSettings.speech.synthesis.externalSynthesis.apiKey} onChange={(apiKey) => updateSpeech((speech) => ({ ...speech, synthesis: { ...speech.synthesis, externalSynthesis: { ...speech.synthesis.externalSynthesis, apiKey } } }))} /></Row>
            </> : null}
          </div>
        </div>
        <footer className="mt-5 flex flex-col-reverse gap-2 border-t border-[color:var(--border-hairline)] pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-slate-400">{t(settingsModelsMessages, "changesAppliedOnSave")}</p>
          <button type="button" onClick={closeLocalAiWorkspace} className="inline-flex min-h-10 w-full items-center justify-center rounded-xl bg-signal-500 px-5 py-2 text-xs font-bold text-white hover:bg-signal-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-signal)] sm:w-auto dark:text-void-950">{t(settingsModelsMessages, "backToOverview")}</button>
        </footer>
      </section> : null}

      {catalogOpen ? <section id="model-catalog-workspace" aria-labelledby="model-catalog-dialog-title" className="rounded-[1.75rem] border border-[color:var(--border-hairline)] bg-[var(--surface-glass)] p-4 shadow-[var(--elevation-base)] sm:p-6">
        <header className="flex items-start justify-between gap-4 border-b border-[color:var(--border-hairline)] pb-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-signal-600 dark:text-signal-300">{t(settingsModelsMessages, "localRuntime")}</p>
            <h2 id="model-catalog-dialog-title" className="mt-1 font-display text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">{t(settingsModelsMessages, "modelCatalog")}</h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t(settingsModelsMessages, "modelCatalogDescription")}</p>
          </div>
          <button type="button" onClick={closeLocalAiWorkspace} aria-label={t(settingsModelsMessages, "backToAiModels")} className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-xl border border-[color:var(--border-hairline)] px-3 text-xs font-bold text-slate-500 hover:bg-black/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-signal)] dark:hover:bg-white/[0.05]"><ArrowRight className="h-4 w-4 rotate-180" /> {t(settingsModelsMessages, "back")}</button>
        </header>
        <div className="sticky top-0 z-10 -mx-1 mt-4 space-y-3 bg-white/95 px-1 py-1 backdrop-blur-xl dark:bg-void-800/95">
          <div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-label={t(settingsModelsMessages, "filterByPurpose")}>
            {tabOptions.map((tab) => <button key={tab.id} type="button" aria-pressed={catalogTab === tab.id} onClick={() => { setCatalogTab(tab.id); setCatalogLanguage("all"); }} className={`shrink-0 rounded-xl border px-3 py-2 text-[11px] font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-signal)] ${catalogTab === tab.id ? "border-signal-500/25 bg-signal-500/[0.1] text-signal-700 dark:text-signal-300" : "border-[color:var(--border-hairline)] text-slate-500 hover:bg-black/[0.03] dark:hover:bg-white/[0.04]"}`}>{tab.label}</button>)}
          </div>
          {catalogTab === "transcription" || catalogTab === "synthesis" ? <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_auto_auto]">
            <label className="flex min-h-11 items-center gap-3 rounded-xl border border-[color:var(--border-hairline)] bg-black/[0.025] px-4 dark:bg-white/[0.035]">
              <Search className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
              <span className="sr-only">{t(settingsModelsMessages, "searchSpeechModels")}</span>
              <input type="search" value={catalogSearch} onInput={(event) => setCatalogSearch(event.currentTarget.value)} placeholder={t(settingsModelsMessages, "searchSpeechPlaceholder")} className="min-w-0 flex-1 bg-transparent text-sm text-slate-800 outline-none placeholder:text-slate-400 dark:text-slate-100" />
              {catalogSearch ? <button type="button" onClick={() => setCatalogSearch("")} aria-label={t(settingsModelsMessages, "clearModelSearch")} className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-black/[0.04] dark:hover:bg-white/[0.05]"><X className="h-3.5 w-3.5" /></button> : null}
            </label>
            <label className="flex min-h-11 items-center gap-2 rounded-xl border border-[color:var(--border-hairline)] bg-black/[0.025] px-3 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400 dark:bg-white/[0.035]">
              <span>{t(settingsModelsMessages, "language")}</span>
              <AvantgardeSelect
                aria-label={t(settingsModelsMessages, "filterByLanguage")}
                value={catalogLanguage}
                onChange={setCatalogLanguage}
                variant="compact"
                className="min-w-[7rem]"
                options={[
                  { value: "all", label: t(settingsModelsMessages, "all") },
                  ...catalogLanguageOptions.map(([value, label]) => ({ value, label })),
                ]}
              />
            </label>
            <label className="flex min-h-11 items-center gap-2 rounded-xl border border-[color:var(--border-hairline)] bg-black/[0.025] px-3 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400 dark:bg-white/[0.035]">
              <span>{t(settingsModelsMessages, "status")}</span>
              <AvantgardeSelect
                aria-label={t(settingsModelsMessages, "filterByInstallStatus")}
                value={catalogInstallState}
                onChange={setCatalogInstallState}
                variant="compact"
                className="min-w-[7rem]"
                options={[
                  { value: "all", label: t(settingsModelsMessages, "all") },
                  { value: "installed", label: t(settingsModelsMessages, "installed") },
                  { value: "available", label: t(settingsModelsMessages, "available") },
                ]}
              />
            </label>
          </div> : null}
        </div>
        <div className="mt-4 space-y-5">
          {(["transcription", "synthesis"] as const).filter((kind) => catalogTab === "all" || catalogTab === kind).map((kind) => (
            <section key={kind} aria-label={t(settingsModelsMessages, kind === "transcription" ? "speechToTextModels" : "textToSpeechModels")}>
              <div className="mb-2 flex items-center justify-between gap-3"><h3 className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">{t(settingsModelsMessages, kind === "transcription" ? "speechInput" : "speechOutput")}</h3><span className="font-mono text-[10px] text-slate-400">{formatNumber(filteredGroups[kind].length)}</span></div>
              <div className="grid gap-3 xl:grid-cols-2">
              {[...filteredGroups[kind]].sort((left, right) => {
                if (kind !== "synthesis" || catalogLanguage === "all") return 0;
                return Number(isRecommendedForLanguage(right, speechModels, catalogLanguage)) - Number(isRecommendedForLanguage(left, speechModels, catalogLanguage));
              }).map((model) => {
                const active = kind === "transcription"
                  ? editableSettings.speech.enabled && editableSettings.speech.localModelId === model.id && editableSettings.speech.providerMode !== "external_api"
                  : editableSettings.speech.synthesis.enabled && editableSettings.speech.synthesis.localModelId === model.id && editableSettings.speech.synthesis.providerMode !== "external_api";
                const recommendationLanguage = kind === "synthesis" && catalogLanguage !== "all" && isRecommendedForLanguage(model, speechModels, catalogLanguage)
                  ? catalogLanguageOptions.find(([code]) => code === catalogLanguage)?.[1]
                  : undefined;
                return <SpeechModelCard key={model.id} model={model} active={active} busy={busyModelId === model.id} recommendationLabel={recommendationLanguage}
                  onDownload={() => void requestSpeechDownload(model)}
                  onDelete={() => void run(model.id, () => deleteSpeechModel(model.id))}
                  onActivate={() => {
                    if (kind === "transcription") updateSpeech((speech) => ({
                      ...speech,
                      enabled: true,
                      providerMode: "local_onnx",
                      localModelId: model.id,
                      localLanguage: model.supportsAutomaticLanguageDetection
                        ? transcriptionModel?.supportsAutomaticLanguageDetection ? speech.localLanguage ?? null : null
                        : "en",
                    }));
                    else updateSpeech((speech) => ({ ...speech, synthesis: { ...speech.synthesis, enabled: true, providerMode: "local_onnx", localModelId: model.id, voice: model.defaultVoice || speech.synthesis.voice } }));
                  }} />;
              })}
              {filteredGroups[kind].length === 0 ? <div className="rounded-2xl border border-dashed border-[color:var(--border-hairline)] px-5 py-8 text-center text-sm text-slate-400 xl:col-span-2" role="status">{t(settingsModelsMessages, kind === "transcription" ? "noMatchingInputModels" : "noMatchingOutputModels")}</div> : null}
            </div>
          </section>
          ))}
          {catalogTab === "all" || catalogTab === "embedding" ? <ModelBrowser
        models={embeddingModels}
        stats={stats}
        reembed={reembed}
        onModelsChanged={setEmbeddingModels}
        onDownload={(modelId) => {
          const model = embeddingModels.find((item) => item.id === modelId);
          if (!model) throw new Error(t(settingsModelsMessages, "unknownEmbeddingModel", { modelId }));
          return run(modelId, () => downloadEmbeddingModel(modelId, model.license.id).then(() => undefined));
        }}
        onSelect={(modelId) => run(modelId, () => selectEmbeddingModel(modelId).then(() => undefined))}
        onDelete={(modelId) => run(modelId, () => deleteEmbeddingModel(modelId))}
        onReembed={async () => {
          if (!projectId) throw new Error(t(settingsModelsMessages, "selectProjectReembed"));
          await startReembed(projectId);
          const progress = await getReembedProgress(projectId);
          setReembed(progress);
        }}
        onConfirmationOpenChange={setEmbeddingConfirmationOpen}
          /> : null}
        </div>
      </section> : null}
      <ConfirmDialog isOpen={isLicenseOpen} options={licenseOptions} onConfirm={acceptLicense} onCancel={cancelLicense} />
    </>
  );
};
