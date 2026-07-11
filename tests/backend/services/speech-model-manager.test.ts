import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SpeechModelManager } from "../../../src/services/speech-model-manager.js";
import { getSpeechModelPaths } from "../../../src/services/speech-model-catalog.js";
import { SPEECH_MODEL_CATALOG } from "../../../src/services/speech-model-catalog.js";

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn() };
const temporaryDirectories: string[] = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe("SpeechModelManager", () => {
  it("downloads every bundle file, reports installation, and deletes it", async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "codeux-speech-models-"));
    temporaryDirectories.push(dataDir);
    const fetchImpl = vi.fn().mockImplementation(() => Promise.resolve(new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: { "content-length": "3" },
    })));
    vi.stubGlobal("fetch", fetchImpl);
    const manager = new SpeechModelManager(logger as any, dataDir);

    const modelId = "onnx-community/whisper-base.en";
    await manager.downloadModel(modelId, SPEECH_MODEL_CATALOG[modelId]!.license.id);

    expect(fetchImpl).toHaveBeenCalledTimes(5);
    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
      "https://huggingface.co/onnx-community/whisper-base.en/resolve/main/onnx/encoder_model_int8.onnx",
      "https://huggingface.co/onnx-community/whisper-base.en/resolve/main/onnx/decoder_model_merged_int8.onnx",
      "https://huggingface.co/onnx-community/whisper-base.en/resolve/main/tokenizer.json",
      "https://huggingface.co/onnx-community/whisper-base.en/resolve/main/preprocessor_config.json",
      "https://huggingface.co/onnx-community/whisper-base.en/resolve/main/generation_config.json",
    ]);
    expect((await manager.listModels()).find((model) => model.id === modelId)?.downloaded).toBe(true);
    expect(await fs.readFile(getSpeechModelPaths(modelId, dataDir).modelPath)).toEqual(Buffer.from([1, 2, 3]));

    await manager.downloadModel(modelId, SPEECH_MODEL_CATALOG[modelId]!.license.id);
    expect(fetchImpl).toHaveBeenCalledTimes(5);

    await manager.deleteModel(modelId);
    expect((await manager.listModels()).find((model) => model.id === modelId)?.downloaded).toBe(false);
  });

  it("rejects downloads until the current catalog license is accepted", async () => {
    const manager = new SpeechModelManager(logger as any, "/tmp/codeux-license-test");
    await expect(manager.downloadModel("onnx-community/whisper-tiny.en")).rejects.toThrow("Accept the MIT terms");
  });

  it("rejects an executable runtime that fails its pinned integrity check", async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "codeux-speech-integrity-"));
    temporaryDirectories.push(dataDir);
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(new Response(new Uint8Array([1, 2, 3]), { status: 200 }))));
    const manager = new SpeechModelManager(logger as any, dataDir);
    const model = SPEECH_MODEL_CATALOG["kokoro-82m-v1.0-q8"]!;

    await expect(manager.downloadModel(model.id, model.license.id)).rejects.toThrow("Integrity check failed");
    await expect(fs.stat(path.join(getSpeechModelPaths(model.id, dataDir).modelDir, "runtime/phonemizer.cjs"))).rejects.toThrow();
  });

  it("downloads revision-pinned multilingual artifacts instead of mutable main files", async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "codeux-speech-revision-"));
    temporaryDirectories.push(dataDir);
    const fetchImpl = vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
    vi.stubGlobal("fetch", fetchImpl);
    const manager = new SpeechModelManager(logger as any, dataDir);
    const model = SPEECH_MODEL_CATALOG["onnx-community/whisper-tiny"]!;

    await expect(manager.downloadModel(model.id, model.license.id)).rejects.toThrow("Integrity check failed");
    expect(fetchImpl).toHaveBeenCalledWith(
      `https://huggingface.co/${model.repository}/resolve/${model.revision}/onnx/encoder_model_int8.onnx`,
      expect.objectContaining({ redirect: "follow" }),
    );
  });

  it("keeps only catalog entries with commercially usable license metadata", () => {
    expect(Object.keys(SPEECH_MODEL_CATALOG)).not.toContain("piper-en-us-lessac-medium");
    expect(Object.keys(SPEECH_MODEL_CATALOG)).not.toContain("piper-en-gb-alba-medium");
    for (const model of Object.values(SPEECH_MODEL_CATALOG)) {
      expect(model.license.commercialUseAllowed).toBe(true);
      expect(model.license.url).toMatch(/^https:\/\//);
    }
  });

  it("includes the embedded eSpeak GPL notice in every local synthesis bundle", () => {
    const synthesisModels = Object.values(SPEECH_MODEL_CATALOG).filter((model) => model.kind === "synthesis");

    for (const model of synthesisModels) {
      expect(model.license.name).toContain("GPL-3.0-or-later");
      expect(model.license.notice).toContain("eSpeak NG");
      expect(model.files).toContainEqual(expect.objectContaining({
        localName: "licenses/espeak-ng-GPL-3.0-or-later.txt",
        sha256: "8ceb4b9ee5adedde47b31e975c1d90c73ad27b6b165a1dcd80c7c545eb65b903",
      }));
    }
  });

  it("includes Kokoro training-data attribution in the accepted and downloaded bundle", () => {
    const kokoro = SPEECH_MODEL_CATALOG["kokoro-82m-v1.0-q8"]!;

    expect(kokoro.license.name).toContain("CC-BY-3.0/4.0");
    expect(kokoro.license.notice).toContain("Koniwa under CC BY 3.0");
    expect(kokoro.license.notice).toContain("SIWIS under CC BY 4.0");
    expect(kokoro.files).toContainEqual(expect.objectContaining({
      localName: "licenses/KOKORO_MODEL_CARD.md",
      downloadUrl: "https://huggingface.co/hexgrad/Kokoro-82M/raw/f3ff3571791e39611d31c381e3a41a3af07b4987/README.md",
      sha256: "91dcabced89db6f109b8786642f50402d3ee87450e8189589b6f85520e7f4d78",
    }));
  });

  it("catalogs immutable multilingual Whisper bundles and their selectable languages", () => {
    const base = SPEECH_MODEL_CATALOG["onnx-community/whisper-base"]!;
    const tiny = SPEECH_MODEL_CATALOG["onnx-community/whisper-tiny"]!;

    for (const model of [base, tiny]) {
      expect(model.kind).toBe("transcription");
      expect(model.adapter).toBe("whisper");
      expect(model.revision).toMatch(/^[a-f0-9]{40}$/);
      expect(model.sourceUrl).toContain(model.revision);
      expect(model.supportsAutomaticLanguageDetection).toBe(true);
      expect(model.languages).toEqual(expect.arrayContaining([
        { code: "en", label: "English" },
        { code: "de", label: "German" },
        { code: "ja", label: "Japanese" },
      ]));
      expect(model.files.every((artifact) => artifact.sha256?.match(/^[a-f0-9]{64}$/))).toBe(true);
    }
    expect(base.sizeBytes).toBe(79_379_249);
    expect(tiny.sizeBytes).toBe(43_328_795);
    expect(SPEECH_MODEL_CATALOG["onnx-community/whisper-base.en"]?.languages).toEqual([
      { code: "en", label: "English" },
    ]);
  });
});
