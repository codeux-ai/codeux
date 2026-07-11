import * as fs from "fs/promises";
import type { InferenceSession, Tensor } from "onnxruntime-node";
import type { SpeechModelCatalogEntry } from "./speech-model-catalog.js";
import { getSpeechModelPaths } from "./speech-model-catalog.js";

interface WhisperGenerationConfig {
  decoder_start_token_id?: number;
  eos_token_id?: number;
  no_timestamps_token_id?: number;
  forced_decoder_ids?: Array<[number, number]>;
  suppress_tokens?: number[];
  begin_suppress_tokens?: number[];
}

interface WhisperTokenizer {
  model?: { vocab?: Record<string, number> };
}

interface OnnxRuntimeModule {
  InferenceSession: typeof import("onnxruntime-node")["InferenceSession"];
  Tensor: typeof import("onnxruntime-node")["Tensor"];
}

const SAMPLE_RATE = 16_000;
const FFT_SIZE = 400;
const HOP_LENGTH = 160;
const MEL_BINS = 80;
const MAX_SAMPLES = 30 * SAMPLE_RATE;
const CHUNK_OVERLAP_SAMPLES = SAMPLE_RATE;
const MAX_FRAMES = 3_000;
const FREQUENCY_BINS = FFT_SIZE / 2 + 1;
const MIN_LOG_HZ = 1_000;
const MIN_LOG_MEL = 15;
const LOG_STEP = Math.log(6.4) / 27;

const hannWindow = Float64Array.from({ length: FFT_SIZE }, (_, index) => (
  0.5 - 0.5 * Math.cos(2 * Math.PI * index / FFT_SIZE)
));
const cosineTable = Float64Array.from({ length: FREQUENCY_BINS * FFT_SIZE }, (_, index) => {
  const frequency = Math.floor(index / FFT_SIZE);
  const sample = index % FFT_SIZE;
  return Math.cos(2 * Math.PI * frequency * sample / FFT_SIZE);
});
const sineTable = Float64Array.from({ length: FREQUENCY_BINS * FFT_SIZE }, (_, index) => {
  const frequency = Math.floor(index / FFT_SIZE);
  const sample = index % FFT_SIZE;
  return Math.sin(2 * Math.PI * frequency * sample / FFT_SIZE);
});

function hertzToSlaneyMel(frequency: number): number {
  return frequency >= MIN_LOG_HZ
    ? MIN_LOG_MEL + Math.log(frequency / MIN_LOG_HZ) / LOG_STEP
    : 3 * frequency / 200;
}

function slaneyMelToHertz(mel: number): number {
  return mel >= MIN_LOG_MEL
    ? MIN_LOG_HZ * Math.exp(LOG_STEP * (mel - MIN_LOG_MEL))
    : 200 * mel / 3;
}

function createMelFilters(): Float64Array[] {
  const minMel = hertzToSlaneyMel(0);
  const maxMel = hertzToSlaneyMel(SAMPLE_RATE / 2);
  const points = Float64Array.from({ length: MEL_BINS + 2 }, (_, index) => (
    slaneyMelToHertz(minMel + (maxMel - minMel) * index / (MEL_BINS + 1))
  ));
  return Array.from({ length: MEL_BINS }, (_, melIndex) => {
    const filter = new Float64Array(FREQUENCY_BINS);
    const lower = points[melIndex] ?? 0;
    const center = points[melIndex + 1] ?? lower;
    const upper = points[melIndex + 2] ?? center;
    const normalization = 2 / Math.max(Number.EPSILON, upper - lower);
    for (let frequencyIndex = 0; frequencyIndex < FREQUENCY_BINS; frequencyIndex += 1) {
      const frequency = frequencyIndex * SAMPLE_RATE / FFT_SIZE;
      const rising = (frequency - lower) / Math.max(Number.EPSILON, center - lower);
      const falling = (upper - frequency) / Math.max(Number.EPSILON, upper - center);
      filter[frequencyIndex] = Math.max(0, Math.min(rising, falling)) * normalization;
    }
    return filter;
  });
}

