import type { DesignGuidanceEntrySettings, DesignGuidanceSettings } from "../../../types.js";
import {
  DESIGN_GUIDANCE_NONE_ID,
  getDefaultDesignGuidanceStyleguides,
  getDefaultDesignGuidanceTechStacks,
  isValidDesignGuidanceId,
} from "../../../../../src/domain/settings/design-guidance-catalog.js";

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
): string {
  const selectedId = getDesignGuidanceSelectedId(settings, kind);
  const entry = getAllDesignGuidanceEntries(settings, kind)
    .find((candidate) => candidate.id === selectedId);
  return entry?.name ?? `Unknown (${selectedId})`;
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

  if (!trimmedId) {
    validation.id = `${labels.singular} id is required.`;
  } else if (!isValidDesignGuidanceId(trimmedId)) {
    validation.id = "Use letters, numbers, underscores, or hyphens, up to 80 characters.";
  } else if (defaultIds.has(trimmedId)) {
    validation.id = `Use a custom id that does not match a built-in ${labels.singular}.`;
  } else if (duplicateCustomId) {
    validation.id = `${labels.singular} id must be unique.`;
  }

  if (!trimmedName) {
    validation.name = `${labels.singular} name is required.`;
  } else if (defaultNames.has(normalizeName(trimmedName))) {
    validation.name = `Use a custom name that does not match a built-in ${labels.singular}.`;
  } else if (duplicateCustomName) {
    validation.name = `${labels.singular} name must be unique.`;
  }

  if (!entry.summary.trim()) {
    validation.summary = "Summary is required.";
  }

  if (!entry.instructionMarkdown.trim()) {
    validation.instructionMarkdown = "Instruction markdown is required.";
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
): boolean {
  const entries = getCustomDesignGuidanceEntries(settings, kind);
  return entries.some((entry, index) => (
    validateDesignGuidanceCustomEntry(entry, entries, kind, index).hasError
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
