import * as fs from "fs/promises";
import * as path from "path";
import {
  LOCAL_TRANSCRIPTION_MODEL_IDS,
  type SpeechModelCatalogItem,
  type SpeechModelFile,
  type SpeechModelLanguage,
} from "../contracts/speech-types.js";
import { getHomeCodeUxPath } from "../shared/config/code-ux-paths.js";
import { assertCatalogLicenseApproved } from "./model-license-policy.js";

export interface SpeechModelCatalogEntry extends SpeechModelCatalogItem {
  modelFile: string;
  labelsFile?: string;
  configFile?: string;
  /** Immutable upstream revision used for downloads when supplied. */
  revision?: string;
}

export interface SpeechModelPaths {
  modelDir: string;
  modelPath: string;
  labelsPath: string | null;
  configPath: string | null;
  phonemizerPath: string | null;
  phonemizerSha256: string | null;
  phonemizerDataPath: string | null;
  phonemizerDataSha256: string | null;
}

const hf = (repository: string): string => `https://huggingface.co/${repository}`;
const file = (sourcePath: string, localName = sourcePath, options: Pick<SpeechModelFile, "downloadUrl" | "sha256"> = {}): SpeechModelFile => ({ sourcePath, localName, ...options });
const mit = (id: string, url: string, notice: string) => ({ id, name: "MIT", url, commercialUseAllowed: true, notice });
const PIPER_VOICES_REVISION = "e21c7de8d4eab79b902f0d61e662b3f21664b8d2";
const PHONEMIZER_FILES: SpeechModelFile[] = [
  file("runtime/phonemizer.cjs", "runtime/phonemizer.cjs", {
    downloadUrl: "https://cdn.jsdelivr.net/npm/phonemizer@1.2.1/dist/phonemizer.cjs",
    sha256: "24d24f118e44dc60af797881617415be24d84de53c1fc1a8f7f9974ab52531cc",
  }),
  file("licenses/phonemizer-Apache-2.0.txt", "licenses/phonemizer-Apache-2.0.txt", {
    downloadUrl: "https://cdn.jsdelivr.net/npm/phonemizer@1.2.1/LICENSE",
    sha256: "c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4",
  }),
  file("licenses/espeak-ng-GPL-3.0-or-later.txt", "licenses/espeak-ng-GPL-3.0-or-later.txt", {
    downloadUrl: "https://raw.githubusercontent.com/espeak-ng/espeak-ng/1.52.0/COPYING",
    sha256: "8ceb4b9ee5adedde47b31e975c1d90c73ad27b6b165a1dcd80c7c545eb65b903",
  }),
];
const MULTILINGUAL_ESPEAK_FILES: SpeechModelFile[] = [
  file("runtime/espeak-ng.mjs", "runtime/espeak-ng.mjs", {
    downloadUrl: "https://cdn.jsdelivr.net/npm/@echogarden/espeak-ng-emscripten@0.3.5/espeak-ng.js",
    sha256: "3502d997af2640e54518a06845776c8507bfeebd8ff75f80176370e35de9896b",
  }),
  file("runtime/espeak-ng.data", "runtime/espeak-ng.data", {
    downloadUrl: "https://cdn.jsdelivr.net/npm/@echogarden/espeak-ng-emscripten@0.3.5/espeak-ng.data",
    sha256: "f7f8eff5685c709db9dae81e88a0e0556867d60514f7308ae99e0579369397b5",
  }),
  file("licenses/espeak-ng-GPL-3.0.txt", "licenses/espeak-ng-GPL-3.0.txt", {
    downloadUrl: "https://cdn.jsdelivr.net/npm/@echogarden/espeak-ng-emscripten@0.3.5/COPYING",
    sha256: "8ceb4b9ee5adedde47b31e975c1d90c73ad27b6b165a1dcd80c7c545eb65b903",
  }),
  file("licenses/ESPEAK_EMSCRIPTEN_README.md", "licenses/ESPEAK_EMSCRIPTEN_README.md", {
    downloadUrl: "https://cdn.jsdelivr.net/npm/@echogarden/espeak-ng-emscripten@0.3.5/README.md",
    sha256: "8b1a524a57d2a44459fd322c3bcdaa998dc839a71b4b136ce0d5676a5d5db2da",
  }),
  file("licenses/ESPEAK_EMSCRIPTEN_PACKAGE.json", "licenses/ESPEAK_EMSCRIPTEN_PACKAGE.json", {
    downloadUrl: "https://cdn.jsdelivr.net/npm/@echogarden/espeak-ng-emscripten@0.3.5/package.json",
    sha256: "1395da6974a7f8faa3a46b67ac62088e248a051cbed5c6da10ef1b1d2385dc67",
  }),
];

