import { describe, expect, it, vi } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { resolveSpeechModelEntry } from "../../../src/services/speech-model-catalog.js";
import {
  buildWhisperInitialIds,
  createWhisperInputFeatures,
  decodeWhisperTokens,
  hasAudibleSpeech,
  mergeWhisperTranscripts,
  resolveWhisperLanguageSelection,
  selectWhisperLanguageToken,
  splitWhisperAudio,
  transcribeWhisperOnnx,
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

  it("replaces the nullable multilingual language prompt without emitting token zero", () => {
    expect(buildWhisperInitialIds({
      decoder_start_token_id: 50_258,
      no_timestamps_token_id: 50_363,
      is_multilingual: true,
      forced_decoder_ids: [[1, null], [2, 50_359]],
    }, { code: "de", tokenId: 50_261 })).toEqual([50_258, 50_261, 50_359, 50_363]);
  });

  it("selects only configured language tokens from detection logits", () => {
    const data = new Float32Array(8);
    data[2] = 0.5;
    data[3] = 3;
    data[7] = 100;

    expect(selectWhisperLanguageToken({ data, dims: [1, 1, 8] }, {
      lang_to_id: { "<|en|>": 2, "<|de|>": 3 },
    })).toEqual({ code: "de", tokenId: 3 });
  });

  it("uses an explicit language without detection and reuses an auto detection result", async () => {
    const detect = vi.fn().mockResolvedValue({ code: "fr", tokenId: 5 });
    const generation = { lang_to_id: { "<|de|>": 4, "<|fr|>": 5 } };

    await expect(resolveWhisperLanguageSelection({
      generation,
      requestedLanguage: "de-DE",
      detect,
    })).resolves.toEqual({ code: "de", tokenId: 4 });
    expect(detect).not.toHaveBeenCalled();

    const detected = await resolveWhisperLanguageSelection({
      generation,
      requestedLanguage: null,
      detect,
    });
    await expect(resolveWhisperLanguageSelection({
      generation,
      requestedLanguage: null,
      cachedSelection: detected,
      detect,
    })).resolves.toEqual(detected);
    expect(detect).toHaveBeenCalledTimes(1);
  });

  it("rejects an explicit language absent from the pinned model metadata", async () => {
    await expect(resolveWhisperLanguageSelection({
      generation: { lang_to_id: { "<|en|>": 2 } },
      requestedLanguage: "de",
      detect: vi.fn(),
    })).rejects.toThrow('Whisper language "de" is not supported');
  });

  it("runs multilingual detection through the encoder-decoder integration and returns the detected language", async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "codeux-whisper-runtime-"));
    const model = resolveSpeechModelEntry("onnx-community/whisper-tiny");
    const modelDir = path.join(dataDir, "onnx-community--whisper-tiny");
    await fs.mkdir(modelDir, { recursive: true });
    await fs.writeFile(path.join(modelDir, "generation_config.json"), JSON.stringify({
      decoder_start_token_id: 1,
      eos_token_id: 6,
      no_timestamps_token_id: 5,
      is_multilingual: true,
      forced_decoder_ids: [[1, null], [2, 4]],
      lang_to_id: { "<|en|>": 2, "<|de|>": 3 },
      suppress_tokens: [5],
    }));
    await fs.writeFile(path.join(modelDir, "tokenizer.json"), JSON.stringify({
      model: { vocab: { Hallo: 7 } },
    }));

    class MockTensor {
      constructor(
        public readonly type: string,
        public readonly data: Float32Array | BigInt64Array | boolean[],
        public readonly dims: number[],
      ) {}
    }
    const tensor = (values: Record<number, number>) => {
      const data = new Float32Array(8);
      for (const [index, value] of Object.entries(values)) data[Number(index)] = value;
      return new MockTensor("float32", data, [1, 1, 8]);
    };
    const encoder = {
      inputNames: ["input_features"],
      inputMetadata: [],
      run: vi.fn().mockResolvedValue({ hidden_states: new MockTensor("float32", new Float32Array(4), [1, 1, 4]) }),
      release: vi.fn().mockResolvedValue(undefined),
    };
    const decoder = {
      inputNames: ["input_ids"],
      inputMetadata: [],
      run: vi.fn(async (feeds: { input_ids: MockTensor }) => {
        const ids = [...feeds.input_ids.data as BigInt64Array].map(Number);
        if (ids.length === 1 && ids[0] === 1) return { logits: tensor({ 2: 1, 3: 9 }) };
        if (ids.length > 1) return { logits: tensor({ 7: 9 }) };
        return { logits: tensor({ 6: 9 }) };
      }),
      release: vi.fn().mockResolvedValue(undefined),
    };
    const ort = {
      Tensor: MockTensor,
      InferenceSession: {
        create: vi.fn(async (filePath: string) => filePath.endsWith("decoder_model_merged.onnx") ? decoder : encoder),
      },
    };

    try {
      const result = await transcribeWhisperOnnx({
        ort: ort as never,
        audio: Float32Array.of(0, 0.05, -0.05, 0),
        model,
        dataDir,
        language: null,
        durationSeconds: 1,
      });

      expect(result).toEqual({ text: "Hallo", language: "de" });
      expect(decoder.run).toHaveBeenCalledTimes(3);
      expect(encoder.release).toHaveBeenCalledOnce();
      expect(decoder.release).toHaveBeenCalledOnce();
    } finally {
      await fs.rm(dataDir, { recursive: true, force: true });
    }
  });
});
