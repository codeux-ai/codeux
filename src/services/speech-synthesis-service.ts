import * as fs from "fs/promises";
import { execFile } from "child_process";
import { promisify } from "util";
import type {
  SpeechSettings,
  SpeechSynthesisInput,
  SpeechSynthesisResult,
  SpeechTranscriptionProvider,
} from "../contracts/speech-types.js";
import type { SettingsRepository } from "../repositories/settings-repository.js";
import { DEFAULT_DASHBOARD_SETTINGS } from "../repositories/settings-defaults.js";
import type { Logger } from "../shared/logging/logger.js";
import { redactText } from "../shared/security/redaction.js";
import {
  getSpeechModelPaths,
  isSpeechModelAvailable,
  resolveSpeechModelEntry,
} from "./speech-model-catalog.js";

type FetchLike = typeof fetch;
const execFileAsync = promisify(execFile);
const DEFAULT_TIMEOUT_MS = 45_000;
const MAX_SYNTHESIS_TEXT_LENGTH = 8_000;

export interface SpeechSynthesisServiceDependencies {
  settingsRepository?: Pick<SettingsRepository, "getDefaultDashboardSettings" | "resolveProjectDashboardSettings" | "resolveSprintDashboardSettings">;
  resolveSpeechSettings?: (projectId?: string | null, sprintId?: string | null) => SpeechSettings;
  fetchImpl?: FetchLike;
  dataDir?: string;
  requestTimeoutMs?: number;
  logger?: Logger;
  phonemize?: (text: string, voice: string) => Promise<string>;
}

const failure = (
  code: "missing_local_model" | "permission_denied" | "client_error" | "provider_failure",
  message: string,
  provider?: SpeechTranscriptionProvider,
  retryable = false,
): SpeechSynthesisResult => ({ ok: false, error: { code, message, provider, retryable } });

function resolveExternalSynthesisUrl(baseUrl: string): string {
  const url = new URL(baseUrl.trim());
  const normalized = url.pathname.replace(/\/+$/, "");
  if (!normalized.endsWith("/audio/speech")) {
    url.pathname = `${normalized || "/v1"}/audio/speech`.replace(/\/{2,}/g, "/");
  }
  return url.toString();
}

function encodeWave(samples: Float32Array, sampleRate: number): Buffer {
  const pcmBytes = samples.length * 2;
  const output = Buffer.alloc(44 + pcmBytes);
  output.write("RIFF", 0);
  output.writeUInt32LE(36 + pcmBytes, 4);
  output.write("WAVE", 8);
  output.write("fmt ", 12);
  output.writeUInt32LE(16, 16);
  output.writeUInt16LE(1, 20);
  output.writeUInt16LE(1, 22);
  output.writeUInt32LE(sampleRate, 24);
  output.writeUInt32LE(sampleRate * 2, 28);
  output.writeUInt16LE(2, 32);
  output.writeUInt16LE(16, 34);
  output.write("data", 36);
  output.writeUInt32LE(pcmBytes, 40);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index] ?? 0));
    output.writeInt16LE(Math.round(sample < 0 ? sample * 0x8000 : sample * 0x7fff), 44 + index * 2);
  }
  return output;
}

function floatOutput(value: unknown): Float32Array {
  if (value instanceof Float32Array) return value;
  if (ArrayBuffer.isView(value)) return Float32Array.from(value as unknown as Iterable<number>);
  if (Array.isArray(value)) return Float32Array.from(value as number[]);
  throw new Error("The ONNX speech model returned an unsupported audio tensor.");
}

async function defaultPhonemize(text: string, voice: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("espeak-ng", ["--ipa=3", "-q", "-v", voice, text], {
      encoding: "utf8",
      maxBuffer: 2 * 1024 * 1024,
      timeout: 15_000,
    });
    return stdout.replace(/\s*\n\s*/g, " ").trim();
  } catch {
    // Piper configs and Kokoro tokenizers both retain a grapheme subset. This
    // keeps local synthesis usable in minimal desktop/container installs; an
    // available espeak-ng binary still provides substantially better G2P.
    return text.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
  }
}

export class SpeechSynthesisService {
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private readonly phonemize: (text: string, voice: string) => Promise<string>;

  constructor(private readonly deps: SpeechSynthesisServiceDependencies = {}) {
    this.fetchImpl = deps.fetchImpl ?? fetch;
    this.timeoutMs = deps.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.phonemize = deps.phonemize ?? defaultPhonemize;
  }