/** Languages encoded by the pinned multilingual Whisper Tiny/Base generation configs. */
export const WHISPER_MULTILINGUAL_LANGUAGES: SpeechModelLanguage[] = [
  ["af", "Afrikaans"], ["am", "Amharic"], ["ar", "Arabic"], ["as", "Assamese"],
  ["az", "Azerbaijani"], ["ba", "Bashkir"], ["be", "Belarusian"], ["bg", "Bulgarian"],
  ["bn", "Bengali"], ["bo", "Tibetan"], ["br", "Breton"], ["bs", "Bosnian"],
  ["ca", "Catalan"], ["cs", "Czech"], ["cy", "Welsh"], ["da", "Danish"],
  ["de", "German"], ["el", "Greek"], ["en", "English"], ["es", "Spanish"],
  ["et", "Estonian"], ["eu", "Basque"], ["fa", "Persian"], ["fi", "Finnish"],
  ["fo", "Faroese"], ["fr", "French"], ["gl", "Galician"], ["gu", "Gujarati"],
  ["ha", "Hausa"], ["haw", "Hawaiian"], ["he", "Hebrew"], ["hi", "Hindi"],
  ["hr", "Croatian"], ["ht", "Haitian Creole"], ["hu", "Hungarian"], ["hy", "Armenian"],
  ["id", "Indonesian"], ["is", "Icelandic"], ["it", "Italian"], ["ja", "Japanese"],
  ["jw", "Javanese"], ["ka", "Georgian"], ["kk", "Kazakh"], ["km", "Khmer"],
  ["kn", "Kannada"], ["ko", "Korean"], ["la", "Latin"], ["lb", "Luxembourgish"],
  ["ln", "Lingala"], ["lo", "Lao"], ["lt", "Lithuanian"], ["lv", "Latvian"],
  ["mg", "Malagasy"], ["mi", "Maori"], ["mk", "Macedonian"], ["ml", "Malayalam"],
  ["mn", "Mongolian"], ["mr", "Marathi"], ["ms", "Malay"], ["mt", "Maltese"],
  ["my", "Myanmar"], ["ne", "Nepali"], ["nl", "Dutch"], ["nn", "Nynorsk"],
  ["no", "Norwegian"], ["oc", "Occitan"], ["pa", "Punjabi"], ["pl", "Polish"],
  ["ps", "Pashto"], ["pt", "Portuguese"], ["ro", "Romanian"], ["ru", "Russian"],
  ["sa", "Sanskrit"], ["sd", "Sindhi"], ["si", "Sinhala"], ["sk", "Slovak"],
  ["sl", "Slovenian"], ["sn", "Shona"], ["so", "Somali"], ["sq", "Albanian"],
  ["sr", "Serbian"], ["su", "Sundanese"], ["sv", "Swedish"], ["sw", "Swahili"],
  ["ta", "Tamil"], ["te", "Telugu"], ["tg", "Tajik"], ["th", "Thai"],
  ["tk", "Turkmen"], ["tl", "Tagalog"], ["tr", "Turkish"], ["tt", "Tatar"],
  ["uk", "Ukrainian"], ["ur", "Urdu"], ["uz", "Uzbek"], ["vi", "Vietnamese"],
  ["yi", "Yiddish"], ["yo", "Yoruba"], ["zh", "Chinese"],
].map(([code, label]) => ({ code, label }));

const ENGLISH_LANGUAGE: SpeechModelLanguage[] = [{ code: "en", label: "English" }];

