import type { FunctionComponent } from "preact";
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { Boxes, CheckSquare, Layers, Loader2, MessageSquare, Palette, Search, Shapes } from "lucide-preact";
import type {
  ExternalImporterSettings,
  SprintLinkedIssueInput,
} from "../../types.js";
import {
  fetchProjectIssuePromptContexts,
  searchProjectIssues,
  type RemoteIssueSummary,
} from "../../lib/project-api.js";
import { fetchProjectEffectiveSettings } from "../../lib/settings-api.js";
import { MultiSelect } from "../ui/MultiSelect.js";
import {
  buildIssueImportCompactState,
  buildIssueImportMetadataRows,
  getIssueImportEmptyStateCopy,
  getIssueImportErrorCopy,
  getIssueImportProviderMetadata,
  getIssueImportSelectedResultCountLabel,
  truncateIssueImportAssignees,
  truncateIssueImportLabels,
  type IssueImportProvider,
} from "../../lib/issue-import-view-models.js";
import { IssueImportEmptyState } from "./importer/IssueImportEmptyState.js";
import { IssueImportIssueCard } from "./importer/IssueImportIssueCard.js";
import { IssueImportSummaryRail } from "./importer/IssueImportSummaryRail.js";
import {
  IssueImportField,
  IssueImportFilterSection,
  IssueImportMultiSelectField,
  IssueImportNumberInput,
  IssueImportTextInput,
} from "./importer/IssueImportFields.js";
import {
  IssueImportErrorPanel,
  IssueImportLoadingSkeletonList,
  IssueImportShell,
} from "./importer/IssueImportShell.js";

export type CanvasImportProvider = Extract<IssueImportProvider, "miro" | "lucid" | "figma" | "mural">;

interface SprintCanvasImportModalProps {
  projectId: string;
  provider: CanvasImportProvider;
  onClose: () => void;
  onImport: (issues: SprintLinkedIssueInput[]) => void | Promise<void>;
}

interface CanvasFilters {
  search: string;
  boardId: string;
  documentId: string;
  fileKey: string;
  workspaceId: string;
  muralId: string;
  itemTypes: string[];
  externalIds: string[];
  includeConversation: boolean;
  limit: number;
}

interface CanvasProviderConfig {
  provider: CanvasImportProvider;
  title: string;
  description: string;
  resultNounSingular: string;
  resultNounPlural: string;
  searchPlaceholder: string;
  supportsSearch: boolean;
  supportsBoardId: boolean;
  supportsDocumentId: boolean;
  supportsFileKey: boolean;
  supportsWorkspaceId: boolean;
  supportsMuralId: boolean;
  supportsItemTypes: boolean;
  supportsConversation: boolean;
  identifierHelp: string;
}

const DEFAULT_FILTERS: CanvasFilters = {
  search: "",
  boardId: "",
  documentId: "",
  fileKey: "",
  workspaceId: "",
  muralId: "",
  itemTypes: [],
  externalIds: [],
  includeConversation: false,
  limit: 40,
};

