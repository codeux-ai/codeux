import * as fs from "fs/promises";
import type { DashboardSettings } from "../contracts/app-types.js";
import type {
  SpeechSettings,
  SpeechTranscriptionErrorCode,
  SpeechTranscriptionProvider,
  SpeechTranscriptionRequestMetadata,
  SpeechTranscriptionResult,
} from "../contracts/speech-types.js";
import { DEFAULT_DASHBOARD_SETTINGS } from "../repositories/settings-defaults.js";
import type { SettingsRepository } from "../repositories/settings-repository.js";
import { redactText } from "../shared/security/redaction.js";
import type { Logger } from "../shared/logging/logger.js";
import {
  decodeWavePcmToFloat32,
  normalizeAudioMimeType,
  resolveKnownAudioDurationSeconds,
  validateSpeechAudio,
} from "./speech-audio-utils.js";
import {
  getSpeechModelPaths,
  isSpeechModelAvailable,
  resolveSpeechModelEntry,
  type SpeechModelCatalogEntry,
} from "./speech-model-catalog.js";

export interface SpeechTranscriptionInput {
  audio: Buffer;
  fileName?: string;
  metadata: SpeechTranscriptionRequestMetadata;
}

export interface LocalSpeechRuntimeResult {
  text: string;
  language: string | null;
  durationSeconds: number | null;
}

export interface LocalOnnxSpeechRuntime {
  isModelAvailable(modelId: string): Promise<boolean>;
  transcribe(args: {
    audio: Float32Array;
    sampleRate: number;
    mimeType: string;
    model: SpeechModelCatalogEntry;
    dataDir?: string;
    language: string | null;
    durationSeconds: number | null;
  }): Promise<LocalSpeechRuntimeResult>;
}

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface SpeechTranscriptionServiceDependencies {
  settingsRepository?: Pick<SettingsRepository, "getDefaultDashboardSettings" | "resolveProjectDashboardSettings" | "resolveSprintDashboardSettings">;
  resolveSpeechSettings?: (projectId?: string | null, sprintId?: string | null) => SpeechSettings;
  localRuntime?: LocalOnnxSpeechRuntime;
  fetchImpl?: FetchLike;
  dataDir?: string;
  requestTimeoutMs?: number;
  logger?: Logger;
}

const DEFAULT_EXTERNAL_TIMEOUT_MS = 30_000;

function errorResult(
  code: SpeechTranscriptionErrorCode,
  message: string,
  options: { provider?: SpeechTranscriptionProvider; retryable?: boolean } = {},
): SpeechTranscriptionResult {
  return {
    ok: false,
    error: {
      code,
      message,
      provider: options.provider,
      retryable: options.retryable ?? false,
    },
  };
}

function providerFailure(
  provider: SpeechTranscriptionProvider,
  message: string,
  retryable = true,
): SpeechTranscriptionResult {
  return errorResult("provider_failure", message, { provider, retryable });
}

function resolveExternalTranscriptionUrl(rawBaseUrl: string): string {
  const trimmed = rawBaseUrl.trim();
  if (!trimmed) {
    return "";
  }
  const url = new URL(trimmed);
  const normalizedPath = url.pathname.replace(/\/+$/, "");
  if (!normalizedPath.endsWith("/audio/transcriptions")) {
    url.pathname = `${normalizedPath || "/v1"}/audio/transcriptions`.replace(/\/{2,}/g, "/");
  }
  return url.toString();
}

function isExternalConfigured(settings: SpeechSettings): boolean {
  return Boolean(
    settings.externalTranscription.baseUrl.trim()
    && settings.externalTranscription.apiKey.trim()
    && settings.externalTranscription.model.trim()
  );
}

function sanitizeProviderMessage(value: unknown, apiKey?: string): string {
  let text = value instanceof Error ? value.message : String(value || "Provider request failed.");
  if (apiKey) {
    text = text.split(apiKey).join("[REDACTED]");
  }
  return redactText(text);
}

