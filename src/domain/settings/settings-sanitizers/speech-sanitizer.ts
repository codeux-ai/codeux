import type { DashboardSettings } from "../../../contracts/app-types.js";
import type { SpeechProviderMode, SpeechSettings } from "../../../contracts/speech-types.js";
import { SPEECH_PROVIDER_MODES } from "../../../contracts/speech-types.js";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../../repositories/settings-defaults.js";
import { readBoolean, readInteger, readString } from "../../../shared/config/value-readers.js";

export const MIN_SPEECH_AUDIO_SECONDS = 1;
export const MAX_SPEECH_AUDIO_SECONDS = 600;

const SPEECH_PROVIDER_MODE_SET = new Set<SpeechProviderMode>(SPEECH_PROVIDER_MODES);

const readSpeechProviderMode = (value: unknown, fallback: SpeechProviderMode): SpeechProviderMode => (
  typeof value === "string" && SPEECH_PROVIDER_MODE_SET.has(value as SpeechProviderMode)
    ? value as SpeechProviderMode
    : fallback
);

const readRequiredTrimmedString = (value: unknown, fallback: string): string => {
  const trimmed = readString(value, fallback).trim();
  return trimmed || fallback;
};

const readOptionalLanguage = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed || null;
};

export const sanitizeSpeech = (
  input: Partial<DashboardSettings> | undefined,
): SpeechSettings => {
  const speechInput = (input?.speech && typeof input.speech === "object"
    ? input.speech
    : {}) as Partial<SpeechSettings>;
  const defaults = DEFAULT_DASHBOARD_SETTINGS.speech;
  const externalInput = speechInput.externalTranscription && typeof speechInput.externalTranscription === "object"
    ? speechInput.externalTranscription as Partial<SpeechSettings["externalTranscription"]>
    : {};

  return {
    enabled: readBoolean(speechInput.enabled, defaults.enabled),
    providerMode: readSpeechProviderMode(speechInput.providerMode, defaults.providerMode),
    localModelId: readRequiredTrimmedString(speechInput.localModelId, defaults.localModelId),
    maxAudioSeconds: Math.max(
      MIN_SPEECH_AUDIO_SECONDS,
      Math.min(MAX_SPEECH_AUDIO_SECONDS, readInteger(speechInput.maxAudioSeconds, defaults.maxAudioSeconds)),
    ),
    externalTranscription: {
      baseUrl: readRequiredTrimmedString(externalInput.baseUrl, defaults.externalTranscription.baseUrl),
      apiKey: readString(externalInput.apiKey, defaults.externalTranscription.apiKey).trim(),
      model: readRequiredTrimmedString(externalInput.model, defaults.externalTranscription.model),
      language: readOptionalLanguage(externalInput.language),
    },
  };
};
