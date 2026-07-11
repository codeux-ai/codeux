import { describe, expect, it } from "vitest";
import {
  createWhisperInputFeatures,
  decodeWhisperTokens,
  hasAudibleSpeech,
  mergeWhisperTranscripts,
  splitWhisperAudio,
} from "../../../src/services/whisper-onnx-runtime.js";

describe("Whisper ONNX runtime helpers", () => {
  it("rejects digital silence before Whisper can hallucinate text", () => {
    expect(hasAudibleSpeech(new Float32Array(16_000))).toBe(false);
    expect(hasAudibleSpeech(Float32Array.of(0, 0.01, -0.01, 0))).toBe(true);
  });

  it("chunks long recordings with overlap so boundary words remain audible", () => {
    const audio = Float32Array.from({ length: 65 * 16_000 }, (_, index) => index % 100);

    const chunks = splitWhisperAudio(audio);

    expect(chunks.map((chunk) => chunk.length)).toEqual([480_000, 480_000, 112_000]);
    expect(chunks[1]?.[0]).toBe(audio[29 * 16_000]);
    expect(chunks[2]?.at(-1)).toBe(audio.at(-1));
  });

  it("deduplicates words repeated by overlapping Whisper windows", () => {
    expect(mergeWhisperTranscripts([
      "The boundary keeps these important words.",
      "These important words continue into the next chunk.",
    ])).toBe("The boundary keeps these important words. continue into the next chunk.");
  });

  it("creates finite fixed-size Whisper features for short audio", () => {
    const features = createWhisperInputFeatures(Float32Array.of(0, 0.25, -0.25, 0));

    expect(features).toHaveLength(80 * 3_000);
    expect(features.every(Number.isFinite)).toBe(true);
  });

  it("decodes Whisper byte-level BPE tokens as UTF-8 text", () => {
    const tokenizer = { model: { vocab: { "Hello": 1, "Ġworld": 2, "!": 3 } } };

    expect(decodeWhisperTokens([1, 2, 3, 50_257], tokenizer)).toBe("Hello world!");
  });
});