const PROVIDER_CONFIGS: Record<CanvasImportProvider, CanvasProviderConfig> = {
  miro: {
    provider: "miro",
    title: "Import Miro Canvas Scope",
    description: "Search readable Miro board items, select compact metadata cards, and attach them as read-only sprint linked scope.",
    resultNounSingular: "canvas item",
    resultNounPlural: "canvas items",
    searchPlaceholder: "Board title or team search text",
    supportsSearch: true,
    supportsBoardId: true,
    supportsDocumentId: false,
    supportsFileKey: false,
    supportsWorkspaceId: false,
    supportsMuralId: false,
    supportsItemTypes: true,
    supportsConversation: false,
    identifierHelp: "Paste a Miro board ID to import readable board items, or use search text to discover boards.",
  },
  lucid: {
    provider: "lucid",
    title: "Import Lucid Document Scope",
    description: "Search Lucidchart or Lucidspark documents, load readable contents, and attach selected documents to the sprint composer.",
    resultNounSingular: "document",
    resultNounPlural: "documents",
    searchPlaceholder: "Document title or folder search text",
    supportsSearch: true,
    supportsBoardId: false,
    supportsDocumentId: true,
    supportsFileKey: false,
    supportsWorkspaceId: false,
    supportsMuralId: false,
    supportsItemTypes: false,
    supportsConversation: false,
    identifierHelp: "Paste a Lucid document ID for an exact import, or use search text to discover readable documents.",
  },
  figma: {
    provider: "figma",
    title: "Import Figma / FigJam Scope",
    description: "Paste Figma file keys, optionally append file comments, and attach files as read-only sprint linked scope.",
    resultNounSingular: "file",
    resultNounPlural: "files",
    searchPlaceholder: "",
    supportsSearch: false,
    supportsBoardId: false,
    supportsDocumentId: false,
    supportsFileKey: true,
    supportsWorkspaceId: false,
    supportsMuralId: false,
    supportsItemTypes: false,
    supportsConversation: true,
    identifierHelp: "Paste a Figma or FigJam file key from the file URL before searching. General Figma file search is not available.",
  },
  mural: {
    provider: "mural",
    title: "Import Mural Canvas Scope",
    description: "Search workspace murals or fetch an exact mural ID, then attach limited read-only canvas metadata and readable content.",
    resultNounSingular: "mural",
    resultNounPlural: "murals",
    searchPlaceholder: "Mural title search text",
    supportsSearch: true,
    supportsBoardId: false,
    supportsDocumentId: false,
    supportsFileKey: false,
    supportsWorkspaceId: true,
    supportsMuralId: true,
    supportsItemTypes: false,
    supportsConversation: false,
    identifierHelp: "Paste a workspace ID to list murals or a mural ID for an exact import. Mural public API content can be limited.",
  },
};

