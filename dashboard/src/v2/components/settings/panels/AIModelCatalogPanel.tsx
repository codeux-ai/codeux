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

const EMPTY_STATS: MemoryStats = { sprint: 0, agent: 0, project: 0, activeModel: null, staleEmbeddings: 0 };
const providerOptions = [
  { value: "local_onnx", label: "Local" },
  { value: "external_api", label: "API" },
];
const transcriptionLanguageOptions = [
  { value: "", label: "Auto-detect" },
  { value: "en", label: "English" },
  { value: "de", label: "German" },
  { value: "es", label: "Spanish" },
  { value: "fr", label: "French" },
  { value: "it", label: "Italian" },
  { value: "pt", label: "Portuguese" },
  { value: "hi", label: "Hindi" },
  { value: "ja", label: "Japanese" },
  { value: "zh", label: "Mandarin Chinese" },
];

type CatalogTab = "all" | "transcription" | "synthesis" | "embedding";

function formatSize(bytes: number): string {
  if (!bytes) return "Size varies";
  return bytes >= 1_000_000_000 ? `${(bytes / 1_000_000_000).toFixed(1)} GB` : `${Math.round(bytes / 1_000_000)} MB`;
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
              <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">{model.adapter} · {model.language} · {formatSize(model.sizeBytes)}</p>
              {recommendationLabel ? <span className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-signal-500/20 bg-signal-500/[0.08] px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.12em] text-signal-700 dark:text-signal-300"><Sparkles className="h-3 w-3" aria-hidden="true" /> Preferred for {recommendationLabel}</span> : null}
            </div>
            <span className={`rounded-full border px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.12em] ${repairRequired ? "border-amber-500/25 text-amber-600" : active ? "border-signal-500/25 text-signal-700 dark:text-signal-300" : model.downloaded ? "border-slate-400/20 text-slate-500" : "border-amber-500/20 text-amber-600"}`}>
              {!licenseApproved ? "Unavailable" : repairRequired ? "Repair required" : model.downloading ? `${Math.round(model.downloadProgress * 100)}%` : active ? "Active" : model.downloaded ? "Installed" : "Available"}
            </span>
          </div>
          <p className="mt-2 text-xs leading-5 text-slate-500 dark:text-slate-400">{model.description}</p>
          <div className="mt-2 rounded-xl border border-black/[0.06] bg-black/[0.025] px-3 py-2 text-[11px] leading-4 text-slate-500 dark:border-white/[0.07] dark:bg-white/[0.03] dark:text-slate-400">
            <span className="font-bold text-slate-700 dark:text-slate-200">{model.license.name}</span> · {licenseApproved ? "Commercial use permitted." : "Download blocked until compatible terms are verified."} {model.license.notice}
            {" "}<a href={model.license.url} target="_blank" rel="noreferrer" className="font-bold text-signal-600 hover:underline dark:text-signal-300">Review terms</a>
          </div>
          {model.downloading ? (
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-black/[0.06] dark:bg-white/[0.08]" role="progressbar" aria-label={`${model.displayName} download progress`} aria-valuenow={Math.round(model.downloadProgress * 100)} aria-valuemin={0} aria-valuemax={100}>
              <div className="h-full rounded-full bg-signal-500 transition-[width]" style={{ width: `${Math.round(model.downloadProgress * 100)}%` }} />
            </div>
          ) : null}
          {model.error ? <p className="mt-2 text-xs font-semibold text-status-red" role="alert">{model.error}</p> : null}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {!model.downloaded ? (
              <button type="button" onClick={onDownload} disabled={busy || model.downloading || !licenseApproved} aria-label={`Download ${model.displayName}`} title={licenseApproved ? undefined : "License terms are not approved for download."} className="inline-flex min-h-9 items-center gap-2 rounded-xl bg-signal-500 px-3 py-2 text-[11px] font-bold text-white hover:bg-signal-400 disabled:cursor-wait disabled:opacity-60 dark:text-void-950">
                {model.downloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} {licenseApproved ? "Download" : "Unavailable"}
              </button>
            ) : (
              <button type="button" onClick={onActivate} disabled={busy || active} className="inline-flex min-h-9 items-center gap-2 rounded-xl bg-signal-500 px-3 py-2 text-[11px] font-bold text-white hover:bg-signal-400 disabled:cursor-default disabled:opacity-65 dark:text-void-950">
                <Check className="h-3.5 w-3.5" /> {active ? "Active" : `Use for ${model.kind === "transcription" ? "input" : "3D Chat"}`}
              </button>
            )}
            <a href={model.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-black/[0.07] px-3 py-2 text-[11px] font-bold text-slate-500 hover:text-slate-900 dark:border-white/[0.08] dark:hover:text-white">
              <ExternalLink className="h-3.5 w-3.5" /> Source
            </a>
            {model.downloaded && !active ? (
              <button type="button" onClick={onDelete} disabled={busy} aria-label={`Delete ${model.displayName}`} className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-status-red/20 text-status-red hover:bg-status-red/[0.08] disabled:opacity-50">
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
    void refresh().catch((cause) => setError(cause instanceof Error ? cause.message : "AI model catalog could not be loaded."));
  }, [refresh]);

  const isDownloading = speechModels.some((model) => model.downloading) || embeddingModels.some((model) => model.downloading);
  useEffect(() => {
    if (!isDownloading) return;
    const timer = window.setInterval(() => void refresh().catch(() => undefined), 1500);
    return () => window.clearInterval(timer);
  }, [isDownloading, refresh]);

  if (!editableSettings) return null;
  const synthesisModel = speechModels.find((model) => model.id === editableSettings.speech.synthesis.localModelId);
  const transcriptionModel = speechModels.find((model) => model.id === editableSettings.speech.localModelId);
  const activeEmbeddingModel = embeddingModels.find((model) => model.active);
  const selectedVoice = synthesisModel?.voices.find((voice) => voice.id === editableSettings.speech.synthesis.voice);
  const localTranscriptionLanguageOptions = transcriptionModel?.languages?.length
    ? [
      ...(transcriptionModel.supportsAutomaticLanguageDetection ? [{ value: "", label: "Auto-detect" }] : []),
      ...transcriptionModel.languages.map((language) => ({ value: language.code, label: language.label })),
    ]
    : transcriptionLanguageOptions;
  const synthesisLanguageOptions = getSynthesisLanguageOptions(speechModels);
  const selectedSynthesisLanguage = synthesisModel
    ? getVoiceLanguageCode(synthesisModel, selectedVoice) ?? getModelLanguages(synthesisModel)[0]?.code ?? ""
    : "";
  const selectedSynthesisLanguageLabel = synthesisLanguageOptions.find((language) => language.code === selectedSynthesisLanguage)?.label
    ?? synthesisModel?.language
    ?? "Choose a language";
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
      setError(cause instanceof Error ? cause.message : "Model action failed.");
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
    const normalized = catalogSearch.trim().toLocaleLowerCase();
    const matches = (model: SpeechModelStatus): boolean => {
      const matchesSearch = !filtersActive || !normalized || [
        model.displayName,
        model.id,
        model.description,
        model.language,
        model.adapter,
        model.license.name,
        ...getModelLanguages(model).flatMap((language) => [language.code, language.label]),
      ].some((value) => value.toLocaleLowerCase().includes(normalized));
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
      title: `Download ${model.displayName}`,
      body: `${formatSize(model.sizeBytes)} will be downloaded directly from the listed upstream sources. By continuing, you accept ${model.license.name} and its third-party notices. ${model.license.notice}`,
      confirmLabel: "Accept & Download",
      cancelLabel: "Cancel",
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
    ? editableSettings.speech.externalTranscription.model || "External API"
    : transcriptionModel?.displayName || editableSettings.speech.localModelId;
  const speechOutputSummary = editableSettings.speech.synthesis.providerMode === "external_api"
    ? editableSettings.speech.synthesis.externalSynthesis.model || "External API"
    : synthesisModel?.displayName || editableSettings.speech.synthesis.localModelId;
  const speechOutputStatus = editableSettings.speech.synthesis.providerMode === "local_onnx" && speechModels.length > 0 && !synthesisModel?.downloaded
    ? "Download required"
    : editableSettings.speech.synthesis.enabled
      ? "Enabled"
      : synthesisModel?.downloaded
        ? "Ready"
        : "Off";
  const tabOptions: Array<{ id: CatalogTab; label: string }> = [
    { id: "all", label: "All" },
    { id: "transcription", label: "Speech input" },
    { id: "synthesis", label: "Speech output" },
    { id: "embedding", label: "Memory" },
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
    return [...languages.entries()].sort((left, right) => left[1].localeCompare(right[1]));
  })();

  return (
    <>
      <SectionCard
        title="Local AI Runtime"
        watermark="MODELS"
        icon={<Boxes strokeWidth={2.3} />}
        accent="cyan"
        drilldown={false}
        featured
        summary="See what is active at a glance, then open only the focused speech or model controls you need."
      >
        {error ? <div className="mb-1 rounded-xl border border-status-red/20 bg-status-red/[0.07] px-4 py-3 text-xs font-semibold text-status-red" role="alert">{error}</div> : null}
        <div className="grid gap-3 xl:grid-cols-3">
          <CatalogSummaryRow icon={Mic} title="Speech input" value={speechInputSummary} detail={editableSettings.speech.providerMode === "external_api" ? editableSettings.speech.externalTranscription.language || "Auto language" : editableSettings.speech.localLanguage || transcriptionModel?.language || "Auto language"} status={editableSettings.speech.enabled ? "Enabled" : "Off"} />
          <CatalogSummaryRow icon={Headphones} title="Speech output" value={speechOutputSummary} detail={editableSettings.speech.synthesis.providerMode === "external_api" ? editableSettings.speech.synthesis.externalSynthesis.voice : selectedSynthesisLanguageLabel} status={speechOutputStatus} />
          <CatalogSummaryRow icon={Waves} title="Memory embeddings" value={activeEmbeddingModel?.displayName || stats.activeModel || "Not configured"} detail={`${embeddingModels.filter((model) => model.downloaded).length} installed · ${stats.staleEmbeddings} stale`} status={activeEmbeddingModel ? "Active" : "Available"} />
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <button ref={speechSettingsButtonRef} type="button" onClick={openSpeechSettings} aria-controls="speech-settings-workspace" aria-expanded={speechSettingsOpen} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-[color:var(--border-hairline)] bg-black/[0.025] px-4 py-2 text-xs font-bold text-slate-700 transition-colors hover:border-signal-500/25 hover:bg-signal-500/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-signal)] dark:bg-white/[0.035] dark:text-slate-200">
            <Settings2 className="h-4 w-4" aria-hidden="true" /> Configure speech
          </button>
          <button ref={modelCatalogButtonRef} type="button" onClick={openModelCatalog} aria-controls="model-catalog-workspace" aria-expanded={catalogOpen} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-signal-500 px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-signal-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-signal)] focus-visible:ring-offset-2 dark:text-void-950">
            <Boxes className="h-4 w-4" aria-hidden="true" /> Manage local models
          </button>
        </div>
      </SectionCard>

      {speechSettingsOpen ? <section id="speech-settings-workspace" aria-labelledby="speech-settings-dialog-title" className="rounded-[1.75rem] border border-[color:var(--border-hairline)] bg-[var(--surface-glass)] p-4 shadow-[var(--elevation-base)] sm:p-6">
        <header className="flex items-start justify-between gap-4 border-b border-[color:var(--border-hairline)] pb-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-signal-600 dark:text-signal-300">AI Models</p>
            <h2 id="speech-settings-dialog-title" className="mt-1 font-display text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">Speech runtime</h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Choose a language first. Code UX prepares the preferred local model and voice for you.</p>
          </div>
          <button type="button" onClick={closeLocalAiWorkspace} aria-label="Back to AI Models overview" className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-xl border border-[color:var(--border-hairline)] px-3 text-xs font-bold text-slate-500 hover:bg-black/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-signal)] dark:hover:bg-white/[0.05]"><ArrowRight className="h-4 w-4 rotate-180" /> Back</button>
        </header>
        <div className="mt-5 grid gap-5 xl:grid-cols-2">
          <div className="order-2 overflow-hidden rounded-2xl border border-black/[0.06] xl:order-1 dark:border-white/[0.07]">
            <div className="flex items-center justify-between gap-3 border-b border-black/[0.06] bg-black/[0.025] px-4 py-3 dark:border-white/[0.06] dark:bg-white/[0.035]">
              <div className="flex items-center gap-2"><Mic className="h-4 w-4 text-signal-500" /><span className="text-xs font-bold uppercase tracking-[0.14em]">Speech to text</span></div>
              <Toggle aria-label="Enable speech to text" value={editableSettings.speech.enabled} onChange={(enabled) => updateSpeech((speech) => ({ ...speech, enabled }))} />
            </div>
            <Row label="Provider" description="Use an installed local ONNX model or an OpenAI-compatible API.">
              <SelectInput aria-label="Speech to text provider" value={editableSettings.speech.providerMode} onChange={(providerMode) => updateSpeech((speech) => ({ ...speech, providerMode: providerMode as SpeechProviderMode }))} options={providerOptions} />
            </Row>
            {editableSettings.speech.providerMode === "local_onnx" ? <Row label="Language" description={transcriptionModel?.supportsAutomaticLanguageDetection ? "Auto-detect or prefer one of the languages supported by this Whisper model." : "The selected local model is optimized for English."}>
              {transcriptionModel?.supportsAutomaticLanguageDetection ? <SelectInput aria-label="Speech to text language" value={editableSettings.speech.localLanguage || ""} onChange={(localLanguage) => updateSpeech((speech) => ({ ...speech, localLanguage: localLanguage || null }))} options={localTranscriptionLanguageOptions} /> : <span className="inline-flex min-h-10 items-center rounded-xl border border-[color:var(--border-hairline)] bg-black/[0.025] px-4 text-sm font-semibold text-slate-600 dark:bg-white/[0.035] dark:text-slate-300">English</span>}
            </Row> : null}
            {editableSettings.speech.providerMode === "external_api" ? <>
              <Row label="Language" description="Auto-detect or send a BCP-47 language hint to the transcription provider."><SelectInput aria-label="Speech to text language" value={editableSettings.speech.externalTranscription.language || ""} onChange={(language) => updateSpeech((speech) => ({ ...speech, externalTranscription: { ...speech.externalTranscription, language: language || null } }))} options={transcriptionLanguageOptions} /></Row>
              <Row label="API endpoint" description="OpenAI-compatible transcription base URL."><TextInput aria-label="Speech to text API endpoint" value={editableSettings.speech.externalTranscription.baseUrl} onChange={(baseUrl) => updateSpeech((speech) => ({ ...speech, externalTranscription: { ...speech.externalTranscription, baseUrl } }))} /></Row>
              <Row label="API model" description="For example whisper-1."><TextInput aria-label="Speech to text API model" value={editableSettings.speech.externalTranscription.model} onChange={(model) => updateSpeech((speech) => ({ ...speech, externalTranscription: { ...speech.externalTranscription, model } }))} /></Row>
              <Row label="API key" description="Stored in the selected settings scope." last><SecretInput aria-label="Speech to text API key" value={editableSettings.speech.externalTranscription.apiKey} onChange={(apiKey) => updateSpeech((speech) => ({ ...speech, externalTranscription: { ...speech.externalTranscription, apiKey } }))} /></Row>
            </> : null}
          </div>

          <div className="order-1 overflow-hidden rounded-2xl border border-signal-500/20 bg-gradient-to-br from-signal-500/[0.055] to-transparent xl:order-2 dark:border-signal-500/20">
            <div className="flex items-center justify-between gap-3 border-b border-black/[0.06] bg-black/[0.025] px-4 py-3 dark:border-white/[0.06] dark:bg-white/[0.035]">
              <div className="flex items-center gap-2"><Headphones className="h-4 w-4 text-signal-500" /><span className="text-xs font-bold uppercase tracking-[0.14em]">Text to speech</span></div>
              <Toggle aria-label="Enable text to speech" value={editableSettings.speech.synthesis.enabled} onChange={(enabled) => updateSpeech((speech) => ({ ...speech, synthesis: { ...speech.synthesis, enabled } }))} />
            </div>
            {editableSettings.speech.synthesis.providerMode === "local_onnx" && synthesisLanguageOptions.length > 0 ? <Row label="Your language" description="We automatically select the preferred compatible model and a matching voice."><SelectInput aria-label="Text to speech language" value={selectedSynthesisLanguage} onChange={applySynthesisLanguage} options={synthesisLanguageOptions.map((language) => ({ value: language.code, label: language.label }))} /></Row> : null}
            {editableSettings.speech.synthesis.providerMode === "local_onnx" && recommendedSynthesisModel ? <div className="mx-3 mb-3 rounded-2xl border border-signal-500/20 bg-white/70 p-4 dark:bg-white/[0.035]">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-signal-500/[0.1] px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.13em] text-signal-700 dark:text-signal-300"><Sparkles className="h-3 w-3" aria-hidden="true" /> Preferred for {selectedSynthesisLanguageLabel}</span>
                    <span className="rounded-full border border-signal-500/20 px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.12em] text-signal-700 dark:text-signal-300">Selected</span>
                    <span className={`rounded-full border px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.12em] ${recommendedSynthesisModel.downloaded ? "border-emerald-500/20 text-emerald-600" : "border-amber-500/20 text-amber-600"}`}>{recommendedSynthesisModel.downloaded ? "Installed" : "Download required"}</span>
                    <span className="rounded-full border border-slate-400/20 px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.12em] text-slate-500">{editableSettings.speech.synthesis.enabled ? "Output enabled" : "Output off"}</span>
                  </div>
                  <p className="mt-2 text-sm font-semibold text-slate-900 dark:text-white">{recommendedSynthesisModel.displayName}</p>
                  <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">{recommendedSynthesisModel.downloaded ? "Selected with a matching voice. Save Settings when you are ready." : `${formatSize(recommendedSynthesisModel.sizeBytes)} · Nothing downloads until you approve the license terms.`}</p>
                </div>
                {!recommendedSynthesisModel.downloaded ? <button type="button" aria-label={`Download recommended ${recommendedSynthesisModel.displayName} for ${selectedSynthesisLanguageLabel}`} onClick={() => void requestSpeechDownload(recommendedSynthesisModel)} disabled={busyModelId === recommendedSynthesisModel.id || recommendedSynthesisModel.downloading} className="inline-flex min-h-10 w-full shrink-0 items-center justify-center gap-2 rounded-xl bg-signal-500 px-4 py-2 text-xs font-bold text-white hover:bg-signal-400 disabled:cursor-wait disabled:opacity-60 sm:w-auto dark:text-void-950">
                  {recommendedSynthesisModel.downloading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Download className="h-4 w-4" aria-hidden="true" />} {recommendedSynthesisModel.downloading ? `${Math.round(recommendedSynthesisModel.downloadProgress * 100)}%` : "Download recommended"}
                </button> : <span className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.07] px-4 py-2 text-xs font-bold text-emerald-700 dark:text-emerald-300"><Check className="h-4 w-4" aria-hidden="true" /> Model installed</span>}
              </div>
              {recommendedSynthesisModel.downloading ? <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-black/[0.06] dark:bg-white/[0.08]" role="progressbar" aria-label={`${recommendedSynthesisModel.displayName} download progress`} aria-valuenow={Math.round(recommendedSynthesisModel.downloadProgress * 100)} aria-valuemin={0} aria-valuemax={100}><div className="h-full rounded-full bg-signal-500 transition-[width]" style={{ width: `${Math.round(recommendedSynthesisModel.downloadProgress * 100)}%` }} /></div> : null}
              <button type="button" onClick={() => openSynthesisCatalog()} className="mt-3 inline-flex min-h-9 items-center gap-1.5 text-[11px] font-bold text-signal-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-signal)] dark:text-signal-300">Compare compatible models <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" /></button>
            </div> : null}
            <Row label="Provider" description="Local keeps audio on this device. API uses your configured speech provider."><SelectInput aria-label="Text to speech provider" value={editableSettings.speech.synthesis.providerMode} onChange={(providerMode) => updateSpeech((speech) => ({ ...speech, synthesis: { ...speech.synthesis, providerMode: providerMode as SpeechProviderMode } }))} options={providerOptions} /></Row>
            {editableSettings.speech.synthesis.providerMode === "local_onnx" ? <Row label="Local voice" description="Voice used by the 3D Chat project manager."><SelectInput aria-label="Local text to speech voice" value={editableSettings.speech.synthesis.voice} onChange={(voice) => updateSpeech((speech) => ({ ...speech, synthesis: { ...speech.synthesis, voice } }))} options={voiceOptions} /></Row> : null}
            <Row label="Speech speed" description="0.5× to 2×; 1× keeps the model's natural cadence."><NumberInput value={editableSettings.speech.synthesis.speed} min={0.5} max={2} step={0.05} onChange={(speed) => updateSpeech((speech) => ({ ...speech, synthesis: { ...speech.synthesis, speed } }))} /></Row>
            {editableSettings.speech.synthesis.providerMode === "external_api" ? <>
              <Row label="API endpoint" description="OpenAI-compatible /audio/speech endpoint."><TextInput aria-label="Text to speech API endpoint" value={editableSettings.speech.synthesis.externalSynthesis.baseUrl} onChange={(baseUrl) => updateSpeech((speech) => ({ ...speech, synthesis: { ...speech.synthesis, externalSynthesis: { ...speech.synthesis.externalSynthesis, baseUrl } } }))} /></Row>
              <Row label="API model" description="Provider-specific TTS model id."><TextInput aria-label="Text to speech API model" value={editableSettings.speech.synthesis.externalSynthesis.model} onChange={(model) => updateSpeech((speech) => ({ ...speech, synthesis: { ...speech.synthesis, externalSynthesis: { ...speech.synthesis.externalSynthesis, model } } }))} /></Row>
              <Row label="API voice" description="Provider-specific voice id."><TextInput aria-label="Text to speech API voice" value={editableSettings.speech.synthesis.externalSynthesis.voice} onChange={(voice) => updateSpeech((speech) => ({ ...speech, synthesis: { ...speech.synthesis, externalSynthesis: { ...speech.synthesis.externalSynthesis, voice } } }))} /></Row>
              <Row label="API format" description="Audio format returned by the external provider."><SelectInput aria-label="Text to speech API format" value={editableSettings.speech.synthesis.externalSynthesis.format} onChange={(format) => updateSpeech((speech) => ({ ...speech, synthesis: { ...speech.synthesis, externalSynthesis: { ...speech.synthesis.externalSynthesis, format: format as typeof speech.synthesis.externalSynthesis.format } } }))} options={[{ value: "mp3", label: "MP3" }, { value: "wav", label: "WAV" }, { value: "opus", label: "Opus" }, { value: "aac", label: "AAC" }, { value: "flac", label: "FLAC" }]} /></Row>
              <Row label="API key" description="Used only for external synthesis." last><SecretInput aria-label="Text to speech API key" value={editableSettings.speech.synthesis.externalSynthesis.apiKey} onChange={(apiKey) => updateSpeech((speech) => ({ ...speech, synthesis: { ...speech.synthesis, externalSynthesis: { ...speech.synthesis.externalSynthesis, apiKey } } }))} /></Row>
            </> : null}
          </div>
        </div>
        <footer className="mt-5 flex flex-col-reverse gap-2 border-t border-[color:var(--border-hairline)] pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-slate-400">Changes are applied when you save Settings.</p>
          <button type="button" onClick={closeLocalAiWorkspace} className="inline-flex min-h-10 w-full items-center justify-center rounded-xl bg-signal-500 px-5 py-2 text-xs font-bold text-white hover:bg-signal-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-signal)] sm:w-auto dark:text-void-950">Back to overview</button>
        </footer>
      </section> : null}

      {catalogOpen ? <section id="model-catalog-workspace" aria-labelledby="model-catalog-dialog-title" className="rounded-[1.75rem] border border-[color:var(--border-hairline)] bg-[var(--surface-glass)] p-4 shadow-[var(--elevation-base)] sm:p-6">
        <header className="flex items-start justify-between gap-4 border-b border-[color:var(--border-hairline)] pb-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-signal-600 dark:text-signal-300">Local runtime</p>
            <h2 id="model-catalog-dialog-title" className="mt-1 font-display text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">Model catalog</h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Recommended choices appear first. Every download still requires your approval.</p>
          </div>
          <button type="button" onClick={closeLocalAiWorkspace} aria-label="Back to AI Models overview" className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-xl border border-[color:var(--border-hairline)] px-3 text-xs font-bold text-slate-500 hover:bg-black/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-signal)] dark:hover:bg-white/[0.05]"><ArrowRight className="h-4 w-4 rotate-180" /> Back</button>
        </header>
        <div className="sticky top-0 z-10 -mx-1 mt-4 space-y-3 bg-white/95 px-1 py-1 backdrop-blur-xl dark:bg-void-800/95">
          <div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Filter models by purpose">
            {tabOptions.map((tab) => <button key={tab.id} type="button" aria-pressed={catalogTab === tab.id} onClick={() => { setCatalogTab(tab.id); setCatalogLanguage("all"); }} className={`shrink-0 rounded-xl border px-3 py-2 text-[11px] font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-signal)] ${catalogTab === tab.id ? "border-signal-500/25 bg-signal-500/[0.1] text-signal-700 dark:text-signal-300" : "border-[color:var(--border-hairline)] text-slate-500 hover:bg-black/[0.03] dark:hover:bg-white/[0.04]"}`}>{tab.label}</button>)}
          </div>
          {catalogTab === "transcription" || catalogTab === "synthesis" ? <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_auto_auto]">
            <label className="flex min-h-11 items-center gap-3 rounded-xl border border-[color:var(--border-hairline)] bg-black/[0.025] px-4 dark:bg-white/[0.035]">
              <Search className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
              <span className="sr-only">Search speech models</span>
              <input type="search" value={catalogSearch} onInput={(event) => setCatalogSearch(event.currentTarget.value)} placeholder="Search name, language, family, license" className="min-w-0 flex-1 bg-transparent text-sm text-slate-800 outline-none placeholder:text-slate-400 dark:text-slate-100" />
              {catalogSearch ? <button type="button" onClick={() => setCatalogSearch("")} aria-label="Clear model search" className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-black/[0.04] dark:hover:bg-white/[0.05]"><X className="h-3.5 w-3.5" /></button> : null}
            </label>
            <label className="flex min-h-11 items-center gap-2 rounded-xl border border-[color:var(--border-hairline)] bg-black/[0.025] px-3 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400 dark:bg-white/[0.035]">
              <span>Language</span>
              <AvantgardeSelect
                aria-label="Filter speech models by language"
                value={catalogLanguage}
                onChange={setCatalogLanguage}
                variant="compact"
                className="min-w-[7rem]"
                options={[
                  { value: "all", label: "All" },
                  ...catalogLanguageOptions.map(([value, label]) => ({ value, label })),
                ]}
              />
            </label>
            <label className="flex min-h-11 items-center gap-2 rounded-xl border border-[color:var(--border-hairline)] bg-black/[0.025] px-3 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400 dark:bg-white/[0.035]">
              <span>Status</span>
              <AvantgardeSelect
                aria-label="Filter speech models by install status"
                value={catalogInstallState}
                onChange={setCatalogInstallState}
                variant="compact"
                className="min-w-[7rem]"
                options={[
                  { value: "all", label: "All" },
                  { value: "installed", label: "Installed" },
                  { value: "available", label: "Available" },
                ]}
              />
            </label>
          </div> : null}
        </div>
        <div className="mt-4 space-y-5">
          {(["transcription", "synthesis"] as const).filter((kind) => catalogTab === "all" || catalogTab === kind).map((kind) => (
            <section key={kind} aria-label={kind === "transcription" ? "Speech to text models" : "Text to speech models"}>
              <div className="mb-2 flex items-center justify-between gap-3"><h3 className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">{kind === "transcription" ? "Speech input" : "Speech output"}</h3><span className="font-mono text-[10px] text-slate-400">{filteredGroups[kind].length}</span></div>
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
              {filteredGroups[kind].length === 0 ? <div className="rounded-2xl border border-dashed border-[color:var(--border-hairline)] px-5 py-8 text-center text-sm text-slate-400 xl:col-span-2" role="status">No matching {kind === "transcription" ? "speech input" : "speech output"} models.</div> : null}
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
          if (!model) throw new Error(`Unknown embedding model: ${modelId}`);
          return run(modelId, () => downloadEmbeddingModel(modelId, model.license.id).then(() => undefined));
        }}
        onSelect={(modelId) => run(modelId, () => selectEmbeddingModel(modelId).then(() => undefined))}
        onDelete={(modelId) => run(modelId, () => deleteEmbeddingModel(modelId))}
        onReembed={async () => {
          if (!projectId) throw new Error("Select a project to re-embed its memories.");
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
