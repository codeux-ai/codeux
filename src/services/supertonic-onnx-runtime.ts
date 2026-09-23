import * as fs from "fs/promises";
import * as path from "path";
import * as ort from "onnxruntime-node";
import type { SpeechModelPaths } from "./speech-model-catalog.js";

const tensor = (data: number[] | bigint[], dims: number[], type: "float32" | "int64"): ort.Tensor => (
  new ort.Tensor(type, type === "int64" ? BigInt64Array.from(data as bigint[]) : Float32Array.from(data as number[]), dims)
);

const flatten = (value: unknown): number[] => (value as number[][][]).flat(Infinity) as number[];

function mask(length: number, maxLength: number): number[] {
  return Array.from({ length: maxLength }, (_, index) => index < length ? 1 : 0);
}

export function detectSupertonicLanguage(text: string): string {
  const letters = text.replace(/<(?:breath|sigh|laugh)>/gu, "").normalize("NFKC").match(/\p{L}/gu) ?? [];
  const arabicCount = letters.filter((letter) => /\p{Script=Arabic}/u.test(letter) && letter !== "ـ").length;
  const latinCount = letters.filter((letter) => /\p{Script=Latin}/u.test(letter)).length;
  if (arabicCount > 0 && arabicCount >= latinCount) return "ar";
  if (latinCount > 0) return "en";
  return "na";
}

export function scaleSupertonicDuration(duration: number, speed: number): number {
  if (!Number.isFinite(speed) || speed <= 0) throw new Error("Supertonic speed must be a positive finite number.");
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("Supertonic returned an invalid speech duration.");
  return duration / speed;
}

export const SUPERTONIC_DENOISING_STEPS = 8;