  async synthesize(input: SpeechSynthesisInput): Promise<SpeechSynthesisResult> {
    const text = input.text.trim();
    if (!text) return failure("client_error", "Speech synthesis text is required.");
    if (text.length > MAX_SYNTHESIS_TEXT_LENGTH) {
      return failure("client_error", `Speech synthesis text must not exceed ${MAX_SYNTHESIS_TEXT_LENGTH} characters.`);
    }

    const settings = this.resolveSettings(input.projectId, input.sprintId);
    const synthesis = settings.synthesis;
    if (!synthesis.enabled) return failure("permission_denied", "Text-to-speech is disabled for this scope.");

    if (synthesis.providerMode === "external_api") return await this.synthesizeExternal(text, input.voice, settings);
    return await this.synthesizeLocal(text, input.voice, settings);
  }

  private resolveSettings(projectId?: string | null, sprintId?: string | null): SpeechSettings {
    if (this.deps.resolveSpeechSettings) return this.deps.resolveSpeechSettings(projectId, sprintId);
    if (!this.deps.settingsRepository || !projectId) {
      return this.deps.settingsRepository?.getDefaultDashboardSettings().speech ?? DEFAULT_DASHBOARD_SETTINGS.speech;
    }
    return (sprintId
      ? this.deps.settingsRepository.resolveSprintDashboardSettings(projectId, sprintId)
      : this.deps.settingsRepository.resolveProjectDashboardSettings(projectId)).settings.speech;
  }

  private isExternalConfigured(settings: SpeechSettings): boolean {
    const external = settings.synthesis.externalSynthesis;
    return Boolean(external.baseUrl.trim() && external.apiKey.trim() && external.model.trim() && external.voice.trim());
  }

  private async synthesizeLocal(text: string, requestedVoice: string | null | undefined, settings: SpeechSettings): Promise<SpeechSynthesisResult> {
    const model = resolveSpeechModelEntry(settings.synthesis.localModelId);
    if (model.kind !== "synthesis") return failure("client_error", `Model "${model.id}" is not a text-to-speech model.`, "local_onnx");
    if (!await isSpeechModelAvailable(model.id, this.deps.dataDir)) {
      return failure("missing_local_model", `TTS model "${model.id}" is not installed.`, "local_onnx");
    }
    const voice = requestedVoice?.trim() || settings.synthesis.voice || model.defaultVoice || "default";

    try {
      const audio = model.adapter === "kokoro"
        ? await this.synthesizeKokoro(text, voice, settings.synthesis.speed, model.id)
        : await this.synthesizePiper(text, settings.synthesis.speed, model.id);
      return { ok: true, audio, contentType: "audio/wav", provider: "local_onnx", model: model.id, voice };
    } catch (error) {
      const message = redactText(error instanceof Error ? error.message : String(error));
      this.deps.logger?.warn("Local speech synthesis failed", { model: model.id, voice, error: message });
      return failure("provider_failure", message, "local_onnx", true);
    }
  }

  private async synthesizeKokoro(text: string, voice: string, speed: number, modelId: string): Promise<Buffer> {
    const ort = await import("onnxruntime-node");
    const model = resolveSpeechModelEntry(modelId);
    const paths = getSpeechModelPaths(modelId, this.deps.dataDir);
    const tokenizerRaw = await fs.readFile(paths.labelsPath!, "utf8");
    const tokenizer = JSON.parse(tokenizerRaw) as { model?: { vocab?: Record<string, number> } };
    const vocab = tokenizer.model?.vocab ?? {};
    const phonemes = await this.phonemize(text, voice.startsWith("b") ? "en-gb" : "en-us");
    const tokens = Array.from(phonemes).map((symbol) => vocab[symbol]).filter((id): id is number => Number.isInteger(id)).slice(0, 510);
    if (tokens.length === 0) throw new Error("Kokoro phonemization did not produce supported tokens.");

    const voicePath = `${paths.modelDir}/voices/${voice}.bin`;
    const voiceBytes = await fs.readFile(voicePath);
    const rowSize = 256 * Float32Array.BYTES_PER_ELEMENT;
    const rowCount = Math.floor(voiceBytes.byteLength / rowSize);
    const row = Math.min(tokens.length, Math.max(0, rowCount - 1));
    const style = new Float32Array(256);
    for (let index = 0; index < 256; index += 1) style[index] = voiceBytes.readFloatLE(row * rowSize + index * 4);

    const ids = BigInt64Array.from([0, ...tokens, 0].map(BigInt));
    const session = await ort.InferenceSession.create(paths.modelPath);
    const output = await session.run({
      input_ids: new ort.Tensor("int64", ids, [1, ids.length]),
      style: new ort.Tensor("float32", style, [1, 256]),
      speed: new ort.Tensor("float32", Float32Array.of(speed), [1]),
    });
    const tensor = output[session.outputNames[0]!];
    if (!tensor) throw new Error("Kokoro returned no audio output.");
    return encodeWave(floatOutput(tensor.data), model.sampleRateHz);
  }

