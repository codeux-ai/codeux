import { createHash } from "crypto";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  normalizeKokoroText,
  phonemizeKokoro,
  phonemizeWithLocalRuntime,
  postprocessKokoroPhonemes,
  type LocalPhonemizerIntegrity,
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

async function mockMultilingualRuntime(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "codeux-phonemizer-multilingual-"));
  temporaryDirectories.push(directory);
  const runtimePath = path.join(directory, "espeak-ng.mjs");
  await fs.writeFile(runtimePath, `
    export default async function createRuntime() {
      return { eSpeakNGWorker: class {
        set_voice(language) { return language === "de" ? 0 : 1; }
        synthesize_ipa(text) { return { code: 0, ipa: "h_ˈa_l_oː " + text.trim().toUpperCase() + "\\n" }; }
      } };
    }
  `);
  await fs.writeFile(path.join(directory, "espeak-ng.data"), "mock multilingual voice data");
  return runtimePath;
}

async function integrityFor(runtimePath: string): Promise<LocalPhonemizerIntegrity> {
  const digest = async (filePath: string): Promise<string> => (
    createHash("sha256").update(await fs.readFile(filePath)).digest("hex")
  );
  const dataPath = runtimePath.endsWith(".mjs") ? path.join(path.dirname(runtimePath), "espeak-ng.data") : null;
  return {
    runtimeSha256: await digest(runtimePath),
    dataPath,
    dataSha256: dataPath ? await digest(dataPath) : null,
  };
}

describe("local phonemizer service", () => {
  it("runs the opt-in runtime in a separate process and preserves punctuation", async () => {
    const runtimePath = await mockRuntime();
    const result = await phonemizeWithLocalRuntime(runtimePath, "Hello, world!", "en-us", await integrityFor(runtimePath));
    expect(result).toBe("en-us:HELLO, en-us:WORLD!");
  });

  it("uses the British language for British Kokoro voices", async () => {
    const runtimePath = await mockRuntime();
    const result = await phonemizeKokoro(runtimePath, "Hello.", true, await integrityFor(runtimePath));
    expect(result).toBe("en-gb:HELLO.");
  });

  it("uses the multilingual eSpeak runtime for German and removes its trace separators", async () => {
    const runtimePath = await mockMultilingualRuntime();
    const result = await phonemizeWithLocalRuntime(runtimePath, "Guten Tag!", "de", await integrityFor(runtimePath));
    expect(result).toBe("hˈaloː GUTEN TAG!");
  });

  it("fails closed when the multilingual runtime rejects a language", async () => {
    const runtimePath = await mockMultilingualRuntime();
    await expect(phonemizeWithLocalRuntime(runtimePath, "Bonjour.", "fr", await integrityFor(runtimePath)))
      .rejects.toThrow("Unsupported phonemizer language");
  });

  it("fails closed before loading a tampered executable runtime", async () => {
    const runtimePath = await mockRuntime();
    const integrity = await integrityFor(runtimePath);
    await fs.appendFile(runtimePath, "\nexports.tampered = true;");

    await expect(phonemizeWithLocalRuntime(runtimePath, "Hello.", "en-us", integrity))
      .rejects.toThrow("Phonemizer runtime integrity check failed");
  });

  it("fails closed before importing a runtime with tampered multilingual data", async () => {
    const runtimePath = await mockMultilingualRuntime();
    const integrity = await integrityFor(runtimePath);
    await fs.appendFile(integrity.dataPath!, "tampered");

    await expect(phonemizeWithLocalRuntime(runtimePath, "Guten Tag.", "de", integrity))
      .rejects.toThrow("Multilingual phonemizer data integrity check failed");
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

    await expect(phonemizeWithLocalRuntime(
      runtimePath,
      "This must not become model tokens.",
      "en-us",
      await integrityFor(runtimePath),
    ))
      .rejects.toThrow("incompatible");
  });
});
