import { spawn } from "child_process";

const PHONEMIZER_RUNNER = String.raw`
const runtimePath = process.argv[1];
const language = process.argv[2];
const expectedRuntimeSha256 = process.argv[3];
const dataPath = process.argv[4];
const expectedDataSha256 = process.argv[5];
const fs = require("fs");
const { createHash } = require("crypto");
function verifyIntegrity(filePath, expectedSha256, label) {
  if (!/^[a-f0-9]{64}$/u.test(expectedSha256 || "")) throw new Error(label + " integrity metadata is missing.");
  const actualSha256 = createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
  if (actualSha256 !== expectedSha256) throw new Error(label + " integrity check failed. Delete and download the model again.");
}
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", async () => {
  try {
    verifyIntegrity(runtimePath, expectedRuntimeSha256, "Phonemizer runtime");
    if (runtimePath.endsWith(".mjs")) {
      if (!dataPath) throw new Error("Multilingual phonemizer data integrity metadata is missing.");
      verifyIntegrity(dataPath, expectedDataSha256, "Multilingual phonemizer data");
    }
    let phonemize;
    if (runtimePath.endsWith(".mjs")) {
      const { pathToFileURL } = require("url");
      const imported = await import(pathToFileURL(runtimePath).href);
      if (typeof imported.default !== "function") throw new Error("Downloaded multilingual phonemizer runtime is incompatible.");
      const runtime = await imported.default();
      if (typeof runtime.eSpeakNGWorker !== "function") throw new Error("Downloaded multilingual phonemizer runtime is incompatible.");
      const worker = new runtime.eSpeakNGWorker();
      phonemize = async (text, requestedLanguage) => {
        if (worker.set_voice(requestedLanguage) !== 0) throw new Error('Unsupported phonemizer language: "' + requestedLanguage + '".');
        const result = worker.synthesize_ipa(text);
        if (!result || result.code !== 0 || typeof result.ipa !== "string") throw new Error("Multilingual phonemization failed.");
        // eSpeak's trace underscores are phoneme separators. Piper inserts its
        // configured padding id itself, so passing the underscores through
        // would duplicate that separator for every symbol.
        return result.ipa.replace(/_/gu, "").split("\n").filter(Boolean);
      };
    } else {
      const runtime = require(runtimePath);
      if (typeof runtime.phonemize !== "function") throw new Error("Downloaded phonemizer runtime is incompatible.");
      phonemize = runtime.phonemize;
    }
    const parts = input.split(/([;:,.!?¡¿—…"«»“”]+)/u);
    const result = [];
    for (const part of parts) {
      if (!part) continue;
      if (/^[;:,.!?¡¿—…"«»“”]+$/u.test(part)) {
        result.push(part);
        continue;
      }
      const leadingSpace = /^\s/u.test(part) ? " " : "";
      const trailingSpace = /\s$/u.test(part) ? " " : "";
      const phonemes = await phonemize(part, language);
      result.push(leadingSpace + (Array.isArray(phonemes) ? phonemes.join(" ") : String(phonemes)) + trailingSpace);
    }
    process.stdout.write(JSON.stringify(result.join("")));
  } catch (error) {
    process.stderr.write(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
});
`;

export interface LocalPhonemizerIntegrity {
  runtimeSha256: string;
  dataPath?: string | null;
  dataSha256?: string | null;
}

export async function phonemizeWithLocalRuntime(
  runtimePath: string,
  text: string,
  language: string,
  integrity: LocalPhonemizerIntegrity,
  timeoutMs = 15_000,
): Promise<string> {
  return await new Promise((resolve, reject) => {
    let settled = false;
    const child = spawn(process.execPath, [
      "-e",
      PHONEMIZER_RUNNER,
      runtimePath,
      language,
      integrity.runtimeSha256,
      integrity.dataPath ?? "",
      integrity.dataSha256 ?? "",
    ], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error("Local phonemizer timed out."));
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(Buffer.concat(stderr).toString("utf8").trim() || `Local phonemizer exited with code ${code}.`));
        return;
      }
      try {
        const phonemes = JSON.parse(Buffer.concat(stdout).toString("utf8")) as unknown;
        if (typeof phonemes !== "string") {
          throw new Error("Local phonemizer returned an invalid result.");
        }
        resolve(phonemes.trim());
      } catch (error) {
        reject(error);
      }
    });
    child.stdin.end(text);
  });
}

// Normalization and post-processing are adapted from the Apache-2.0 Kokoro.js
// phonemizer pipeline so the ONNX tokenizer receives the IPA it was trained on.
export function normalizeKokoroText(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function postprocessKokoroPhonemes(phonemes: string, american: boolean): string {
  let result = phonemes
    .replace(/kəkˈoːɹoʊ/g, "kˈoʊkəɹoʊ")
    .replace(/kəkˈɔːɹəʊ/g, "kˈəʊkəɹəʊ")
    .replace(/ʲ/g, "j")
    .replace(/r/g, "ɹ")
    .replace(/x/g, "k")
    .replace(/ɬ/g, "l")
    .replace(/(?<=[a-zɹː])(?=hˈʌndɹɪd)/g, " ")
    .replace(/ z(?=[;:,.!?¡¿—…"«» ]|$)/g, "z");
  if (american) result = result.replace(/(?<=nˈaɪn)ti(?!ː)/g, "di");
  return result;
}

export async function phonemizeKokoro(
  runtimePath: string,
  text: string,
  british: boolean,
  integrity: LocalPhonemizerIntegrity,
): Promise<string> {
  const normalized = normalizeKokoroText(text);
  const phonemes = await phonemizeWithLocalRuntime(runtimePath, normalized, british ? "en-gb" : "en-us", integrity);
  return postprocessKokoroPhonemes(phonemes, !british);
}
