import type { SpeechModelStatus, SpeechModelVoice } from "../../types.js";
import type { DashboardLocale } from "../i18n/locales.js";

export interface SynthesisLanguageOption {
  code: string;
  label: string;
}

const getSynthesisModels = (models: SpeechModelStatus[]): SpeechModelStatus[] => (
  models.filter((model) => model.kind === "synthesis")
);

const getModelLanguages = (model: SpeechModelStatus): SynthesisLanguageOption[] => {
  if (model.languages?.length) return model.languages;
  const normalized = model.language.toLocaleLowerCase();
  const code = normalized.includes("german")
    ? "de-DE"
    : normalized.includes("uk") || normalized.includes("british")
      ? "en-GB"
      : normalized.includes("english")
        ? "en-US"
        : normalized;
  return [{ code, label: model.language }];
};

export const getSynthesisLanguageOptions = (
  models: SpeechModelStatus[],
  locale: DashboardLocale = "en",
): SynthesisLanguageOption[] => {
  const languages = new Map<string, string>();
  for (const model of getSynthesisModels(models)) {
    for (const language of getModelLanguages(model)) languages.set(language.code, language.label);
  }
  return [...languages.entries()]
    .map(([code, label]) => ({ code, label }))
    .sort((left, right) => left.label.localeCompare(right.label, locale));
};

export const modelSupportsLanguage = (model: SpeechModelStatus, languageCode: string): boolean => (
  model.kind === "synthesis" && getModelLanguages(model).some((language) => language.code === languageCode)
);

export const getVoiceLanguageCode = (
  model: SpeechModelStatus,
  voice: SpeechModelVoice | undefined,
): string | null => {
  if (!voice) return getModelLanguages(model)[0]?.code ?? null;
  const explicitCode = voice.languageCode;
  if (explicitCode && modelSupportsLanguage(model, explicitCode)) return explicitCode;
  return getModelLanguages(model).find((language) => language.label === voice.language)?.code
    ?? null;
};

export const getRecommendedSynthesisModel = (
  models: SpeechModelStatus[],
  languageCode: string,
): SpeechModelStatus | null => {
  const compatible = getSynthesisModels(models).filter((model) => modelSupportsLanguage(model, languageCode));
  if (!compatible.length) return null;
  const explicit = compatible.find((model) => model.recommendedForLanguages?.includes(languageCode));
  if (explicit) return explicit;
  return compatible[0] ?? null;
};

export const getRecommendedVoice = (
  model: SpeechModelStatus,
  languageCode: string,
): SpeechModelVoice | null => {
  const languageVoice = model.voices.find((voice) => getVoiceLanguageCode(model, voice) === languageCode);
  if (languageVoice) return languageVoice;
  return model.voices.find((voice) => voice.id === model.defaultVoice) ?? model.voices[0] ?? null;
};

export const isRecommendedForLanguage = (
  model: SpeechModelStatus,
  models: SpeechModelStatus[],
  languageCode: string,
): boolean => getRecommendedSynthesisModel(models, languageCode)?.id === model.id;