const melFilters = createMelFilters();

export function hasAudibleSpeech(audio: Float32Array): boolean {
  if (audio.length === 0) return false;
  let energy = 0;
  let peak = 0;
  for (const sample of audio) {
    energy += sample * sample;
    peak = Math.max(peak, Math.abs(sample));
  }
  const rootMeanSquare = Math.sqrt(energy / audio.length);
  return peak >= 1e-3 && rootMeanSquare >= 1e-4;
}

function reflectIndex(index: number, length: number): number {
  if (length <= 1) return 0;
  if (index < 0) return Math.min(length - 1, -index);
  if (index >= length) return Math.max(0, 2 * length - index - 2);
  return index;
}

/** Creates the 80x3000 log-Mel input expected by English Whisper ONNX encoders. */
export function createWhisperInputFeatures(audio: Float32Array): Float32Array {
  const sourceLength = Math.min(audio.length, MAX_SAMPLES);
  const features = new Float32Array(MEL_BINS * MAX_FRAMES);
  features.fill(-10);
  const activeFrames = Math.min(MAX_FRAMES, Math.max(1, Math.ceil((sourceLength + FFT_SIZE / 2) / HOP_LENGTH)));
  const melPower = new Float64Array(MEL_BINS);
  let maximumLogPower = -10;

  for (let frame = 0; frame < activeFrames; frame += 1) {
    melPower.fill(0);
    const frameStart = frame * HOP_LENGTH - FFT_SIZE / 2;
    for (let frequency = 0; frequency < FREQUENCY_BINS; frequency += 1) {
      let real = 0;
      let imaginary = 0;
      const tableOffset = frequency * FFT_SIZE;
      for (let sample = 0; sample < FFT_SIZE; sample += 1) {
        const sourceIndex = reflectIndex(frameStart + sample, MAX_SAMPLES);
        const value = sourceIndex < sourceLength ? (audio[sourceIndex] ?? 0) * (hannWindow[sample] ?? 0) : 0;
        real += value * (cosineTable[tableOffset + sample] ?? 0);
        imaginary -= value * (sineTable[tableOffset + sample] ?? 0);
      }
      const power = real * real + imaginary * imaginary;
      for (let mel = 0; mel < MEL_BINS; mel += 1) {
        melPower[mel] = (melPower[mel] ?? 0) + power * (melFilters[mel]?.[frequency] ?? 0);
      }
    }
    for (let mel = 0; mel < MEL_BINS; mel += 1) {
      const logPower = Math.log10(Math.max(1e-10, melPower[mel] ?? 0));
      features[mel * MAX_FRAMES + frame] = logPower;
      maximumLogPower = Math.max(maximumLogPower, logPower);
    }
  }

  const floor = maximumLogPower - 8;
  for (let index = 0; index < features.length; index += 1) {
    features[index] = (Math.max(features[index] ?? -10, floor) + 4) / 4;
  }
  return features;
}

export function splitWhisperAudio(audio: Float32Array): Float32Array[] {
  if (audio.length === 0) return [audio];
  const chunks: Float32Array[] = [];
  const stride = MAX_SAMPLES - CHUNK_OVERLAP_SAMPLES;
  for (let offset = 0; offset < audio.length; offset += stride) {
    const end = Math.min(audio.length, offset + MAX_SAMPLES);
    chunks.push(audio.subarray(offset, end));
    if (end === audio.length) break;
  }
  return chunks;
}