  private async synthesizePiper(text: string, speed: number, modelId: string): Promise<Buffer> {
    const ort = await import("onnxruntime-node");
    const model = resolveSpeechModelEntry(modelId);
    const paths = getSpeechModelPaths(modelId, this.deps.dataDir);
    if (!paths.configPath) throw new Error("Piper model configuration is missing.");
    const config = JSON.parse(await fs.readFile(paths.configPath, "utf8")) as {
      audio?: { sample_rate?: number };
      espeak?: { voice?: string };
      inference?: { noise_scale?: number; length_scale?: number; noise_w?: number };
      phoneme_id_map?: Record<string, number[]>;
      num_speakers?: number;
    };
    const map = config.phoneme_id_map ?? {};
    const phonemes = await this.phonemize(text, config.espeak?.voice || "en-us");
    const ids: number[] = [...(map["^"] ?? [1])];
    for (const symbol of Array.from(phonemes)) {
      const mapped = map[symbol];
      if (mapped) ids.push(...mapped, ...(map["_"] ?? [0]));
    }
    ids.push(...(map["$"] ?? [2]));
    if (ids.length <= 2) throw new Error("Piper phonemization did not produce supported tokens.");

    const session = await ort.InferenceSession.create(paths.modelPath);
    const inputIds = BigInt64Array.from(ids.map(BigInt));
    const feeds: Record<string, import("onnxruntime-node").Tensor> = {
      input: new ort.Tensor("int64", inputIds, [1, ids.length]),
      input_lengths: new ort.Tensor("int64", BigInt64Array.of(BigInt(ids.length)), [1]),
      scales: new ort.Tensor("float32", Float32Array.of(
        config.inference?.noise_scale ?? 0.667,
        (config.inference?.length_scale ?? 1) / speed,
        config.inference?.noise_w ?? 0.8,
      ), [3]),
    };
    if (session.inputNames.includes("sid")) feeds.sid = new ort.Tensor("int64", BigInt64Array.of(0n), [1]);
    const output = await session.run(feeds);
    const tensor = output[session.outputNames[0]!];
    if (!tensor) throw new Error("Piper returned no audio output.");
    return encodeWave(floatOutput(tensor.data), config.audio?.sample_rate || model.sampleRateHz);
  }

  private async synthesizeExternal(text: string, requestedVoice: string | null | undefined, settings: SpeechSettings): Promise<SpeechSynthesisResult> {
    const external = settings.synthesis.externalSynthesis;
    if (!this.isExternalConfigured(settings)) return failure("client_error", "External TTS API settings are incomplete.", "external_api");
    const voice = requestedVoice?.trim() || external.voice;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(resolveExternalSynthesisUrl(external.baseUrl), {
        method: "POST",
        headers: { Authorization: `Bearer ${external.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: external.model, input: text, voice, response_format: external.format, speed: settings.synthesis.speed }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const body = (await response.text().catch(() => "")).slice(0, 500).split(external.apiKey).join("[REDACTED]");
        return failure("provider_failure", redactText(body || `External TTS provider returned HTTP ${response.status}.`), "external_api", response.status >= 500);
      }
      return {
        ok: true,
        audio: Buffer.from(await response.arrayBuffer()),
        contentType: response.headers.get("content-type") || `audio/${external.format}`,
        provider: "external_api",
        model: external.model,
        voice,
      };
    } catch (error) {
      const message = error instanceof Error && error.name === "AbortError" ? "External TTS request timed out." : redactText(error instanceof Error ? error.message : String(error));
      return failure("provider_failure", message, "external_api", true);
    } finally {
      clearTimeout(timer);
    }
  }
}