async function parseExternalError(response: Response, apiKey: string): Promise<string> {
  const body = await response.text().catch(() => "");
  if (!body.trim()) {
    return `External transcription provider returned HTTP ${response.status}.`;
  }
  try {
    const parsed = JSON.parse(body) as { error?: { message?: unknown } | string; message?: unknown };
    const message = typeof parsed.error === "string"
      ? parsed.error
      : typeof parsed.error?.message === "string"
        ? parsed.error.message
        : typeof parsed.message === "string"
          ? parsed.message
          : body;
    return sanitizeProviderMessage(message, apiKey);
  } catch {
    return sanitizeProviderMessage(body.slice(0, 500), apiKey);
  }
}

async function readLabels(labelsPath: string | null): Promise<string[] | null> {
  if (!labelsPath) {
    return null;
  }
  try {
    const raw = await fs.readFile(labelsPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed) && parsed.every((entry) => typeof entry === "string")) {
      return parsed;
    }
    if (parsed && typeof parsed === "object") {
      const vocab = (parsed as { model?: { vocab?: Record<string, unknown> }; vocab?: Record<string, unknown> }).model?.vocab
        ?? (parsed as { vocab?: Record<string, unknown> }).vocab;
      if (vocab && typeof vocab === "object") {
        const labels: string[] = [];
        for (const [token, id] of Object.entries(vocab)) {
          if (typeof id === "number" && Number.isInteger(id) && id >= 0) labels[id] = token;
        }
        return labels;
      }
    }
  } catch {
    return null;
  }
  return null;
}

function resampleLinear(samples: Float32Array, sourceRate: number, targetRate: number): Float32Array {
  if (sourceRate === targetRate || samples.length === 0) return samples;
  const outputLength = Math.max(1, Math.round(samples.length * targetRate / sourceRate));
  const output = new Float32Array(outputLength);
  const ratio = sourceRate / targetRate;
  for (let index = 0; index < outputLength; index += 1) {
    const position = index * ratio;
    const left = Math.floor(position);
    const right = Math.min(samples.length - 1, left + 1);
    const fraction = position - left;
    output[index] = (samples[left] ?? 0) * (1 - fraction) + (samples[right] ?? 0) * fraction;
  }
  return output;
}

