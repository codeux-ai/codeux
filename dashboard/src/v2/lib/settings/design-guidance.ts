import type { DesignGuidanceEntrySettings, DesignGuidanceSettings } from "../../../types.js";
import {
  DESIGN_GUIDANCE_NONE_ID,
  getDefaultDesignGuidanceStyleguides,
  getDefaultDesignGuidanceTechStacks,
  isValidDesignGuidanceId,
} from "../../../../../src/domain/settings/design-guidance-catalog.js";
import { settingsAgentsGuidanceMessages } from "../../i18n/messages/settings-agents-guidance.js";
import { translateDashboardMessage, type DashboardLocale } from "../../i18n/locales.js";

export type DesignGuidanceEntryKind = "techStack" | "styleguide";

export interface DesignGuidanceEntryValidation {
  id?: string;
  name?: string;
  summary?: string;
  instructionMarkdown?: string;
  hasError: boolean;
}

const KIND_LABELS: Record<DesignGuidanceEntryKind, { singular: string; idBase: string; nameBase: string }> = {
  techStack: {
    singular: "tech stack",
    idBase: "custom-tech-stack",
    nameBase: "Custom Tech Stack",
  },
  styleguide: {
    singular: "styleguide",
    idBase: "custom-styleguide",
    nameBase: "Custom Styleguide",
  },
};

const normalizeName = (value: string): string => value.trim().toLowerCase();

const selectedIdKey = (kind: DesignGuidanceEntryKind): keyof Pick<DesignGuidanceSettings, "selectedTechStackId" | "selectedStyleguideId"> => (
  kind === "techStack" ? "selectedTechStackId" : "selectedStyleguideId"
);

export function getDefaultDesignGuidanceEntries(kind: DesignGuidanceEntryKind): DesignGuidanceEntrySettings[] {
  return kind === "techStack"
    ? getDefaultDesignGuidanceTechStacks()
    : getDefaultDesignGuidanceStyleguides();
}

export function getCustomDesignGuidanceEntries(
  settings: DesignGuidanceSettings,
  kind: DesignGuidanceEntryKind,
): DesignGuidanceEntrySettings[] {
  const entries = kind === "techStack" ? settings.customTechStacks : settings.customStyleguides;
  return entries.map((entry) => ({ ...entry }));
}

export function getAllDesignGuidanceEntries(
  settings: DesignGuidanceSettings,
  kind: DesignGuidanceEntryKind,
): DesignGuidanceEntrySettings[] {
  return [
    ...getDefaultDesignGuidanceEntries(kind),
    ...getCustomDesignGuidanceEntries(settings, kind),
  ];
}

export function getVisibleDesignGuidanceEntries(
  settings: DesignGuidanceSettings,
  kind: DesignGuidanceEntryKind,
): DesignGuidanceEntrySettings[] {
  if (kind === "techStack" || !settings.hideDefaultStyleguides) {
    return getAllDesignGuidanceEntries(settings, kind);
  }

  const noneEntry = getDefaultDesignGuidanceStyleguides()
    .find((entry) => entry.id === DESIGN_GUIDANCE_NONE_ID);

  return [
    ...(noneEntry ? [{ ...noneEntry }] : []),
    ...getCustomDesignGuidanceEntries(settings, "styleguide"),
  ];
}

export function getDesignGuidanceSelectedId(
  settings: DesignGuidanceSettings,
  kind: DesignGuidanceEntryKind,
): string {
  return settings[selectedIdKey(kind)];
}

export function getDesignGuidanceActiveLabel(
  settings: DesignGuidanceSettings,
  kind: DesignGuidanceEntryKind,
  locale: DashboardLocale = "en",
): string {
  const selectedId = getDesignGuidanceSelectedId(settings, kind);
  if (selectedId === DESIGN_GUIDANCE_NONE_ID) {
    return translateDashboardMessage(settingsAgentsGuidanceMessages, locale, "guidanceNone");
  }
  const entry = getAllDesignGuidanceEntries(settings, kind)
    .find((candidate) => candidate.id === selectedId);
  return entry?.name ?? translateDashboardMessage(
    settingsAgentsGuidanceMessages,
    locale,
    "guidanceUnknown",
    { id: selectedId },
  );
}