export const SPEECH_MODEL_CATALOG: Record<string, SpeechModelCatalogEntry> = {
  [LOCAL_TRANSCRIPTION_MODEL_IDS[0]]: {
    id: LOCAL_TRANSCRIPTION_MODEL_IDS[0],
    kind: "transcription",
    adapter: "whisper",
    displayName: "Whisper Base English ONNX",
    description: "Higher-accuracy English transcription with local Whisper encoder-decoder inference.",
    repository: "onnx-community/whisper-base.en",
    sourceUrl: hf("onnx-community/whisper-base.en"),
    license: mit("openai-whisper-mit-v1", "https://github.com/openai/whisper/blob/main/LICENSE", "MIT-licensed Whisper weights converted to ONNX."),
    files: [
      file("onnx/encoder_model_int8.onnx", "encoder_model.onnx"),
      file("onnx/decoder_model_merged_int8.onnx", "decoder_model_merged.onnx"),
      file("tokenizer.json"),
      file("preprocessor_config.json"),
      file("generation_config.json"),
    ],
    modelFile: "encoder_model.onnx",
    labelsFile: "tokenizer.json",
    sizeBytes: 80_000_000,
    language: "English",
    languages: ENGLISH_LANGUAGE,
    supportsAutomaticLanguageDetection: false,
    sampleRateHz: 16000,
    voices: [],
    defaultVoice: null,
  },
  [LOCAL_TRANSCRIPTION_MODEL_IDS[1]]: {
    id: LOCAL_TRANSCRIPTION_MODEL_IDS[1],
    kind: "transcription",
    adapter: "whisper",
    displayName: "Whisper Tiny English ONNX",
    description: "Compact English Whisper transcription for faster local CPU inference.",
    repository: "onnx-community/whisper-tiny.en",
    sourceUrl: hf("onnx-community/whisper-tiny.en"),
    license: mit("openai-whisper-mit-v1", "https://github.com/openai/whisper/blob/main/LICENSE", "MIT-licensed Whisper weights converted to ONNX."),
    files: [
      file("onnx/encoder_model_int8.onnx", "encoder_model.onnx"),
      file("onnx/decoder_model_merged_int8.onnx", "decoder_model_merged.onnx"),
      file("tokenizer.json"),
      file("preprocessor_config.json"),
      file("generation_config.json"),
    ],
    modelFile: "encoder_model.onnx",
    labelsFile: "tokenizer.json",
    sizeBytes: 44_000_000,
    language: "English",
    languages: ENGLISH_LANGUAGE,
    supportsAutomaticLanguageDetection: false,
    sampleRateHz: 16000,
    voices: [],
    defaultVoice: null,
  },
  [LOCAL_TRANSCRIPTION_MODEL_IDS[2]]: {
    id: LOCAL_TRANSCRIPTION_MODEL_IDS[2],
    kind: "transcription",
    adapter: "whisper",
    displayName: "Whisper Base Multilingual ONNX",
    description: "Balanced multilingual Whisper transcription with automatic language detection or an explicit language.",
    repository: "onnx-community/whisper-base",
    revision: "1846881b6b3a3024392c1eea3ad983695bc23925",
    sourceUrl: `${hf("onnx-community/whisper-base")}/tree/1846881b6b3a3024392c1eea3ad983695bc23925`,
    license: mit("openai-whisper-mit-multilingual-v1", "https://github.com/openai/whisper/blob/main/LICENSE", "MIT-licensed OpenAI Whisper Base weights converted to ONNX by ONNX Community. Downloads are pinned to an immutable conversion revision."),
    files: [
      file("onnx/encoder_model_int8.onnx", "encoder_model.onnx", { sha256: "ca6177401f86a2c6b4dc5f7fc02fbca680678906bd0c22f6d89f0b80f124253f" }),
      file("onnx/decoder_model_merged_int8.onnx", "decoder_model_merged.onnx", { sha256: "fa3ef9902734ce5ae6f9ef2bdb2ba9a6c4b5785b09f4f420ce036573dc9d090b" }),
      file("tokenizer.json", "tokenizer.json", { sha256: "27fc476bfe7f17299480be2273fc0608e4d5a99aba2ab5dec5374b4482d1a566" }),
      file("preprocessor_config.json", "preprocessor_config.json", { sha256: "a6a76d28c93edb273669eb9e0b0636a2bddbb1272c3261e47b7ca6dfdbac1b8d" }),
      file("generation_config.json", "generation_config.json", { sha256: "61070cf8de25b1e9256e8e102ded49d8d24a8369ed36ef84fdf21549e68125a0" }),
    ],
    modelFile: "encoder_model.onnx",
    labelsFile: "tokenizer.json",
    sizeBytes: 79_379_249,
    language: "Multilingual",
    languages: WHISPER_MULTILINGUAL_LANGUAGES,
    supportsAutomaticLanguageDetection: true,
    sampleRateHz: 16000,
    voices: [],
    defaultVoice: null,
  },
  [LOCAL_TRANSCRIPTION_MODEL_IDS[3]]: {
    id: LOCAL_TRANSCRIPTION_MODEL_IDS[3],
    kind: "transcription",
    adapter: "whisper",
    displayName: "Whisper Tiny Multilingual ONNX",
    description: "Compact multilingual Whisper transcription for faster local CPU inference with automatic language detection.",
    repository: "onnx-community/whisper-tiny",
    revision: "ff4177021cc41f7db950912b73ea4fdf7d01d8e7",
    sourceUrl: `${hf("onnx-community/whisper-tiny")}/tree/ff4177021cc41f7db950912b73ea4fdf7d01d8e7`,
    license: mit("openai-whisper-mit-multilingual-v1", "https://github.com/openai/whisper/blob/main/LICENSE", "MIT-licensed OpenAI Whisper Tiny weights converted to ONNX by ONNX Community. Downloads are pinned to an immutable conversion revision."),
    files: [
      file("onnx/encoder_model_int8.onnx", "encoder_model.onnx", { sha256: "03ff3c99ce804f79a42afd6212c9492eb75e55625926de66f8fc192e9567d336" }),
      file("onnx/decoder_model_merged_int8.onnx", "decoder_model_merged.onnx", { sha256: "25e807a962b6349356d0ea5d0dfe530b7e5bf0e2a484aeca0359d03143faddd3" }),
      file("tokenizer.json", "tokenizer.json", { sha256: "27fc476bfe7f17299480be2273fc0608e4d5a99aba2ab5dec5374b4482d1a566" }),
      file("preprocessor_config.json", "preprocessor_config.json", { sha256: "a6a76d28c93edb273669eb9e0b0636a2bddbb1272c3261e47b7ca6dfdbac1b8d" }),
      file("generation_config.json", "generation_config.json", { sha256: "f5c67e5a4f7102f8cb4d058bc95da276bbc19eeec997267c3bb0f25ef68facd1" }),
    ],
    modelFile: "encoder_model.onnx",
    labelsFile: "tokenizer.json",
    sizeBytes: 43_328_795,
    language: "Multilingual",
    languages: WHISPER_MULTILINGUAL_LANGUAGES,
    supportsAutomaticLanguageDetection: true,
    sampleRateHz: 16000,
    voices: [],
    defaultVoice: null,
  },
  "kokoro-82m-v1.0-q8": {
    id: "kokoro-82m-v1.0-q8",
    kind: "synthesis",
    adapter: "kokoro",
    displayName: "Kokoro 82M v1.0 Q8",
    description: "Natural multi-voice synthesis with an 8-bit ONNX checkpoint and five lightweight English voices (~0.5 MB each).",
    repository: "onnx-community/Kokoro-82M-v1.0-ONNX",
    sourceUrl: hf("onnx-community/Kokoro-82M-v1.0-ONNX"),
    license: {
      id: "kokoro-apache-2.0-cc-by-3.0-4.0-phonemizer-1.2.1-espeak-gpl3-v3",
      name: "Apache-2.0 + CC-BY-3.0/4.0 + GPL-3.0-or-later",
      url: "https://huggingface.co/hexgrad/Kokoro-82M/blob/main/README.md",
      commercialUseAllowed: true,
      notice: "Kokoro weights and the phonemizer wrapper are Apache-2.0. Its disclosed training sources include Koniwa under CC BY 3.0 and SIWIS under CC BY 4.0; the pinned upstream model card with attribution links is installed with the bundle. The embedded eSpeak NG engine is GPL-3.0-or-later. Review attribution, GPL source, and redistribution obligations before redistributing the downloaded bundle.",
    },
    files: [
      file("onnx/model_quantized.onnx", "model.onnx"),
      file("tokenizer.json"),
      file("voices/af_heart.bin"),
      file("voices/af_bella.bin"),
      file("voices/af_sky.bin"),
      file("voices/am_michael.bin"),
      file("voices/bf_emma.bin"),
      file("README.md", "licenses/KOKORO_MODEL_CARD.md", {
        downloadUrl: "https://huggingface.co/hexgrad/Kokoro-82M/raw/f3ff3571791e39611d31c381e3a41a3af07b4987/README.md",
        sha256: "91dcabced89db6f109b8786642f50402d3ee87450e8189589b6f85520e7f4d78",
      }),
      ...PHONEMIZER_FILES,
    ],
    modelFile: "model.onnx",
    labelsFile: "tokenizer.json",
    sizeBytes: 98_000_000,
    language: "English",
    languages: [
      { code: "en-US", label: "English (US)" },
      { code: "en-GB", label: "English (UK)" },
    ],
    supportsAutomaticLanguageDetection: false,
    sampleRateHz: 24000,
    voices: [
      { id: "af_heart", label: "Heart", language: "English (US)", languageCode: "en-US" },
      { id: "af_bella", label: "Bella", language: "English (US)", languageCode: "en-US" },
      { id: "af_sky", label: "Sky", language: "English (US)", languageCode: "en-US" },
      { id: "am_michael", label: "Michael", language: "English (US)", languageCode: "en-US" },
      { id: "bf_emma", label: "Emma", language: "English (UK)", languageCode: "en-GB" },
    ],
    defaultVoice: "af_heart",
    recommendedForLanguages: ["en-US"],
  },
  "piper-en-us-ljspeech-medium": {
    id: "piper-en-us-ljspeech-medium",
    kind: "synthesis",
    adapter: "piper",
    displayName: "Piper LJSpeech Medium",
    description: "Fast American English voice trained from scratch with public-domain LJSpeech data.",
    repository: "rhasspy/piper-voices",
    sourceUrl: `${hf("rhasspy/piper-voices")}/tree/main/en/en_US/ljspeech/medium`,
    license: {
      id: "piper-ljspeech-mit-public-domain-phonemizer-gpl3-v2",
      name: "MIT + Apache-2.0 + GPL-3.0-or-later",
      url: `${hf("rhasspy/piper-voices")}/blob/main/en/en_US/ljspeech/medium/MODEL_CARD`,
      commercialUseAllowed: true,
      notice: "The Piper voice repository is MIT, LJSpeech training data is public domain, and the voice was trained from scratch. The phonemizer wrapper is Apache-2.0 and its embedded eSpeak NG engine is GPL-3.0-or-later (https://github.com/espeak-ng/espeak-ng#license-information); notices are installed with the runtime.",
    },
    files: [
      file("en/en_US/ljspeech/medium/en_US-ljspeech-medium.onnx", "model.onnx"),
      file("en/en_US/ljspeech/medium/en_US-ljspeech-medium.onnx.json", "config.json"),
      file("en/en_US/ljspeech/medium/MODEL_CARD", "licenses/MODEL_CARD.txt"),
      ...PHONEMIZER_FILES,
    ],
    modelFile: "model.onnx",
    configFile: "config.json",
    sizeBytes: 64_900_000,
    language: "English (US)",
    languages: [{ code: "en-US", label: "English (US)" }],
    supportsAutomaticLanguageDetection: false,
    sampleRateHz: 22050,
    voices: [{ id: "ljspeech", label: "LJSpeech", language: "English (US)", languageCode: "en-US" }],
    defaultVoice: "ljspeech",
  },
  "piper-en-gb-cori-medium": {
    id: "piper-en-gb-cori-medium",
    kind: "synthesis",
    adapter: "piper",
    displayName: "Piper Cori Medium",
    description: "Efficient British English voice trained from scratch with public-domain LibriVox data.",
    repository: "rhasspy/piper-voices",
    sourceUrl: `${hf("rhasspy/piper-voices")}/tree/main/en/en_GB/cori/medium`,
    license: {
      id: "piper-cori-mit-public-domain-phonemizer-gpl3-v2",
      name: "MIT + Apache-2.0 + GPL-3.0-or-later",
      url: `${hf("rhasspy/piper-voices")}/blob/main/en/en_GB/cori/medium/MODEL_CARD`,
      commercialUseAllowed: true,
      notice: "The Piper voice repository is MIT, LibriVox training data is public domain, and the voice was trained from scratch. The phonemizer wrapper is Apache-2.0 and its embedded eSpeak NG engine is GPL-3.0-or-later (https://github.com/espeak-ng/espeak-ng#license-information); notices are installed with the runtime.",
    },
    files: [
      file("en/en_GB/cori/medium/en_GB-cori-medium.onnx", "model.onnx"),
      file("en/en_GB/cori/medium/en_GB-cori-medium.onnx.json", "config.json"),
      file("en/en_GB/cori/medium/MODEL_CARD", "licenses/MODEL_CARD.txt"),
      ...PHONEMIZER_FILES,
    ],
    modelFile: "model.onnx",
    configFile: "config.json",
    sizeBytes: 64_900_000,
    language: "English (UK)",
    languages: [{ code: "en-GB", label: "English (UK)" }],
    supportsAutomaticLanguageDetection: false,
    sampleRateHz: 22050,
    voices: [{ id: "cori", label: "Cori", language: "English (UK)", languageCode: "en-GB" }],
    defaultVoice: "cori",
    recommendedForLanguages: ["en-GB"],
  },
  "piper-de-de-mls-medium": {
    id: "piper-de-de-mls-medium",
    kind: "synthesis",
    adapter: "piper",
    displayName: "Piper MLS German Medium",
    description: "Clear German synthesis trained from scratch on the CC BY 4.0 Multilingual LibriSpeech corpus.",
    repository: "rhasspy/piper-voices",
    revision: PIPER_VOICES_REVISION,
    sourceUrl: `${hf("rhasspy/piper-voices")}/tree/${PIPER_VOICES_REVISION}/de/de_DE/mls/medium`,
    license: {
      id: "piper-mls-de-mit-cc-by-4.0-espeak-emscripten-gpl3-v1",
      name: "MIT + CC-BY-4.0 + GPL-3.0-only",
      url: `${hf("rhasspy/piper-voices")}/blob/${PIPER_VOICES_REVISION}/de/de_DE/mls/medium/MODEL_CARD`,
      commercialUseAllowed: true,
      notice: "The Piper Voices repository is MIT-licensed. This German checkpoint was trained from scratch on Multilingual LibriSpeech by Vineel Pratap, Qiantong Xu, Anuroop Sriram, Gabriel Synnaeve, and Ronan Collobert (OpenSLR SLR94, https://www.openslr.org/94/), licensed CC BY 4.0. The opt-in @echogarden eSpeak NG Emscripten 0.3.5 runtime is GPL-3.0-only; its immutable package source is https://github.com/echogarden-project/espeak-ng-emscripten/tree/ea36b43595facf07f1c5dc487b9f0de3340c1b5e and its eSpeak NG fork source is https://github.com/echogarden-project/espeak-ng/tree/b723b62cb78f7e861a1bb4408b00d49db84afeac. Preserve attribution and review GPL source and redistribution obligations before redistributing the downloaded bundle.",
    },
    files: [
      file("de/de_DE/mls/medium/de_DE-mls-medium.onnx", "model.onnx", {
        sha256: "69cd1d2aa5a35839a518966fcc4924b5f93e5f8c948ed0752b1a616ad53f65bf",
      }),
      file("de/de_DE/mls/medium/de_DE-mls-medium.onnx.json", "config.json", {
        sha256: "b0af1c89ddfdc72d32e015729b0e89b99eec13c2c8caa1db7488d98e9e570b40",
      }),
      file("de/de_DE/mls/medium/MODEL_CARD", "licenses/MODEL_CARD.txt", {
        sha256: "ca1bf03a3c287fb6968acfa010e1917f85f0aa59db0f371efc3a2857f4035ffd",
      }),
      file("README.md", "licenses/PIPER_VOICES_MODEL_CARD.md", {
        sha256: "33e93643fce5180886300f9f0070eeeab8af148efb8e84361f8904def80fd9fb",
      }),
      file("licenses/CC-BY-4.0.txt", "licenses/CC-BY-4.0.txt", {
        downloadUrl: "https://creativecommons.org/licenses/by/4.0/legalcode.txt",
        sha256: "9ba9550ad48438d0836ddab3da480b3b69ffa0aac7b7878b5a0039e7ab429411",
      }),
      ...MULTILINGUAL_ESPEAK_FILES,
    ],
    modelFile: "model.onnx",
    configFile: "config.json",
    sizeBytes: 101_882_821,
    language: "German (Germany)",
    languages: [{ code: "de-DE", label: "German (Germany)" }],
    supportsAutomaticLanguageDetection: false,
    sampleRateHz: 22050,
    voices: [{
      id: "mls-de-default",
      label: "MLS German",
      language: "German (Germany)",
      languageCode: "de-DE",
      speakerId: 0,
    }],
    defaultVoice: "mls-de-default",
    recommendedForLanguages: ["de-DE"],
  },
};

