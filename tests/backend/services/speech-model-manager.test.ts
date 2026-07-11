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

    const modelId = "Xenova/wav2vec2-base-960h";
    await manager.downloadModel(modelId, SPEECH_MODEL_CATALOG[modelId]!.license.id);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
      "https://huggingface.co/Xenova/wav2vec2-base-960h/resolve/main/onnx/model_quantized.onnx",
      "https://huggingface.co/Xenova/wav2vec2-base-960h/resolve/main/tokenizer.json",
    ]);
    expect((await manager.listModels()).find((model) => model.id === modelId)?.downloaded).toBe(true);
    expect(await fs.readFile(getSpeechModelPaths(modelId, dataDir).modelPath)).toEqual(Buffer.from([1, 2, 3]));

    await manager.downloadModel(modelId, SPEECH_MODEL_CATALOG[modelId]!.license.id);
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    await manager.deleteModel(modelId);
    expect((await manager.listModels()).find((model) => model.id === modelId)?.downloaded).toBe(false);
  });

  it("rejects downloads until the current catalog license is accepted", async () => {
    const manager = new SpeechModelManager(logger as any, "/tmp/codeux-license-test");
    await expect(manager.downloadModel("Xenova/wav2vec2-base-960h")).rejects.toThrow("Accept the MIT terms");
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

  it("keeps only catalog entries with commercially usable license metadata", () => {
    expect(Object.keys(SPEECH_MODEL_CATALOG)).not.toContain("piper-en-us-lessac-medium");
    expect(Object.keys(SPEECH_MODEL_CATALOG)).not.toContain("piper-en-gb-alba-medium");
    for (const model of Object.values(SPEECH_MODEL_CATALOG)) {
      expect(model.license.commercialUseAllowed).toBe(true);
      expect(model.license.url).toMatch(/^https:\/\//);
    }
  });
});
