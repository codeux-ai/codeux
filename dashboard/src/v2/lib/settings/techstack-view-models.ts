import type { TechstackCatalogSettings, TechstackSelectionSettings } from "../../../types.js";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../../lib/settings.js";

export type TechstackSelectorOptionKind = "unassigned" | "catalog";

export interface TechstackSelectorOption {
  id: string;
  label: string;
  kind: TechstackSelectorOptionKind;
  techstackId: string | null;
}

export interface TechstackSelectorViewModel {
  activeLabel: string;
  activeTechstackId: string;
  selectedTechstackId: string | null;
  isUnassigned: boolean;
  defaultLabel: string;
  options: TechstackSelectorOption[];
}

const UNASSIGNED_OPTION_ID = "__unassigned__";

const normalizeCatalog = (catalog: TechstackCatalogSettings | null | undefined): TechstackCatalogSettings => {
  const source = catalog ?? DEFAULT_DASHBOARD_SETTINGS.techstackCatalog;
  const entries = source.entries.length > 0 ? source.entries : DEFAULT_DASHBOARD_SETTINGS.techstackCatalog.entries;
  const hasDefault = entries.some((entry) => entry.id === source.defaultTechstackId);
  const defaultTechstackId = hasDefault
    ? source.defaultTechstackId
    : DEFAULT_DASHBOARD_SETTINGS.techstackCatalog.defaultTechstackId;

  return {
    defaultTechstackId,
    entries,
  };
};

export const buildTechstackSelectorViewModel = (
  selection: TechstackSelectionSettings | null | undefined,
  catalog: TechstackCatalogSettings | null | undefined,
): TechstackSelectorViewModel => {
  const normalizedCatalog = normalizeCatalog(catalog);
  const defaultEntry = normalizedCatalog.entries.find((entry) => entry.id === normalizedCatalog.defaultTechstackId)
    ?? DEFAULT_DASHBOARD_SETTINGS.techstackCatalog.entries[0]!;
  const selectedTechstackId = selection?.selectedTechstackId ?? null;
  const activeEntry = selectedTechstackId
    ? normalizedCatalog.entries.find((entry) => entry.id === selectedTechstackId) ?? defaultEntry
    : null;
  const orderedEntries = [
    defaultEntry,
    ...normalizedCatalog.entries.filter((entry) => entry.id !== defaultEntry.id),
  ];

  return {
    activeLabel: activeEntry?.label ?? "None",
    activeTechstackId: activeEntry?.id ?? "",
    selectedTechstackId,
    isUnassigned: selectedTechstackId === null,
    defaultLabel: defaultEntry.label,
    options: [
      {
        id: UNASSIGNED_OPTION_ID,
        label: "None",
        kind: "unassigned",
        techstackId: null,
      },
      ...orderedEntries.map((entry) => ({
        id: entry.id,
        label: entry.id === defaultEntry.id ? `${entry.label} (default)` : entry.label,
        kind: "catalog" as const,
        techstackId: entry.id,
      })),
    ],
  };
};
