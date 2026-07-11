import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  normalizeKokoroText,
  phonemizeKokoro,
  phonemizeWithLocalRuntime,
  postprocessKokoroPhonemes,
} from "../../../src/services/local-phonemizer-service.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

async function mockRuntime(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "codeux-phonemizer-"));
  temporaryDirectories.push(directory);
  const runtimePath = path.join(directory, "phonemizer.cjs");
  await fs.writeFile(runtimePath, `exports.phonemize = async (text, language) => [language + ":" + text.trim().toUpperCase()];`);
  return runtimePath;
}

describe("local phonemizer service", () => {
  it("runs the opt-in runtime in a separate process and preserves punctuation", async () => {
    const result = await phonemizeWithLocalRuntime(await mockRuntime(), "Hello, world!", "en-us");
    expect(result).toBe("en-us:HELLO, en-us:WORLD!");
  });

  it("uses the British language for British Kokoro voices", async () => {
    const result = await phonemizeKokoro(await mockRuntime(), "Hello.", true);
    expect(result).toBe("en-gb:HELLO.");
  });

  it("normalizes typography and applies Kokoro IPA compatibility fixes", () => {
    expect(normalizeKokoroText("  “Hello”   world  ")).toBe('"Hello" world');
    expect(postprocessKokoroPhonemes("r x ɬ ʲ", true)).toBe("ɹ k l j");
  });

  it("fails closed instead of returning raw graphemes when the runtime is invalid", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "codeux-phonemizer-invalid-"));
    temporaryDirectories.push(directory);
    const runtimePath = path.join(directory, "phonemizer.cjs");
    await fs.writeFile(runtimePath, "exports.notPhonemize = true;");

    await expect(phonemizeWithLocalRuntime(runtimePath, "This must not become model tokens.", "en-us"))
      .rejects.toThrow("incompatible");
  });
});