export const SprintCanvasImportModal: FunctionComponent<SprintCanvasImportModalProps> = ({
  projectId,
  provider,
  onClose,
  onImport,
}) => {
  const config = PROVIDER_CONFIGS[provider];
  const providerMetadata = getIssueImportProviderMetadata(provider);
  const [filters, setFilters] = useState<CanvasFilters>(DEFAULT_FILTERS);
  const [initialFilters, setInitialFilters] = useState<CanvasFilters>(DEFAULT_FILTERS);
  const [results, setResults] = useState<RemoteIssueSummary[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [conversationDisabledKeys, setConversationDisabledKeys] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [advancedFiltersExpanded, setAdvancedFiltersExpanded] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const selectedResults = useMemo(
    () => results.filter((result) => selectedKeys.has(resultKey(result))),
    [results, selectedKeys],
  );
  const anySelected = selectedResults.length > 0;
  const allVisibleSelected = results.length > 0 && selectedResults.length === results.length;
  const allSelectedConversationEnabled = config.supportsConversation
    && anySelected
    && selectedResults.every((result) => !conversationDisabledKeys.has(resultKey(result)));
  const emptyCopy = getIssueImportEmptyStateCopy(provider, hasSearched);

  const runSearch = useCallback(async (query: CanvasFilters): Promise<void> => {
    const validationMessage = validateSearchTarget(config, query);
    if (validationMessage) {
      setError(validationMessage);
      setHasSearched(false);
      setResults([]);
      pruneSelectionToResults([]);
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);
    setHasSearched(true);
    try {
      const data = await searchProjectIssues(projectId, {
        provider,
        search: config.supportsSearch ? normalizeOptionalText(query.search) : undefined,
        boardId: config.supportsBoardId ? normalizeOptionalText(query.boardId) : undefined,
        documentId: config.supportsDocumentId ? normalizeOptionalText(query.documentId) : undefined,
        fileKey: config.supportsFileKey ? normalizeOptionalText(query.fileKey) : undefined,
        workspaceId: config.supportsWorkspaceId ? normalizeOptionalText(query.workspaceId) : undefined,
        muralId: config.supportsMuralId ? normalizeOptionalText(query.muralId) : undefined,
        itemTypes: config.supportsItemTypes ? query.itemTypes : [],
        externalIds: query.externalIds,
        includeConversation: config.supportsConversation ? query.includeConversation : undefined,
        limit: query.limit,
      }, controller.signal);
      setResults(data);
      pruneSelectionToResults(data);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        return;
      }
      const copy = getIssueImportErrorCopy(err, `${providerMetadata.label} search failed. Check Settings -> Integrations and try again.`);
      setError(copy.message);
      setResults([]);
      pruneSelectionToResults([]);
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
      setLoading(false);
    }
  }, [config, projectId, provider, providerMetadata.label]);

  useEffect(() => {
    let cancelled = false;
    const loadDefaults = async (): Promise<void> => {
      try {
        const effective = await fetchProjectEffectiveSettings(projectId);
        if (cancelled) {
          return;
        }
        const settings = effective.settings[provider] as ExternalImporterSettings;
        const nextFilters = filtersFromSettings(config, settings);
        setFilters(nextFilters);
        setInitialFilters(nextFilters);
        if (!validateSearchTarget(config, nextFilters)) {
          await runSearch(nextFilters);
        }
      } catch (err) {
        if (cancelled) {
          return;
        }
        const copy = getIssueImportErrorCopy(err, `Failed to load ${providerMetadata.label} defaults from Settings -> Integrations.`);
        setError(copy.message);
      }
    };
    void loadDefaults();
    return () => {
      cancelled = true;
      abortRef.current?.abort();
    };
  }, [config, projectId, provider, providerMetadata.label, runSearch]);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [onClose]);

  const updateFilters = useCallback((updater: (current: CanvasFilters) => CanvasFilters): void => {
    setFilters((current) => updater(current));
  }, []);

  const toggleResult = useCallback((result: RemoteIssueSummary): void => {
    const key = resultKey(result);
    setSelectedKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  const toggleConversation = useCallback((result: RemoteIssueSummary): void => {
    if (!config.supportsConversation) {
      return;
    }
    const key = resultKey(result);
    setConversationDisabledKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, [config.supportsConversation]);

  const selectAllVisible = useCallback((): void => {
    setSelectedKeys((current) => {
      if (allVisibleSelected) {
        const next = new Set(current);
        for (const result of results) {
          next.delete(resultKey(result));
        }
        return next;
      }
      const next = new Set(current);
      for (const result of results) {
        next.add(resultKey(result));
      }
      return next;
    });
  }, [allVisibleSelected, results]);

  const clearSelection = useCallback((): void => {
    setSelectedKeys(new Set());
    setConversationDisabledKeys(new Set());
  }, []);

  const setConversationForSelection = useCallback((enabled: boolean): void => {
    if (!config.supportsConversation) {
      return;
    }
    setConversationDisabledKeys((current) => {
      const next = new Set(current);
      for (const result of selectedResults) {
        const key = resultKey(result);
        if (enabled) {
          next.delete(key);
        } else {
          next.add(key);
        }
      }
      return next;
    });
  }, [config.supportsConversation, selectedResults]);

  const handleImport = useCallback(async (): Promise<void> => {
    if (selectedResults.length === 0) {
      return;
    }
    setImporting(true);
    setError(null);
    try {
      const contexts = await fetchProjectIssuePromptContexts(projectId, selectedResults.map((result) => ({
        ...result,
        externalId: result.externalId,
        sourceKind: result.sourceKind,
        sourceProvider: result.sourceProvider,
        includeConversation: config.supportsConversation && !conversationDisabledKeys.has(resultKey(result)),
      })));
      await onImport(contexts);
      onClose();
    } catch (err) {
      const copy = getIssueImportErrorCopy(err, `${providerMetadata.label} import failed. Try again after checking the selected canvas items.`);
      setError(copy.message);
    } finally {
      setImporting(false);
    }
  }, [config.supportsConversation, conversationDisabledKeys, onClose, onImport, projectId, providerMetadata.label, selectedResults]);

  const compactState = buildIssueImportCompactState({
    filters: [
      { id: "provider", label: "Provider", value: providerMetadata.label, alwaysShow: true, priority: 0 },
      { id: "board", label: "Board", value: filters.boardId, defaultValue: initialFilters.boardId, alwaysShow: config.supportsBoardId, priority: 1 },
      { id: "document", label: "Document", value: filters.documentId, defaultValue: initialFilters.documentId, alwaysShow: config.supportsDocumentId, priority: 2 },
      { id: "fileKey", label: "File", value: filters.fileKey, defaultValue: initialFilters.fileKey, alwaysShow: config.supportsFileKey, priority: 3 },
      { id: "workspace", label: "Workspace", value: filters.workspaceId, defaultValue: initialFilters.workspaceId, alwaysShow: config.supportsWorkspaceId, priority: 4 },
      { id: "mural", label: "Mural", value: filters.muralId, defaultValue: initialFilters.muralId, alwaysShow: config.supportsMuralId, priority: 5 },
      { id: "search", label: "Search", value: filters.search, priority: 6 },
      { id: "types", label: "Types", value: filters.itemTypes, priority: 7 },
      { id: "externalIds", label: "External IDs", value: filters.externalIds, priority: 8 },
      { id: "conversation", label: "Comments", value: filters.includeConversation, defaultValue: false, alwaysShow: config.supportsConversation, priority: 9 },
      { id: "limit", label: "Limit", value: filters.limit, defaultValue: initialFilters.limit, defaultLabel: `${initialFilters.limit} results`, alwaysShow: true, priority: 10 },
    ],
    selectedCount: selectedResults.length,
    visibleCount: results.length,
    totalCount: results.length,
    resultNounSingular: config.resultNounSingular,
    resultNounPlural: config.resultNounPlural,
  });

  const selectVisibleLabel = allVisibleSelected ? "Deselect all visible results" : "Select all visible results";
  const selectedCountLabel = getIssueImportSelectedResultCountLabel(
    selectedResults.length,
    results.length,
    results.length,
    config.resultNounSingular,
    config.resultNounPlural,
  );

  return (
    <IssueImportShell
      provider={providerMetadata}
      title={config.title}
      description={config.description}
      onClose={onClose}
      closeLabel={`Close ${providerMetadata.label} import`}
      activeFilterCountLabel={compactState.activeFilterCountLabel}
      summaryRail={(
        <IssueImportSummaryRail
          provider={providerMetadata}
          eyebrow="Canvas Browser"
          title={`${providerMetadata.label} linked scope`}
          description="Canvas imports are read-only. Code UX stores linked-source metadata and prompt context, but never mutates provider boards, documents, files, or murals."
          items={[
            { label: "Provider", value: providerMetadata.label },
            { label: "Target", value: getTargetSummary(config, filters) },
            { label: "Visible", value: String(results.length) },
            { label: "Selected", value: String(selectedResults.length), active: selectedResults.length > 0 },
            { label: "Limit", value: String(filters.limit) },
          ]}
          status={compactState.selectedCountLabel}
          footer={provider === "mural" ? (
            <div className="rounded-[1rem] border border-white/10 bg-white/[0.04] p-3 text-[10px] font-semibold leading-relaxed text-white/56">
              Mural public API support is limited; returned scope may include metadata only.
            </div>
          ) : undefined}
        />
      )}
      filters={(
        <div className="grid gap-4">
          <IssueImportFilterSection
            title={`${providerMetadata.label} search`}
            description={config.identifierHelp}
            compact
            action={(
              <button
                type="button"
                onClick={() => { void runSearch(filters); }}
                disabled={loading}
                className={`inline-flex min-h-11 min-w-32 items-center justify-center gap-2 rounded-[1rem] px-4 py-2.5 text-xs font-black uppercase tracking-[0.14em] transition-all hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-50 ${providerMetadata.accent.selectedIconClassName}`}
                aria-label={loading ? `Search ${providerMetadata.label} is loading` : `Search ${providerMetadata.label}`}
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Search className="h-4 w-4" aria-hidden="true" />}
                Search
              </button>
            )}
          >
            <div className="grid min-w-0 gap-3 lg:grid-cols-3">
              {config.supportsBoardId && (
                <IssueImportField label="Board ID" hint="Required unless search text is supplied." required>
                  <IssueImportTextInput
                    provider={providerMetadata}
                    value={filters.boardId}
                    onInput={(event) => updateFilters((current) => ({ ...current, boardId: (event.target as HTMLInputElement).value }))}
                    placeholder="miro-board-id"
                    aria-label="Miro board ID"
                  />
                </IssueImportField>
              )}
              {config.supportsDocumentId && (
                <IssueImportField label="Document ID" hint="Required unless search text or external IDs are supplied." required>
                  <IssueImportTextInput
                    provider={providerMetadata}
                    value={filters.documentId}
                    onInput={(event) => updateFilters((current) => ({ ...current, documentId: (event.target as HTMLInputElement).value }))}
                    placeholder="lucid-document-id"
                    aria-label="Lucid document ID"
                  />
                </IssueImportField>
              )}
              {config.supportsFileKey && (
                <IssueImportField label="File key" hint="Required unless exact file keys are added below." required>
                  <IssueImportTextInput
                    provider={providerMetadata}
                    value={filters.fileKey}
                    onInput={(event) => updateFilters((current) => ({ ...current, fileKey: (event.target as HTMLInputElement).value }))}
                    placeholder="figma-file-key"
                    aria-label="Figma file key"
                  />
                </IssueImportField>
              )}
              {config.supportsWorkspaceId && (
                <IssueImportField label="Workspace ID" hint="Required unless a mural ID is supplied." required>
                  <IssueImportTextInput
                    provider={providerMetadata}
                    value={filters.workspaceId}
                    onInput={(event) => updateFilters((current) => ({ ...current, workspaceId: (event.target as HTMLInputElement).value }))}
                    placeholder="mural-workspace-id"
                    aria-label="Mural workspace ID"
                  />
                </IssueImportField>
              )}
              {config.supportsMuralId && (
                <IssueImportField label="Mural ID" hint="Use for an exact mural import.">
                  <IssueImportTextInput
                    provider={providerMetadata}
                    value={filters.muralId}
                    onInput={(event) => updateFilters((current) => ({ ...current, muralId: (event.target as HTMLInputElement).value }))}
                    placeholder="mural-id"
                    aria-label="Mural ID"
                  />
                </IssueImportField>
              )}
              {config.supportsSearch && (
                <IssueImportField label="Search text">
                  <IssueImportTextInput
                    provider={providerMetadata}
                    value={filters.search}
                    onInput={(event) => updateFilters((current) => ({ ...current, search: (event.target as HTMLInputElement).value }))}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        void runSearch(filters);
                      }
                    }}
                    placeholder={config.searchPlaceholder}
                    aria-label={`${providerMetadata.label} search text`}
                  />
                </IssueImportField>
              )}
              <IssueImportField label="Limit" hint="Bounded to the shared issue search endpoint limit.">
                <IssueImportNumberInput
                  provider={providerMetadata}
                  min={1}
                  max={100}
                  value={filters.limit}
                  onInput={(event) => updateFilters((current) => ({
                    ...current,
                    limit: normalizeLimit((event.target as HTMLInputElement).value, current.limit),
                  }))}
                  aria-label={`${providerMetadata.label} result limit`}
                />
              </IssueImportField>
            </div>
          </IssueImportFilterSection>
        </div>
      )}
      advancedFilters={(
        <div className="grid gap-4">
          {config.supportsItemTypes && (
            <IssueImportFilterSection
              title="Readable item types"
              description="Optional Miro item type filters such as sticky_note, text, shape, or card."
              compact
            >
              <IssueImportMultiSelectField label="Item types">
                <MultiSelect
                  value={filters.itemTypes}
                  onChange={(itemTypes) => updateFilters((current) => ({ ...current, itemTypes }))}
                  placeholder="sticky_note, text"
                />
              </IssueImportMultiSelectField>
            </IssueImportFilterSection>
          )}
          <IssueImportFilterSection
            title="Exact external IDs"
            description="Use exact provider object IDs when search text is too broad or unavailable."
            compact
          >
            <IssueImportMultiSelectField label="External IDs">
              <MultiSelect
                value={filters.externalIds}
                onChange={(externalIds) => updateFilters((current) => ({ ...current, externalIds }))}
                placeholder={provider === "figma" ? "file-key-1, file-key-2" : "External object ID"}
              />
            </IssueImportMultiSelectField>
          </IssueImportFilterSection>
          {config.supportsConversation && (
            <IssueImportFilterSection
              title="Comment context"
              description="Figma/FigJam can append file comments when the token can read them."
              compact
            >
              <label className="inline-flex w-fit items-center gap-2 rounded-full border border-black/[0.06] bg-white px-3 py-2 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500 transition-colors hover:text-slate-900 dark:border-white/[0.08] dark:bg-white/[0.05] dark:text-slate-300 dark:hover:text-white">
                <input
                  type="checkbox"
                  checked={filters.includeConversation}
                  onChange={(event) => updateFilters((current) => ({ ...current, includeConversation: (event.target as HTMLInputElement).checked }))}
                  className="h-3.5 w-3.5 rounded border-slate-300 text-signal-500 focus:ring-signal-500 dark:border-white/[0.18] dark:bg-transparent"
                  aria-label="Append comments while searching Figma files"
                />
                <MessageSquare className="h-3.5 w-3.5" strokeWidth={2.1} aria-hidden="true" />
                Append comments
              </label>
            </IssueImportFilterSection>
          )}
        </div>
      )}
      advancedFiltersExpanded={advancedFiltersExpanded}
      advancedFiltersLabel={`Advanced ${providerMetadata.label} filters`}
      advancedFiltersId={`${provider}-canvas-import-advanced-filters`}
      onAdvancedFiltersToggle={() => setAdvancedFiltersExpanded((current) => !current)}
      resultStatus={(
        <div className="grid gap-3 rounded-[1.1rem] border border-black/[0.06] bg-white/70 p-3 dark:border-white/[0.06] dark:bg-white/[0.03]">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              <span className="font-black text-slate-700 dark:text-slate-200">{results.length}</span>{" "}
              visible {config.resultNounPlural}.
              {" "}
              <span className="font-black text-slate-700 dark:text-slate-200">{selectedResults.length}</span>{" "}
              selected.
            </div>
            <div className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">
              {compactState.activeFilterCountLabel}
            </div>
          </div>
          {provider === "mural" && (
            <div className="rounded-[0.9rem] border border-[#12B3A8]/20 bg-[#12B3A8]/10 px-3 py-2 text-xs font-semibold leading-relaxed text-[#0F766E] dark:text-[#67E8F9]">
              Mural public API support is limited; imported scope may include only metadata and readable content available to the token.
            </div>
          )}
          {compactState.chips.length > 0 && (
            <div className="flex flex-wrap gap-1.5" aria-label={`Active ${providerMetadata.label} filters`}>
              {compactState.chips.map((chip) => (
                <span
                  key={chip.id}
                  className={`inline-flex max-w-full items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-bold ring-1 ${
                    chip.active
                      ? providerMetadata.accent.badgeClassName
                      : "bg-black/[0.035] text-slate-500 ring-black/[0.05] dark:bg-white/[0.05] dark:text-slate-300 dark:ring-white/[0.06]"
                  }`}
                >
                  <span className="text-slate-400 dark:text-slate-500">{chip.label}</span>
                  <span className="truncate">{chip.value}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      )}
      footer={(
        <div className="flex flex-col gap-4 rounded-[1.4rem] border border-black/[0.06] bg-black/[0.015] p-4 dark:border-white/[0.06] dark:bg-white/[0.02]">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="text-xs font-semibold text-slate-400" aria-live="polite">
              <span className="font-bold text-slate-600 dark:text-slate-200">{selectedCountLabel}</span>{" "}
              Canvas imports are read-only linked scope.
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={selectAllVisible}
                disabled={results.length === 0 || loading}
                className="rounded-[1rem] border border-black/[0.06] px-4 py-2 text-sm font-semibold text-slate-600 transition-colors hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.08] dark:text-slate-300 dark:hover:text-white"
                aria-label={selectVisibleLabel}
              >
                {allVisibleSelected ? "Deselect visible" : "Select all visible"}
              </button>
              <button
                type="button"
                onClick={clearSelection}
                disabled={!anySelected}
                className="rounded-[1rem] border border-black/[0.06] px-4 py-2 text-sm font-semibold text-slate-600 transition-colors hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.08] dark:text-slate-300 dark:hover:text-white"
                aria-label={anySelected ? "Clear selection" : "Clear selection is disabled because no items are selected"}
              >
                Clear selection
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            {config.supportsConversation ? (
              <label className="inline-flex items-center gap-2 rounded-full border border-black/[0.06] bg-white px-3 py-2 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500 transition-colors hover:text-slate-900 dark:border-white/[0.08] dark:bg-white/[0.05] dark:text-slate-300 dark:hover:text-white">
                <input
                  type="checkbox"
                  checked={allSelectedConversationEnabled}
                  disabled={!anySelected}
                  onChange={(event) => setConversationForSelection((event.target as HTMLInputElement).checked)}
                  className="h-3.5 w-3.5 rounded border-slate-300 text-signal-500 focus:ring-signal-500 dark:border-white/[0.18] dark:bg-transparent"
                  aria-label={`Append comments to all selected ${providerMetadata.label} files`}
                />
                <MessageSquare className="h-3.5 w-3.5" strokeWidth={2.1} aria-hidden="true" />
                Append comments to selected
              </label>
            ) : (
              <div className="text-xs font-semibold leading-relaxed text-slate-400">
                This provider returns compact readable metadata only; live canvas previews and write actions are not available.
              </div>
            )}

            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={onClose}
                className={`rounded-[1rem] border border-black/[0.06] px-5 py-3 text-sm font-bold text-slate-500 transition-colors hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 ${providerMetadata.accent.focusRingClassName} dark:border-white/[0.08] dark:text-slate-300 dark:hover:text-white`}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => { void handleImport(); }}
                disabled={!anySelected || importing}
                className={`rounded-[1rem] px-5 py-3 text-sm font-semibold shadow-[0_12px_28px_rgba(15,23,42,0.12)] transition-all hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-50 ${providerMetadata.accent.selectedIconClassName}`}
                aria-label={!anySelected ? `Import ${providerMetadata.label} scope disabled until items are selected` : `Import selected ${providerMetadata.label} scope`}
              >
                {importing ? "Importing..." : "Import Selected"}
              </button>
            </div>
          </div>
        </div>
      )}
    >
      {error && <IssueImportErrorPanel error={getIssueImportErrorCopy(error)} />}

      {loading ? (
        <IssueImportLoadingSkeletonList count={6} />
      ) : hasSearched && results.length === 0 ? (
        <IssueImportEmptyState
          title={emptyCopy.title}
          description={emptyCopy.description}
          action={(
            <button
              type="button"
              onClick={() => { void runSearch(filters); }}
              className={`inline-flex min-h-10 items-center gap-2 rounded-full px-4 py-2 text-[10px] font-black uppercase tracking-[0.14em] transition-all hover:-translate-y-px ${providerMetadata.accent.selectedIconClassName}`}
            >
              <Search className="h-3.5 w-3.5" aria-hidden="true" />
              Search again
            </button>
          )}
        />
      ) : (
        <div className="grid gap-3">
          {results.map((result) => {
            const key = resultKey(result);
            const selected = selectedKeys.has(key);
            const conversationEnabled = !conversationDisabledKeys.has(key);
            return (
              <IssueImportIssueCard
                key={key}
                provider={providerMetadata}
                issueKey={result.issueKey || result.externalId || result.url}
                title={result.title}
                url={result.url}
                bodyPreview={result.bodyPreview}
                selected={selected}
                includeConversation={conversationEnabled}
                showConversationToggle={config.supportsConversation}
                conversationLabel="Append Comments"
                metadataRows={buildIssueImportMetadataRows({
                  provider,
                  sourceProvider: result.sourceProvider,
                  sourceKind: result.sourceKind,
                  externalId: result.externalId,
                  repository: result.repository,
                  projectKey: result.projectKey,
                  issueKey: result.issueKey,
                  issueNumber: result.issueNumber,
                  state: result.state,
                  issueType: result.issueType,
                  priority: result.issuePriority,
                  issueAuthor: result.issueAuthor,
                  issueReporter: result.issueReporter,
                  issueMilestone: result.issueMilestone,
                  issueCommentCount: result.issueCommentCount,
                  createdAt: result.createdAt,
                  updatedAt: result.updatedAt,
                })}
                labels={truncateIssueImportLabels(result.labels ?? [], 6)}
                assignees={truncateIssueImportAssignees(result.assignees ?? [], 4)}
                selectionLabel={selected ? "Selected" : "Click to select"}
                modeLabel="Read-only scope"
                icon={<ProviderResultIcon provider={provider} />}
                metadataLimit={selected ? 7 : 5}
                onToggle={() => toggleResult(result)}
                onToggleConversation={() => toggleConversation(result)}
              />
            );
          })}
        </div>
      )}
    </IssueImportShell>
  );

  function pruneSelectionToResults(nextResults: ReadonlyArray<RemoteIssueSummary>): void {
    const visibleKeys = new Set(nextResults.map((result) => resultKey(result)));
    setSelectedKeys((current) => new Set([...current].filter((key) => visibleKeys.has(key))));
    setConversationDisabledKeys((current) => new Set([...current].filter((key) => visibleKeys.has(key))));
  }
};

const ProviderResultIcon: FunctionComponent<{ provider: CanvasImportProvider }> = ({ provider }) => {
  if (provider === "miro") {
    return <Shapes className="h-4 w-4" strokeWidth={2.2} aria-hidden="true" />;
  }
  if (provider === "lucid") {
    return <Boxes className="h-4 w-4" strokeWidth={2.2} aria-hidden="true" />;
  }
  if (provider === "figma") {
    return <Palette className="h-4 w-4" strokeWidth={2.2} aria-hidden="true" />;
  }
  return <Layers className="h-4 w-4" strokeWidth={2.2} aria-hidden="true" />;
};

function filtersFromSettings(config: CanvasProviderConfig, settings: ExternalImporterSettings): CanvasFilters {
  const limit = Number.isFinite(settings.defaultSearchLimit)
    ? Math.max(1, Math.min(100, Math.trunc(settings.defaultSearchLimit)))
    : 40;
  return {
    ...DEFAULT_FILTERS,
    boardId: config.supportsBoardId ? settings.boardId || "" : "",
    documentId: config.supportsDocumentId ? settings.documentId || "" : "",
    fileKey: config.supportsFileKey ? settings.fileKey || "" : "",
    workspaceId: config.supportsWorkspaceId ? settings.workspaceId || "" : "",
    muralId: config.supportsMuralId ? settings.boardId || "" : "",
    includeConversation: false,
    limit,
  };
}

function validateSearchTarget(config: CanvasProviderConfig, filters: CanvasFilters): string | null {
  const hasSearch = Boolean(config.supportsSearch && normalizeOptionalText(filters.search));
  const hasExternalIds = filters.externalIds.length > 0;
  if (config.provider === "miro" && !normalizeOptionalText(filters.boardId) && !hasSearch) {
    return "Paste a Miro board ID or enter search text before searching.";
  }
  if (config.provider === "lucid" && !normalizeOptionalText(filters.documentId) && !hasSearch && !hasExternalIds) {
    return "Paste a Lucid document ID, enter search text, or add exact external IDs before searching.";
  }
  if (config.provider === "figma" && !normalizeOptionalText(filters.fileKey) && !hasExternalIds) {
    return "Paste a Figma or FigJam file key before searching.";
  }
  if (config.provider === "mural" && !normalizeOptionalText(filters.workspaceId) && !normalizeOptionalText(filters.muralId) && !hasExternalIds) {
    return "Paste a Mural workspace ID or mural ID before searching.";
  }
  return null;
}

function getTargetSummary(config: CanvasProviderConfig, filters: CanvasFilters): string {
  if (config.supportsBoardId && filters.boardId) return filters.boardId;
  if (config.supportsDocumentId && filters.documentId) return filters.documentId;
  if (config.supportsFileKey && filters.fileKey) return filters.fileKey;
  if (config.supportsMuralId && filters.muralId) return filters.muralId;
  if (config.supportsWorkspaceId && filters.workspaceId) return filters.workspaceId;
  if (filters.search) return filters.search;
  if (filters.externalIds.length > 0) return `${filters.externalIds.length} exact IDs`;
  return "Identifier required";
}

function normalizeOptionalText(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeLimit(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(100, Math.trunc(parsed))) : fallback;
}

function resultKey(result: RemoteIssueSummary): string {
  return [
    result.provider,
    result.sourceProvider || "",
    result.sourceKind || "",
    result.externalId || result.issueKey || "",
    result.hostDomain,
    result.repository,
    result.url,
  ].join("::");
}
