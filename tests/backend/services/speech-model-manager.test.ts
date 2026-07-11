import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SpeechModelManager } from "../../../src/services/speech-model-manager.js";
import { getSpeechModelPaths } from "../../../src/services/speech-model-catalog.js";

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

    await manager.downloadModel("piper-en-us-lessac-medium");

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
      "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx",
      "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx.json",
    ]);
    expect((await manager.listModels()).find((model) => model.id === "piper-en-us-lessac-medium")?.downloaded).toBe(true);
    expect(await fs.readFile(getSpeechModelPaths("piper-en-us-lessac-medium", dataDir).modelPath)).toEqual(Buffer.from([1, 2, 3]));

    await manager.deleteModel("piper-en-us-lessac-medium");
    expect((await manager.listModels()).find((model) => model.id === "piper-en-us-lessac-medium")?.downloaded).toBe(false);
  });
});
