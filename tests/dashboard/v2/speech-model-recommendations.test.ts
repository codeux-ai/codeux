import { describe, expect, it } from "vitest";
import type { SpeechModelStatus } from "../../../dashboard/src/types.js";
import {
  getRecommendedSynthesisModel,
  getRecommendedVoice,
  getSynthesisLanguageOptions,
  getVoiceLanguageCode,
  isRecommendedForLanguage,
} from "../../../dashboard/src/v2/lib/speech-model-recommendations.js";

const model = (overrides: Partial<SpeechModelStatus>): SpeechModelStatus => ({
  id: "speech-model",
  kind: "synthesis",
  adapter: "piper",
  displayName: "Speech model",
  description: "Test speech model",
  repository: "test/speech-model",
  sourceUrl: "https://example.com/model",
  license: {
    id: "approved-license",
    name: "MIT",
    url: "https://example.com/license",
    commercialUseAllowed: true,
    notice: "Test notice.",
  },
  files: [],
  sizeBytes: 1,
  language: "English (US)",
  languages: [{ code: "en-US", label: "English (US)" }],
  supportsAutomaticLanguageDetection: false,
  sampleRateHz: 22_050,
  voices: [{ id: "default", label: "Default", language: "English (US)" }],
  defaultVoice: "default",
  downloaded: false,
  downloading: false,
  downloadProgress: 0,
  error: null,
  ...overrides,
});

describe("speech model recommendations", () => {
  it("builds one sorted language list across local synthesis models", () => {
    const options = getSynthesisLanguageOptions([
      model({ id: "german", language: "German", languages: [{ code: "de-DE", label: "German (Germany)" }] }),
      model({ id: "english" }),
      model({ id: "english-copy" }),
      model({ id: "stt", kind: "transcription", voices: [], defaultVoice: null }),
    ]);

    expect(options).toEqual([
      { code: "en-US", label: "English (US)" },
      { code: "de-DE", label: "German (Germany)" },
    ]);
  });

  it("prefers explicit catalog recommendations and a voice for the chosen language", () => {
    const fallback = model({ id: "fallback", languages: [{ code: "de-DE", label: "German (Germany)" }] });
    const recommended = model({
      id: "recommended",
      language: "German",
      languages: [{ code: "de-DE", label: "German (Germany)" }],
      voices: [
        { id: "english", label: "English", language: "English (US)" },
        { id: "german", label: "German", language: "German (Germany)" },
      ],
      defaultVoice: "english",
      recommendedForLanguages: ["de-DE"],
    } as Partial<SpeechModelStatus>);

    expect(getRecommendedSynthesisModel([fallback, recommended], "de-DE")?.id).toBe("recommended");
    expect(getRecommendedVoice(recommended, "de-DE")?.id).toBe("german");
    expect(getVoiceLanguageCode(recommended, recommended.voices[1])).toBe("de-DE");
    expect(isRecommendedForLanguage(recommended, [fallback, recommended], "de-DE")).toBe(true);
  });

  it("falls back to the first compatible catalog entry when recommendation metadata is absent", () => {
    const generic = model({ id: "generic" });
    const kokoro = model({ id: "kokoro-82m-v1.0-q8", adapter: "kokoro" });

    expect(getRecommendedSynthesisModel([generic, kokoro], "en-US")?.id).toBe("generic");
  });
});