export function isSelectedDefaultStyleguideHidden(settings: DesignGuidanceSettings): boolean {
  if (!settings.hideDefaultStyleguides || settings.selectedStyleguideId === DESIGN_GUIDANCE_NONE_ID) {
    return false;
  }

  const visibleIds = new Set(getVisibleDesignGuidanceEntries(settings, "styleguide").map((entry) => entry.id));
  return !visibleIds.has(settings.selectedStyleguideId);
}

export function validateDesignGuidanceCustomEntry(
  entry: DesignGuidanceEntrySettings,
  customEntries: DesignGuidanceEntrySettings[],
  kind: DesignGuidanceEntryKind,
  entryIndex: number,
  locale: DashboardLocale = "en",
): DesignGuidanceEntryValidation {
  const labels = KIND_LABELS[kind];
  const trimmedId = entry.id.trim();
  const trimmedName = entry.name.trim();
  const defaultEntries = getDefaultDesignGuidanceEntries(kind);
  const defaultIds = new Set(defaultEntries.map((candidate) => candidate.id));
  const defaultNames = new Set(defaultEntries.map((candidate) => normalizeName(candidate.name)));

  const duplicateCustomId = customEntries.some((candidate, candidateIndex) => (
    candidateIndex !== entryIndex && candidate.id.trim() === trimmedId
  ));
  const duplicateCustomName = customEntries.some((candidate, candidateIndex) => (
    candidateIndex !== entryIndex && normalizeName(candidate.name) === normalizeName(trimmedName)
  ));

  const validation: DesignGuidanceEntryValidation = { hasError: false };
  const localizedKind = translateDashboardMessage(
    settingsAgentsGuidanceMessages,
    locale,
    kind === "techStack" ? "guidanceTechStackLower" : "guidanceStyleguideLower",
  );
  const translateValidation = (
    key:
      | "guidanceIdRequired"
      | "guidanceIdPattern"
      | "guidanceIdBuiltIn"
      | "guidanceIdUnique"
      | "guidanceNameRequired"
      | "guidanceNameBuiltIn"
      | "guidanceNameUnique"
      | "guidanceSummaryRequired"
      | "guidanceInstructionRequired",
  ): string => translateDashboardMessage(settingsAgentsGuidanceMessages, locale, key, {
    kind: localizedKind,
  });

  if (!trimmedId) {
    validation.id = translateValidation("guidanceIdRequired");
  } else if (!isValidDesignGuidanceId(trimmedId)) {
    validation.id = translateValidation("guidanceIdPattern");
  } else if (defaultIds.has(trimmedId)) {
    validation.id = translateValidation("guidanceIdBuiltIn");
  } else if (duplicateCustomId) {
    validation.id = translateValidation("guidanceIdUnique");
  }

  if (!trimmedName) {
    validation.name = translateValidation("guidanceNameRequired");
  } else if (defaultNames.has(normalizeName(trimmedName))) {
    validation.name = translateValidation("guidanceNameBuiltIn");
  } else if (duplicateCustomName) {
    validation.name = translateValidation("guidanceNameUnique");
  }

  if (!entry.summary.trim()) {
    validation.summary = translateValidation("guidanceSummaryRequired");
  }

  if (!entry.instructionMarkdown.trim()) {
    validation.instructionMarkdown = translateValidation("guidanceInstructionRequired");
  }

  validation.hasError = Boolean(
    validation.id
    || validation.name
    || validation.summary
    || validation.instructionMarkdown
  );
  return validation;
}

export function hasDesignGuidanceValidationErrors(
  settings: DesignGuidanceSettings,
  kind: DesignGuidanceEntryKind,
  locale: DashboardLocale = "en",
): boolean {
  const entries = getCustomDesignGuidanceEntries(settings, kind);
  return entries.some((entry, index) => (
    validateDesignGuidanceCustomEntry(entry, entries, kind, index, locale).hasError
  ));
}

export function createDesignGuidanceCustomEntry(
  settings: DesignGuidanceSettings,
  kind: DesignGuidanceEntryKind,
): DesignGuidanceEntrySettings {
  const labels = KIND_LABELS[kind];
  const existingIds = new Set(getAllDesignGuidanceEntries(settings, kind).map((entry) => entry.id));
  let id = labels.idBase;
  let suffix = 2;

  while (existingIds.has(id)) {
    id = `${labels.idBase}-${suffix}`;
    suffix += 1;
  }

  return {
    id,
    name: labels.nameBase,
    summary: `Custom ${labels.singular} guidance for this scope.`,
    instructionMarkdown: `Describe the ${labels.singular} guidance workers should apply.`,
  };
}