export function sanitizeModelIdForPath(modelId: string): string {
  const trimmed = modelId.trim().toLowerCase();
  return trimmed.replace(/\//g, "--").replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "unknown-model";
}

export function resolveSpeechModelEntry(modelId: string): SpeechModelCatalogEntry {
  const model = SPEECH_MODEL_CATALOG[modelId];
  if (!model) throw new Error(`Unknown speech model: ${modelId}`);
  return model;
}

/** Keeps persisted local voice selections compatible when an inherited model
 * changes. Project and sprint scopes may override only the voice field, so a
 * previously valid child override must not make a newly selected parent model
 * unusable. */
export function resolveCompatibleSynthesisVoice(modelId: string, voiceId: string): string {
  const model = resolveSpeechModelEntry(modelId);
  const requestedVoice = voiceId.trim();
  if (model.kind !== "synthesis") return requestedVoice;
  if (model.voices.some((voice) => voice.id === requestedVoice)) return requestedVoice;
  return model.defaultVoice ?? model.voices[0]?.id ?? requestedVoice;
}

export function getSpeechModelCacheRoot(dataDir?: string): string {
  return dataDir || getHomeCodeUxPath("models", "speech");
}

export function getSpeechModelPaths(modelId: string, dataDir?: string): SpeechModelPaths {
  const entry = resolveSpeechModelEntry(modelId);
  const modelDir = path.join(getSpeechModelCacheRoot(dataDir), sanitizeModelIdForPath(entry.id));
  const phonemizerFile = entry.files.find((item) => (
    item.localName === "runtime/phonemizer.cjs" || item.localName === "runtime/espeak-ng.mjs"
  ));
  const phonemizerDataFile = entry.files.find((item) => item.localName === "runtime/espeak-ng.data");
  return {
    modelDir,
    modelPath: path.join(modelDir, entry.modelFile),
    labelsPath: entry.labelsFile ? path.join(modelDir, entry.labelsFile) : null,
    configPath: entry.configFile ? path.join(modelDir, entry.configFile) : null,
    phonemizerPath: phonemizerFile ? path.join(modelDir, phonemizerFile.localName) : null,
    phonemizerSha256: phonemizerFile?.sha256 ?? null,
    phonemizerDataPath: phonemizerDataFile ? path.join(modelDir, phonemizerDataFile.localName) : null,
    phonemizerDataSha256: phonemizerDataFile?.sha256 ?? null,
  };
}

for (const model of Object.values(SPEECH_MODEL_CATALOG)) {
  assertCatalogLicenseApproved(model.license, model.id);
}

export async function isSpeechModelAvailable(modelId: string, dataDir?: string): Promise<boolean> {
  const entry = resolveSpeechModelEntry(modelId);
  const { modelDir } = getSpeechModelPaths(modelId, dataDir);
  try {
    const files = await Promise.all(entry.files.map((item) => fs.stat(path.join(modelDir, item.localName))));
    return files.every((stat) => stat.isFile());
  } catch {
    return false;
  }
}