export function prepareSupertonicText(text: string, lang: string, indexer: Record<string, number>): bigint[] {
  const normalized = text.normalize("NFKD")
    .replace(/[\p{Extended_Pictographic}\p{Regional_Indicator}\p{Cf}\uFE0E\uFE0F]/gu, "")
    .replace(/[–‑—]/gu, "-")
    .replace(/[_/[\]#|←→]/gu, " ")
    .replace(/[☆♡©\\]/gu, "")
    .replace(/؛/gu, ";")
    .replace(/۔/gu, ".")
    .replace(/[“”]/gu, '"')
    .replace(/[‘’´\u0060]/gu, "'")
    .replace(/\s+([،؟.!?;:,])/gu, "$1")
    .replace(/\s+/gu, " ")
    .trim();
  if (!normalized) throw new Error("Supertonic requires readable speech text.");
  const hasEnding = /[،؟.!?;:,'"\)\]\}…]$/u.test(normalized) || /<(?:breath|sigh|laugh)>$/u.test(normalized);
  const tagged = "<" + lang + ">" + normalized + (hasEnding ? "" : ".") + "</" + lang + ">";
  return Array.from(tagged).map((character) => {
    const id = indexer[String(character.codePointAt(0))];
    if (!Number.isInteger(id) || id < 0) throw new Error("Supertonic does not support character \"" + character + "\".");
    return BigInt(id);
  });
}

function styleTensor(value: { dims: number[]; data: number[][][] }): ort.Tensor {
  return tensor(flatten(value.data), value.dims, "float32");
}

export async function synthesizeSupertonic(
  paths: SpeechModelPaths,
  text: string,
  voice: string,
  speed: number,
): Promise<{ samples: Float32Array; sampleRateHz: number }> {
  if (!/^[FM][1-5]$/u.test(voice)) throw new Error("Unknown Supertonic voice. Select F1–F5 or M1–M5.");
  if (!Number.isFinite(speed) || speed <= 0) throw new Error("Supertonic speed must be a positive finite number.");
  const modelDir = paths.modelDir;
  const config = JSON.parse(await fs.readFile(path.join(modelDir, "tts.json"), "utf8")) as {
    ae: { sample_rate: number; base_chunk_size: number };
    ttl: { latent_dim: number; chunk_compress_factor: number };
  };
  const indexer = JSON.parse(await fs.readFile(path.join(modelDir, "unicode_indexer.json"), "utf8")) as Record<string, number>;
  const ids = prepareSupertonicText(text, detectSupertonicLanguage(text), indexer);
  const voiceStyle = JSON.parse(await fs.readFile(path.join(modelDir, "voices", voice + ".json"), "utf8")) as {
    style_ttl: { dims: number[]; data: number[][][] };
    style_dp: { dims: number[]; data: number[][][] };
  };
  const sessions: ort.InferenceSession[] = [];
  try {
    for (const filename of ["duration_predictor.onnx", "text_encoder.onnx", "vector_estimator.onnx", "vocoder.onnx"]) {
      sessions.push(await ort.InferenceSession.create(path.join(modelDir, filename)));
    }
  } catch (error) {
    await Promise.all(sessions.map((session) => session.release()));
    throw error;
  }
  const [durationPredictor, textEncoder, vectorEstimator, vocoder] = sessions;
  try {
    const textIds = tensor(ids, [1, ids.length], "int64");
    const textMask = tensor(mask(ids.length, ids.length), [1, 1, ids.length], "float32");
    const styleTtl = styleTensor(voiceStyle.style_ttl);
    const styleDp = styleTensor(voiceStyle.style_dp);
    const durationResult = await durationPredictor.run({ text_ids: textIds, style_dp: styleDp, text_mask: textMask });
    const durations = Array.from(durationResult.duration.data as Iterable<number>).map((duration) => scaleSupertonicDuration(duration, speed));
    const wavLength = Math.max(1, Math.floor(Math.max(...durations) * config.ae.sample_rate));
    const chunkSize = config.ae.base_chunk_size * config.ttl.chunk_compress_factor;
    const latentLength = Math.max(1, Math.floor((wavLength + chunkSize - 1) / chunkSize));
    const latentDim = config.ttl.latent_dim * config.ttl.chunk_compress_factor;
    const noisyLatent = Float32Array.from({ length: latentDim * latentLength }, () => {
      const u1 = Math.max(1e-10, Math.random());
      return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * Math.random());
    });
    const latentMaskValues = mask(Math.ceil(wavLength / chunkSize), latentLength);
    for (let dimension = 0; dimension < latentDim; dimension += 1) {
      for (let timestep = 0; timestep < latentLength; timestep += 1) {
        noisyLatent[dimension * latentLength + timestep] *= latentMaskValues[timestep]!;
      }
    }
    const latentMask = tensor(latentMaskValues, [1, 1, latentLength], "float32");
    const textEmbedding = (await textEncoder.run({ text_ids: textIds, style_ttl: styleTtl, text_mask: textMask })).text_emb;
    const latentShape = [1, latentDim, latentLength];
    const steps = SUPERTONIC_DENOISING_STEPS;
    const totalStep = tensor([steps], [1], "float32");
    for (let step = 0; step < steps; step += 1) {
      const result = await vectorEstimator.run({
        noisy_latent: new ort.Tensor("float32", noisyLatent, latentShape),
        text_emb: textEmbedding,
        style_ttl: styleTtl,
        text_mask: textMask,
        latent_mask: latentMask,
        total_step: totalStep,
        current_step: tensor([step], [1], "float32"),
      });
      noisyLatent.set(result.denoised_latent.data as Float32Array);
    }
    const output = await vocoder.run({ latent: new ort.Tensor("float32", noisyLatent, latentShape) });
    const samples = Float32Array.from(output.wav_tts.data as Iterable<number>);
    return { samples: samples.slice(0, Math.min(samples.length, Math.floor(durations[0]! * config.ae.sample_rate))), sampleRateHz: config.ae.sample_rate };
  } finally {
    await Promise.all([durationPredictor.release(), textEncoder.release(), vectorEstimator.release(), vocoder.release()]);
  }
}