function decodeCtcLogits(data: Iterable<number | bigint>, dims: readonly number[], labels: string[]): string {
  const vocabularySize = dims.at(-1) ?? labels.length;
  if (!vocabularySize || vocabularySize <= 1) throw new Error("CTC model returned invalid logits.");
  const values = Array.from(data, Number);
  const frames = Math.floor(values.length / vocabularySize);
  const tokens: number[] = [];
  let previous = -1;
  for (let frame = 0; frame < frames; frame += 1) {
    let bestId = 0;
    let bestValue = Number.NEGATIVE_INFINITY;
    for (let id = 0; id < vocabularySize; id += 1) {
      const value = values[frame * vocabularySize + id] ?? Number.NEGATIVE_INFINITY;
      if (value > bestValue) {
        bestValue = value;
        bestId = id;
      }
    }
    if (bestId !== 0 && bestId !== previous) tokens.push(bestId);
    previous = bestId;
  }
  return tokens
    .map((id) => labels[id] ?? "")
    .filter((token) => !token.startsWith("<"))
    .join("")
    .replace(/\|/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export class DefaultLocalOnnxSpeechRuntime implements LocalOnnxSpeechRuntime {
  constructor(private readonly dataDir?: string) {}

  async isModelAvailable(modelId: string): Promise<boolean> {
    return await isSpeechModelAvailable(modelId, this.dataDir);
  }

  async transcribe(args: {
    audio: Float32Array;
    sampleRate: number;
    mimeType: string;
    model: SpeechModelCatalogEntry;
    dataDir?: string;
    language: string | null;
    durationSeconds: number | null;
  }): Promise<LocalSpeechRuntimeResult> {
    let ort: typeof import("onnxruntime-node");
    try {
      ort = await import("onnxruntime-node");
    } catch {
      throw new Error("ONNX Runtime is unavailable.");
    }

    const paths = getSpeechModelPaths(args.model.id, args.dataDir ?? this.dataDir);
    const session = await ort.InferenceSession.create(paths.modelPath);
    const inputName = session.inputNames[0];
    if (!inputName) {
      throw new Error("Local ONNX model does not declare an input tensor.");
    }

    if (args.model.adapter === "whisper") {
      throw new Error("This Whisper ONNX bundle requires encoder-decoder generation; choose Wav2Vec2 for direct local waveform transcription or use the external Whisper API.");
    }
    const samples = resampleLinear(args.audio, args.sampleRate, args.model.sampleRateHz);
    const outputs = await session.run({
      [inputName]: new ort.Tensor("float32", samples, [1, samples.length]),
    });
    const output = Object.values(outputs)[0];
    if (!output) {
      throw new Error("Local ONNX model did not return an output tensor.");
    }

    if (Array.isArray(output.data) && output.data.every((entry) => typeof entry === "string")) {
      return {
        text: output.data.join(" ").trim(),
        language: args.language,
        durationSeconds: args.durationSeconds,
      };
    }

    const labels = await readLabels(paths.labelsPath);
    if (labels) {
      if (output.dims.length >= 3) {
        return {
          text: decodeCtcLogits(output.data as Iterable<number | bigint>, output.dims, labels),
          language: args.language,
          durationSeconds: args.durationSeconds,
        };
      }
      const tokenIds = Array.from(output.data as Iterable<number | bigint>)
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value >= 0 && value < labels.length);
      return {
        text: tokenIds.map((tokenId) => labels[tokenId]).join("").trim(),
        language: args.language,
        durationSeconds: args.durationSeconds,
      };
    }

    throw new Error("Local ONNX model did not return decodable text output.");
  }
}

export class SpeechTranscriptionService {
  private readonly localRuntime: LocalOnnxSpeechRuntime;
  private readonly fetchImpl: FetchLike;
  private readonly requestTimeoutMs: number;

  constructor(private readonly deps: SpeechTranscriptionServiceDependencies = {}) {
    this.localRuntime = deps.localRuntime ?? new DefaultLocalOnnxSpeechRuntime(deps.dataDir);
    this.fetchImpl = deps.fetchImpl ?? fetch;
    this.requestTimeoutMs = deps.requestTimeoutMs ?? DEFAULT_EXTERNAL_TIMEOUT_MS;
  }

  async transcribe(input: SpeechTranscriptionInput): Promise<SpeechTranscriptionResult> {
    const settings = this.resolveSettings(input.metadata.projectId, input.metadata.sprintId);
    if (!settings.enabled) {
      return errorResult("permission_denied", "Speech transcription is disabled for this scope.", {
        retryable: false,
      });
    }

    const durationSeconds = resolveKnownAudioDurationSeconds({
      buffer: input.audio,
      mimeType: input.metadata.mimeType,
      metadataDurationSeconds: input.metadata.durationSeconds,
    });
    const audioError = validateSpeechAudio({
      audioBytes: input.audio.length,
      mimeType: input.metadata.mimeType,
      durationSeconds,
      maxAudioSeconds: settings.maxAudioSeconds,
    });
    if (audioError) {
      return errorResult(audioError.code, audioError.message, { retryable: false });
    }

    if (settings.providerMode === "external_api") {
      return await this.transcribeExternal(input, settings, durationSeconds);
    }
    return await this.transcribeLocal(input, settings, durationSeconds);
  }

  private resolveSettings(projectId?: string | null, sprintId?: string | null): SpeechSettings {
    if (this.deps.resolveSpeechSettings) {
      return this.deps.resolveSpeechSettings(projectId, sprintId);
    }
    if (!this.deps.settingsRepository || !projectId) {
      return this.deps.settingsRepository?.getDefaultDashboardSettings().speech
        ?? DEFAULT_DASHBOARD_SETTINGS.speech;
    }
    const response = sprintId
      ? this.deps.settingsRepository.resolveSprintDashboardSettings(projectId, sprintId)
      : this.deps.settingsRepository.resolveProjectDashboardSettings(projectId);
    return response.settings.speech;
  }

  private async transcribeLocal(
    input: SpeechTranscriptionInput,
    settings: SpeechSettings,
    durationSeconds: number | null,
  ): Promise<SpeechTranscriptionResult> {
    const model = resolveSpeechModelEntry(settings.localModelId);
    if (!await this.localRuntime.isModelAvailable(model.id)) {
      return errorResult(
        "missing_local_model",
        `Local speech model "${model.id}" is not installed.`,
        { provider: "local_onnx", retryable: false },
      );
    }

    try {
      const language = input.metadata.language ?? settings.externalTranscription.language ?? null;
      const decodedAudio = decodeWavePcmToFloat32(input.audio);
      const result = await this.localRuntime.transcribe({
        audio: decodedAudio.samples,
        sampleRate: decodedAudio.sampleRate,
        mimeType: normalizeAudioMimeType(input.metadata.mimeType),
        model,
        dataDir: this.deps.dataDir,
        language,
        durationSeconds,
      });
      return {
        ok: true,
        text: result.text,
        provider: "local_onnx",
        model: model.id,
        language: result.language,
        durationSeconds: result.durationSeconds,
        fallback: null,
      };
    } catch (error) {
      this.deps.logger?.warn("Local speech transcription failed", {
        provider: "local_onnx",
        model: model.id,
        error: sanitizeProviderMessage(error),
      });
      return providerFailure("local_onnx", sanitizeProviderMessage(error));
    }
  }

  private async transcribeExternal(
    input: SpeechTranscriptionInput,
    settings: SpeechSettings,
    durationSeconds: number | null,
  ): Promise<SpeechTranscriptionResult> {
    if (!isExternalConfigured(settings)) {
      return errorResult("client_error", "External transcription API is not configured.", {
        provider: "external_api",
        retryable: false,
      });
    }

    const external = settings.externalTranscription;
    let url: string;
    try {
      url = resolveExternalTranscriptionUrl(external.baseUrl);
    } catch {
      return errorResult("client_error", "External transcription API URL is invalid.", {
        provider: "external_api",
        retryable: false,
      });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      const formData = new FormData();
      const audioBytes = new Uint8Array(input.audio.buffer, input.audio.byteOffset, input.audio.byteLength);
      const blob = new Blob([audioBytes.slice()], { type: normalizeAudioMimeType(input.metadata.mimeType) });
      formData.set("file", blob, input.fileName || "audio");
      formData.set("model", external.model.trim());
      const language = input.metadata.language ?? external.language ?? null;
      if (language) {
        formData.set("language", language);
      }

      const response = await this.fetchImpl(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${external.apiKey.trim()}`,
        },
        body: formData,
        signal: controller.signal,
      });

      if (!response.ok) {
        const message = await parseExternalError(response, external.apiKey);
        return providerFailure("external_api", message, response.status >= 500 || response.status === 429);
      }

      const parsed = await response.json() as { text?: unknown; language?: unknown; duration?: unknown; durationSeconds?: unknown };
      const text = typeof parsed.text === "string" ? parsed.text.trim() : "";
      if (!text) {
        return providerFailure("external_api", "External transcription provider returned no text.", false);
      }
      const responseDuration = typeof parsed.durationSeconds === "number"
        ? parsed.durationSeconds
        : typeof parsed.duration === "number"
          ? parsed.duration
          : durationSeconds;
      return {
        ok: true,
        text,
        provider: "external_api",
        model: external.model.trim(),
        language: typeof parsed.language === "string" && parsed.language.trim()
          ? parsed.language.trim()
          : input.metadata.language ?? external.language ?? null,
        durationSeconds: Number.isFinite(responseDuration) ? responseDuration : durationSeconds,
        fallback: null,
      };
    } catch (error) {
      const message = error instanceof Error && error.name === "AbortError"
        ? "External transcription provider timed out."
        : sanitizeProviderMessage(error, external.apiKey);
      return providerFailure("external_api", message);
    } finally {
      clearTimeout(timeout);
    }
  }
}