const normalizeOverlapWord = (word: string): string => word.toLocaleLowerCase("en-US").replace(/[^a-z0-9']/g, "");

export function mergeWhisperTranscripts(transcripts: string[]): string {
  const nonEmpty = transcripts.map((text) => text.trim()).filter(Boolean);
  if (nonEmpty.length === 0) return "";
  const merged = nonEmpty[0].split(/\s+/);
  for (const transcript of nonEmpty.slice(1)) {
    const nextWords = transcript.split(/\s+/);
    const maximumOverlap = Math.min(20, merged.length, nextWords.length);
    let overlap = 0;
    for (let size = maximumOverlap; size > 0; size -= 1) {
      const left = merged.slice(-size).map(normalizeOverlapWord);
      const right = nextWords.slice(0, size).map(normalizeOverlapWord);
      if (left.every((word, index) => word && word === right[index])) {
        overlap = size;
        break;
      }
    }
    merged.push(...nextWords.slice(overlap));
  }
  return merged.join(" ").replace(/\s+/g, " ").trim();
}

function unicodeToByteMap(): Map<string, number> {
  const bytes = [
    ...Array.from({ length: 94 }, (_, index) => index + 33),
    ...Array.from({ length: 12 }, (_, index) => index + 161),
    ...Array.from({ length: 50 }, (_, index) => index + 174),
  ];
  const characters = [...bytes];
  let extra = 0;
  for (let byte = 0; byte < 256; byte += 1) {
    if (!bytes.includes(byte)) {
      bytes.push(byte);
      characters.push(256 + extra);
      extra += 1;
    }
  }
  return new Map(bytes.map((byte, index) => [String.fromCharCode(characters[index] ?? 0), byte]));
}

const unicodeBytes = unicodeToByteMap();

export function decodeWhisperTokens(tokenIds: number[], tokenizer: WhisperTokenizer): string {
  const vocab = tokenizer.model?.vocab ?? {};
  const tokens: string[] = [];
  const byId = new Map<number, string>();
  for (const [token, id] of Object.entries(vocab)) byId.set(id, token);
  for (const id of tokenIds) {
    if (id < 50_256) tokens.push(byId.get(id) ?? "");
  }
  const bytes = new Uint8Array([...tokens.join("")].map((character) => unicodeBytes.get(character) ?? 0));
  return new TextDecoder("utf-8", { fatal: false, ignoreBOM: true }).decode(bytes).replace(/\s+/g, " ").trim();
}

function chooseToken(logits: Tensor, suppressed: Set<number>): number {
  const vocabularySize = logits.dims.at(-1) ?? 0;
  const sequenceLength = logits.dims.at(-2) ?? 1;
  const offset = (sequenceLength - 1) * vocabularySize;
  let bestId = 0;
  let bestValue = Number.NEGATIVE_INFINITY;
  const data = logits.data as Float32Array;
  for (let id = 0; id < vocabularySize; id += 1) {
    const value = suppressed.has(id) ? Number.NEGATIVE_INFINITY : (data[offset + id] ?? Number.NEGATIVE_INFINITY);
    if (value > bestValue) {
      bestValue = value;
      bestId = id;
    }
  }
  return bestId;
}

function zeroPastKeyValues(ort: OnnxRuntimeModule, session: InferenceSession): Record<string, Tensor> {
  const tensors: Record<string, Tensor> = {};
  for (const metadata of session.inputMetadata) {
    if (!metadata.name.startsWith("past_key_values.") || !metadata.isTensor) continue;
    const headCount = typeof metadata.shape[1] === "number" ? metadata.shape[1] : 1;
    const headSize = typeof metadata.shape[3] === "number" ? metadata.shape[3] : 1;
    tensors[metadata.name] = new ort.Tensor("float32", new Float32Array(0), [1, headCount, 0, headSize]);
  }
  return tensors;
}

export async function transcribeWhisperOnnx(args: {
  ort: OnnxRuntimeModule;
  audio: Float32Array;
  model: SpeechModelCatalogEntry;
  dataDir?: string;
  durationSeconds: number | null;
}): Promise<string> {
  if (!hasAudibleSpeech(args.audio)) return "";
  const paths = getSpeechModelPaths(args.model.id, args.dataDir);
  const decoderPath = `${paths.modelDir}/decoder_model_merged.onnx`;
  const generationPath = `${paths.modelDir}/generation_config.json`;
  const [generationRaw, tokenizerRaw] = await Promise.all([
    fs.readFile(generationPath, "utf8"),
    paths.labelsPath ? fs.readFile(paths.labelsPath, "utf8") : Promise.reject(new Error("Whisper tokenizer is missing.")),
  ]);
  const generation = JSON.parse(generationRaw) as WhisperGenerationConfig;
  const tokenizer = JSON.parse(tokenizerRaw) as WhisperTokenizer;
  const startToken = generation.decoder_start_token_id ?? 50_257;
  const endToken = generation.eos_token_id ?? 50_256;
  const noTimestampsToken = generation.no_timestamps_token_id ?? 50_362;
  const initialIds = [startToken, ...(generation.forced_decoder_ids ?? []).sort(([left], [right]) => left - right).map(([, id]) => id)];
  if (!initialIds.includes(noTimestampsToken)) initialIds.push(noTimestampsToken);

  const encoder = await args.ort.InferenceSession.create(paths.modelPath);
  let decoder: InferenceSession | null = null;
  try {
    decoder = await args.ort.InferenceSession.create(decoderPath);
    const suppressed = new Set([...(generation.suppress_tokens ?? []), noTimestampsToken]);
    const beginSuppressed = new Set([...suppressed, ...(generation.begin_suppress_tokens ?? [])]);
    const transcripts: string[] = [];
    for (const chunk of splitWhisperAudio(args.audio)) {
      if (!hasAudibleSpeech(chunk)) continue;
      const inputFeatures = createWhisperInputFeatures(chunk);
      const encoded = await encoder.run({
        [encoder.inputNames[0] ?? "input_features"]: new args.ort.Tensor("float32", inputFeatures, [1, MEL_BINS, MAX_FRAMES]),
      });
      const hiddenStates = Object.values(encoded)[0];
      if (!hiddenStates) throw new Error("Whisper encoder did not return hidden states.");

      const generated: number[] = [];
      let inputIds = initialIds;
      let past = zeroPastKeyValues(args.ort, decoder);
      const chunkDuration = chunk.length / SAMPLE_RATE;
      const maxTokens = Math.min(224, Math.max(32, Math.ceil(chunkDuration * 12) + 24));
      for (let step = 0; step < maxTokens; step += 1) {
        const outputs = await decoder.run({
          input_ids: new args.ort.Tensor("int64", BigInt64Array.from(inputIds, BigInt), [1, inputIds.length]),
          encoder_hidden_states: hiddenStates,
          ...past,
          use_cache_branch: new args.ort.Tensor("bool", [step > 0], [1]),
        });
        const logits = outputs.logits;
        if (!logits) throw new Error("Whisper decoder did not return logits.");
        const tokenId = chooseToken(logits, step === 0 ? beginSuppressed : suppressed);
        if (tokenId === endToken) break;
        generated.push(tokenId);
        inputIds = [tokenId];
        const nextPast: Record<string, Tensor> = {};
        for (const [name, tensor] of Object.entries(outputs)) {
          if (!name.startsWith("present.")) continue;
          const pastName = name.replace("present.", "past_key_values.");
          // The cached branch emits empty cross-attention tensors. Keep the valid
          // encoder cache produced by the first decoder pass and update only the
          // growing self-attention cache on subsequent tokens.
          nextPast[pastName] = step > 0 && name.includes(".encoder.")
            ? (past[pastName] ?? tensor)
            : tensor;
        }
        past = nextPast;
      }
      transcripts.push(decodeWhisperTokens(generated, tokenizer));
    }
    return mergeWhisperTranscripts(transcripts);
  } finally {
    const releases = [encoder.release()];
    if (decoder) releases.push(decoder.release());
    await Promise.allSettled(releases);
  }
}
