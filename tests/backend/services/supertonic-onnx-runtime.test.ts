import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs/promises";
import * as ort from "onnxruntime-node";
import { getSpeechModelPaths } from "../../../src/services/speech-model-catalog.js";
import {
  detectSupertonicLanguage,
  prepareSupertonicText,
  scaleSupertonicDuration,
  synthesizeSupertonic,
  SUPERTONIC_DENOISING_STEPS,
} from "../../../src/services/supertonic-onnx-runtime.js";

vi.mock("fs/promises", () => ({ readFile: vi.fn() }));
afterEach(() => vi.restoreAllMocks());

const indexerFor = (text: string): Record<string, number> => Object.fromEntries(
  Array.from(new Set(Array.from(text))).map((character, index) => [String(character.codePointAt(0)), index]),
);

describe("Supertonic runtime helpers", () => {
  it("detects dominant Arabic and Latin scripts", () => {
    expect(detectSupertonicLanguage("مرحبا كيفك اليوم؟")).toBe("ar");
    expect(detectSupertonicLanguage("مرحبا، خلينا نجرب ONNX اليوم")).toBe("ar");
    expect(detectSupertonicLanguage("Let's test ONNX today")).toBe("en");
    expect(detectSupertonicLanguage("Hello ONNX مرحبا")).toBe("en");
    expect(detectSupertonicLanguage("123 !? ")).toBe("na");
    expect(detectSupertonicLanguage("نعم <breath> <sigh>")).toBe("ar");
    expect(detectSupertonicLanguage("Hello، ؟؟ ١٢٣")).toBe("en");
    expect(detectSupertonicLanguage("١٢٣،؟ ـــ")).toBe("na");
    expect(detectSupertonicLanguage("ﻣﺮﺣﺒﺎ")).toBe("ar");
  });

  it("scales duration by the caller-provided speed", () => {
    expect(scaleSupertonicDuration(2.3, 1.15)).toBeCloseTo(2);
    expect(scaleSupertonicDuration(2.3, 1)).toBe(2.3);
    expect(() => scaleSupertonicDuration(2, 0)).toThrow("speed");
    expect(() => scaleSupertonicDuration(2, NaN)).toThrow("speed");
    expect(() => scaleSupertonicDuration(Infinity, 1)).toThrow("duration");
  });

  it("uses eight denoising steps and preserves expression tags", () => {
    expect(SUPERTONIC_DENOISING_STEPS).toBe(8);
    const taggedText = "Hello. <breath> Test! <sigh> <laugh>";
    const indexer = indexerFor(`<en>${taggedText}</en>`);
    const ids = prepareSupertonicText(taggedText, "en", indexer);
    expect(ids).toEqual(Array.from(`<en>${taggedText}</en>`, (character) => BigInt(indexer[String(character.codePointAt(0))]!)));
  });

  it("normalizes unsupported formatting without damaging Arabic punctuation or tags", () => {
    const input = "\u200fمرحبا ،\n\nAPI → بحث؛ <breath> كيفك اليوم ؟ ☀️ 🇦🇪";
    const expected = "<ar>مرحبا، API بحث; <breath> كيفك اليوم؟</ar>";
    const indexer = indexerFor(expected);
    expect(prepareSupertonicText(input, "ar", indexer)).toEqual(
      Array.from(expected, (character) => BigInt(indexer[String(character.codePointAt(0))]!)),
    );
  });

  it("rejects negative and missing token IDs instead of sending them to ONNX", () => {
    const indexer = { ...indexerFor("<en>Hello .</en>"), [String("§".codePointAt(0))]: -1 };
    expect(() => prepareSupertonicText("Hello §", "en", indexer)).toThrow('does not support character "§"');
    expect(() => prepareSupertonicText("Hello Ж", "en", indexer)).toThrow('does not support character "Ж"');
    expect(() => prepareSupertonicText("😀", "en", indexer)).toThrow("readable speech text");
  });

  it("rejects invalid voice paths and speed before loading model files", async () => {
    vi.mocked(fs.readFile).mockClear();
    const paths = getSpeechModelPaths("supertonic-3-multilingual");
    await expect(synthesizeSupertonic(paths, "Hello", "../F2", 1.15)).rejects.toThrow("Unknown Supertonic voice");
    await expect(synthesizeSupertonic(paths, "Hello", "F2", 0)).rejects.toThrow("speed");
    expect(fs.readFile).not.toHaveBeenCalled();
  });

  it("synthesizes the full utterance once with caller speed and eight refinement passes", async () => {
    const text = "مرحبا، كيفك اليوم؟\n\nخلينا نجرب API. <breath>";
    const indexer = indexerFor(`<ar>${text.replace(/\s+/gu, " ")}</ar>`);
    const style = { dims: [1, 1, 1], data: [[[1]]] };
    vi.mocked(fs.readFile).mockImplementation(async (file) => {
      if (String(file).endsWith("tts.json")) return JSON.stringify({ ae: { sample_rate: 10, base_chunk_size: 2 }, ttl: { latent_dim: 1, chunk_compress_factor: 1 } });
      if (String(file).endsWith("unicode_indexer.json")) return JSON.stringify(indexer);
      return JSON.stringify({ style_ttl: style, style_dp: style });
    });
    const sessions = [
      { run: vi.fn().mockResolvedValue({ duration: new ort.Tensor("float32", [2.3], [1]) }), release: vi.fn().mockResolvedValue(undefined) },
      { run: vi.fn().mockResolvedValue({ text_emb: new ort.Tensor("float32", [1], [1]) }), release: vi.fn().mockResolvedValue(undefined) },
      { run: vi.fn().mockImplementation(async (feeds: Record<string, ort.Tensor>) => ({ denoised_latent: feeds.noisy_latent })), release: vi.fn().mockResolvedValue(undefined) },
      { run: vi.fn().mockResolvedValue({ wav_tts: new ort.Tensor("float32", new Float32Array(24).fill(0.25), [1, 24]) }), release: vi.fn().mockResolvedValue(undefined) },
    ];
    const create = vi.spyOn(ort.InferenceSession, "create");
    for (const session of sessions) create.mockResolvedValueOnce(session as unknown as ort.InferenceSession);
    const result = await synthesizeSupertonic(getSpeechModelPaths("supertonic-3-multilingual"), text, "F2", 1.15);
    expect(create).toHaveBeenCalledTimes(4);
    expect(sessions[0]!.run).toHaveBeenCalledTimes(1);
    expect(sessions[0]!.run.mock.calls[0]![0].text_ids.data).toEqual(BigInt64Array.from(prepareSupertonicText(text, "ar", indexer)));
    expect(sessions[2]!.run).toHaveBeenCalledTimes(8);
    sessions[2]!.run.mock.calls.forEach(([feeds], step) => {
      expect(Array.from(feeds.total_step.data)).toEqual([8]);
      expect(Array.from(feeds.current_step.data)).toEqual([step]);
    });
    expect(sessions[3]!.run).toHaveBeenCalledTimes(1);
    const expectedLength = Math.floor(Math.fround(2.3) / 1.15 * 10);
    expect(result.samples).toEqual(new Float32Array(expectedLength).fill(0.25));
    for (const session of sessions) expect(session.release).toHaveBeenCalledOnce();
  });
});
