import type { FunctionComponent } from "preact";
import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import { Check, Download, ExternalLink, Headphones, Loader2, Mic, Trash2, Volume2, Waves } from "lucide-preact";
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
import { SectionCard } from "./SharedPanelComponents.js";
import { useConfirmDialog } from "../../../hooks/use-confirm-dialog.js";
import { ConfirmDialog } from "../../ui/ConfirmDialog.js";

const EMPTY_STATS: MemoryStats = { sprint: 0, agent: 0, project: 0, activeModel: null, staleEmbeddings: 0 };
const providerOptions = [
  { value: "local_onnx", label: "Local" },
  { value: "external_api", label: "API" },
];

function formatSize(bytes: number): string {
  if (!bytes) return "Size varies";
  return bytes >= 1_000_000_000 ? `${(bytes / 1_000_000_000).toFixed(1)} GB` : `${Math.round(bytes / 1_000_000)} MB`;
}

const SpeechModelCard: FunctionComponent<{
  model: SpeechModelStatus;
  active: boolean;
  busy: boolean;
  activationDisabledReason?: string;
  onDownload: () => void;
  onActivate: () => void;
  onDelete: () => void;
}> = ({ model, active, busy, activationDisabledReason, onDownload, onActivate, onDelete }) => {
  const Icon = model.kind === "transcription" ? Mic : Volume2;
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
            <div>
              <h4 className="font-semibold text-slate-900 dark:text-white">{model.displayName}</h4>
              <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">{model.adapter} · {model.language} · {formatSize(model.sizeBytes)}</p>
            </div>
            <span className={`rounded-full border px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.12em] ${repairRequired ? "border-amber-500/25 text-amber-600" : active ? "border-signal-500/25 text-signal-700 dark:text-signal-300" : model.downloaded ? "border-slate-400/20 text-slate-500" : "border-amber-500/20 text-amber-600"}`}>
              {repairRequired ? "Repair required" : model.downloading ? `${Math.round(model.downloadProgress * 100)}%` : active ? "Active" : model.downloaded ? "Installed" : "Available"}
            </span>
          </div>
          <p className="mt-2 text-xs leading-5 text-slate-500 dark:text-slate-400">{model.description}</p>
          <div className="mt-2 rounded-xl border border-black/[0.06] bg-black/[0.025] px-3 py-2 text-[11px] leading-4 text-slate-500 dark:border-white/[0.07] dark:bg-white/[0.03] dark:text-slate-400">
            <span className="font-bold text-slate-700 dark:text-slate-200">{model.license.name}</span> · Commercial use permitted. {model.license.notice}
            {" "}<a href={model.license.url} target="_blank" rel="noreferrer" className="font-bold text-signal-600 hover:underline dark:text-signal-300">Review terms</a>
          </div>
          {model.downloading ? (
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-black/[0.06] dark:bg-white/[0.08]" role="progressbar" aria-valuenow={Math.round(model.downloadProgress * 100)} aria-valuemin={0} aria-valuemax={100}>
              <div className="h-full rounded-full bg-signal-500 transition-[width]" style={{ width: `${Math.round(model.downloadProgress * 100)}%` }} />
            </div>
          ) : null}
          {model.error ? <p className="mt-2 text-xs font-semibold text-status-red" role="alert">{model.error}</p> : null}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {!model.downloaded ? (
              <button type="button" onClick={onDownload} disabled={busy || model.downloading} className="inline-flex min-h-9 items-center gap-2 rounded-xl bg-signal-500 px-3 py-2 text-[11px] font-bold text-white hover:bg-signal-400 disabled:cursor-wait disabled:opacity-60 dark:text-void-950">
                {model.downloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} Download
              </button>
            ) : (
              <button type="button" onClick={onActivate} disabled={busy || active || Boolean(activationDisabledReason)} title={activationDisabledReason} className="inline-flex min-h-9 items-center gap-2 rounded-xl bg-signal-500 px-3 py-2 text-[11px] font-bold text-white hover:bg-signal-400 disabled:cursor-default disabled:opacity-65 dark:text-void-950">
                <Check className="h-3.5 w-3.5" /> {active ? "Active" : activationDisabledReason ? "Local runtime pending" : `Use for ${model.kind === "transcription" ? "input" : "3D Chat"}`}
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

export const AIModelCatalogPanel: FunctionComponent<{ state: SettingsPageState }> = ({ state }) => {
  const { editableSettings, selectedProject, updateEditableSettings } = state;
  const projectId = selectedProject?.id || "";
  const [embeddingModels, setEmbeddingModels] = useState<EmbeddingModelWithStatus[]>([]);
  const [speechModels, setSpeechModels] = useState<SpeechModelStatus[]>([]);
  const [stats, setStats] = useState<MemoryStats>(EMPTY_STATS);
  const [reembed, setReembed] = useState<ReembedProgress | null>(null);
  const [busyModelId, setBusyModelId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { isOpen: isLicenseOpen, options: licenseOptions, requestConfirm: requestLicenseAcceptance, handleConfirm: acceptLicense, handleCancel: cancelLicense } = useConfirmDialog();

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
  const voiceOptions = synthesisModel?.voices.length
    ? synthesisModel.voices.map((voice) => ({ value: voice.id, label: `${voice.label} · ${voice.language}` }))
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

  const groups = useMemo(() => ({
    transcription: speechModels.filter((model) => model.kind === "transcription"),
    synthesis: speechModels.filter((model) => model.kind === "synthesis"),
  }), [speechModels]);

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

  return (
    <>
      <SectionCard title="Speech Runtime" watermark="VOICE" icon={<Waves strokeWidth={2.3} />}>
        {error ? <div className="mb-4 rounded-xl border border-status-red/20 bg-status-red/[0.07] px-4 py-3 text-xs font-semibold text-status-red" role="alert">{error}</div> : null}
        <div className="grid gap-5 xl:grid-cols-2">
          <div className="overflow-hidden rounded-2xl border border-black/[0.06] dark:border-white/[0.07]">
            <div className="flex items-center justify-between gap-3 border-b border-black/[0.06] bg-black/[0.025] px-4 py-3 dark:border-white/[0.06] dark:bg-white/[0.035]">
              <div className="flex items-center gap-2"><Mic className="h-4 w-4 text-signal-500" /><span className="text-xs font-bold uppercase tracking-[0.14em]">Speech to text</span></div>
              <Toggle aria-label="Enable speech to text" value={editableSettings.speech.enabled} onChange={(enabled) => updateSpeech((speech) => ({ ...speech, enabled }))} />
            </div>
            <Row label="Provider" description="Use an installed local ONNX model or an OpenAI-compatible API.">
              <SelectInput aria-label="Speech to text provider" value={editableSettings.speech.providerMode} onChange={(providerMode) => updateSpeech((speech) => ({ ...speech, providerMode: providerMode as SpeechProviderMode }))} options={providerOptions} />
            </Row>
            {editableSettings.speech.providerMode === "external_api" ? <>
              <Row label="API endpoint" description="OpenAI-compatible transcription base URL."><TextInput aria-label="Speech to text API endpoint" value={editableSettings.speech.externalTranscription.baseUrl} onChange={(baseUrl) => updateSpeech((speech) => ({ ...speech, externalTranscription: { ...speech.externalTranscription, baseUrl } }))} /></Row>
              <Row label="API model" description="For example whisper-1."><TextInput aria-label="Speech to text API model" value={editableSettings.speech.externalTranscription.model} onChange={(model) => updateSpeech((speech) => ({ ...speech, externalTranscription: { ...speech.externalTranscription, model } }))} /></Row>
              <Row label="API key" description="Stored in the selected settings scope." last><SecretInput aria-label="Speech to text API key" value={editableSettings.speech.externalTranscription.apiKey} onChange={(apiKey) => updateSpeech((speech) => ({ ...speech, externalTranscription: { ...speech.externalTranscription, apiKey } }))} /></Row>
            </> : null}
          </div>

          <div className="overflow-hidden rounded-2xl border border-black/[0.06] dark:border-white/[0.07]">
            <div className="flex items-center justify-between gap-3 border-b border-black/[0.06] bg-black/[0.025] px-4 py-3 dark:border-white/[0.06] dark:bg-white/[0.035]">
              <div className="flex items-center gap-2"><Headphones className="h-4 w-4 text-signal-500" /><span className="text-xs font-bold uppercase tracking-[0.14em]">Text to speech</span></div>
              <Toggle aria-label="Enable text to speech" value={editableSettings.speech.synthesis.enabled} onChange={(enabled) => updateSpeech((speech) => ({ ...speech, synthesis: { ...speech.synthesis, enabled } }))} />
            </div>
            <Row label="Provider" description="Use an installed local ONNX model or an OpenAI-compatible API."><SelectInput aria-label="Text to speech provider" value={editableSettings.speech.synthesis.providerMode} onChange={(providerMode) => updateSpeech((speech) => ({ ...speech, synthesis: { ...speech.synthesis, providerMode: providerMode as SpeechProviderMode } }))} options={providerOptions} /></Row>
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
      </SectionCard>

      <SectionCard title="Speech Model Catalog" watermark="ONNX" icon={<Volume2 strokeWidth={2.3} />}>
        <p className="mb-4 text-xs leading-5 text-slate-500 dark:text-slate-400">Downloads are shared across projects. Activation is saved in the current system or project scope; activating a TTS model also enables voice for 3D Chat by default.</p>
        {(["transcription", "synthesis"] as const).map((kind) => (
          <section key={kind} className="mb-5 last:mb-0" aria-label={kind === "transcription" ? "Speech to text models" : "Text to speech models"}>
            <h4 className="mb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">{kind === "transcription" ? "Speech to text" : "Text to speech"}</h4>
            <div className="grid gap-3 xl:grid-cols-2">
              {groups[kind].map((model) => {
                const active = kind === "transcription"
                  ? editableSettings.speech.enabled && editableSettings.speech.localModelId === model.id && editableSettings.speech.providerMode !== "external_api"
                  : editableSettings.speech.synthesis.enabled && editableSettings.speech.synthesis.localModelId === model.id && editableSettings.speech.synthesis.providerMode !== "external_api";
                return <SpeechModelCard key={model.id} model={model} active={active} busy={busyModelId === model.id}
                  activationDisabledReason={model.kind === "transcription" && model.adapter === "whisper" ? "Whisper local generation is not available yet. Select API mode for Whisper, or activate Wav2Vec2 for local input." : undefined}
                  onDownload={() => void requestSpeechDownload(model)}
                  onDelete={() => void run(model.id, () => deleteSpeechModel(model.id))}
                  onActivate={() => {
                    if (kind === "transcription") updateSpeech((speech) => ({ ...speech, enabled: true, providerMode: "local_onnx", localModelId: model.id }));
                    else updateSpeech((speech) => ({ ...speech, synthesis: { ...speech.synthesis, enabled: true, providerMode: "local_onnx", localModelId: model.id, voice: model.defaultVoice || speech.synthesis.voice } }));
                  }} />;
              })}
            </div>
          </section>
        ))}
      </SectionCard>

      <ModelBrowser
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
      />
      <ConfirmDialog isOpen={isLicenseOpen} options={licenseOptions} onConfirm={acceptLicense} onCancel={cancelLicense} />
    </>
  );
};
