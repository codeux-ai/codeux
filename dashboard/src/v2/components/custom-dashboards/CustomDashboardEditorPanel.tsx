import type { ComponentChildren, FunctionComponent } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { AlertCircle, Database, FileCode2, KeyRound, Layers3, Palette, ScrollText, Undo2 } from "lucide-preact";
import { Button } from "../ui/Button.js";
import type {
  CustomDashboardDataSourceNodeGraph,
  CustomDashboardFileBundle,
  CustomDashboardFileBundleEntry,
  CustomDashboardJsonObject,
  CustomDashboardManifest,
} from "../../types.js";
import type { CustomDashboardDataCatalogResponse, CustomDashboardCatalogSource } from "../../lib/custom-dashboard-api.js";
import { parseJsonDraft, stableJsonStringify } from "../../lib/custom-dashboard-view-models.js";
import { useDashboardI18n } from "../../i18n/context.js";
import { customDashboardMessages } from "../../i18n/messages/custom-dashboards.js";

export type CustomDashboardEditorTab = "manifest" | "files" | "sources" | "styleguide" | "catalog" | "credentials";

export interface CustomDashboardDraftState {
  title: string;
  description: string;
  manifestText: string;
  fileBundleText: string;
  sourceGraphText: string;
  styleguideText: string;
}

export type CustomDashboardJsonDraftField = "manifestText" | "fileBundleText" | "sourceGraphText" | "styleguideText";
export type CustomDashboardDraftErrors = Partial<Record<CustomDashboardJsonDraftField, string>>;

export interface CustomDashboardEditorFocusRequest {
  field: CustomDashboardJsonDraftField;
  nonce: number;
}

interface CustomDashboardEditorPanelProps {
  dashboardId: string;
  draft: CustomDashboardDraftState;
  onDraftChange: (draft: CustomDashboardDraftState) => void;
  activeTab: CustomDashboardEditorTab;
  onActiveTabChange: (tab: CustomDashboardEditorTab) => void;
  selectedFilePath: string;
  onSelectedFilePathChange: (path: string) => void;
  catalog: CustomDashboardDataCatalogResponse | null;
  credentialPanel?: ComponentChildren;
  errors: CustomDashboardDraftErrors;
  focusRequest: CustomDashboardEditorFocusRequest | null;
  onValidateField: (field: CustomDashboardJsonDraftField, value?: string) => boolean;
}

const TAB_IDS: Record<CustomDashboardEditorTab, string> = {
  manifest: "custom-dashboard-editor-tab-manifest",
  files: "custom-dashboard-editor-tab-files",
  sources: "custom-dashboard-editor-tab-sources",
  styleguide: "custom-dashboard-editor-tab-styleguide",
  catalog: "custom-dashboard-editor-tab-catalog",
  credentials: "custom-dashboard-editor-tab-credentials",
};

const PANEL_IDS: Record<CustomDashboardEditorTab, string> = {
  manifest: "custom-dashboard-editor-panel-manifest",
  files: "custom-dashboard-editor-panel-files",
  sources: "custom-dashboard-editor-panel-sources",
  styleguide: "custom-dashboard-editor-panel-styleguide",
  catalog: "custom-dashboard-editor-panel-catalog",
  credentials: "custom-dashboard-editor-panel-credentials",
};

const FIELD_IDS: Record<CustomDashboardJsonDraftField, string> = {
  manifestText: "custom-dashboard-manifest-json",
  fileBundleText: "custom-dashboard-file-bundle-json",
  sourceGraphText: "custom-dashboard-source-graph-json",
  styleguideText: "custom-dashboard-styleguide-json",
};

const TAB_ERROR_FIELDS: Partial<Record<CustomDashboardEditorTab, CustomDashboardJsonDraftField>> = {
  manifest: "manifestText",
  files: "fileBundleText",
  sources: "sourceGraphText",
  styleguide: "styleguideText",
};

export const CustomDashboardEditorPanel: FunctionComponent<CustomDashboardEditorPanelProps> = ({
  dashboardId,
  draft,
  onDraftChange,
  activeTab,
  onActiveTabChange,
  selectedFilePath,
  onSelectedFilePathChange,
  catalog,
  credentialPanel,
  errors,
  focusRequest,
  onValidateField,
}) => {
  const { locale, translate } = useDashboardI18n();
  const tabs: Array<{ id: CustomDashboardEditorTab; label: string; icon: typeof ScrollText }> = [
    { id: "manifest", label: translate(customDashboardMessages, "manifestTab"), icon: ScrollText },
    { id: "files", label: translate(customDashboardMessages, "filesTab"), icon: FileCode2 },
    { id: "sources", label: translate(customDashboardMessages, "sourcesTab"), icon: Layers3 },
    { id: "styleguide", label: translate(customDashboardMessages, "styleguideTab"), icon: Palette },
    { id: "catalog", label: translate(customDashboardMessages, "catalogTab"), icon: Database },
  ];
  const parsedBundle = parseJsonDraft<CustomDashboardFileBundle>(
    draft.fileBundleText,
    translate(customDashboardMessages, "fileBundleFieldName"),
    locale,
  );
  const files = parsedBundle.ok && Array.isArray(parsedBundle.value.files) ? parsedBundle.value.files : [];
  const selectedFile = files.find((file) => file.path === selectedFilePath) ?? files[0] ?? null;
  const visibleTabs = credentialPanel
    ? [...tabs, { id: "credentials" as const, label: translate(customDashboardMessages, "credentialsTab"), icon: KeyRound }]
    : tabs;
  const effectiveActiveTab = activeTab === "credentials" && !credentialPanel ? "manifest" : activeTab;
  const tabRefs = useRef<Partial<Record<CustomDashboardEditorTab, HTMLButtonElement | null>>>({});
  const undoButtonRef = useRef<HTMLButtonElement>(null);
  const [removedFiles, setRemovedFiles] = useState<Array<{ file: CustomDashboardFileBundleEntry; index: number }>>([]);
  const removedFile = removedFiles[removedFiles.length - 1] ?? null;

  useEffect(() => {
    setRemovedFiles([]);
  }, [dashboardId]);

  useEffect(() => {
    if (activeTab === "credentials" && !credentialPanel) {
      onActiveTabChange("manifest");
    }
  }, [activeTab, credentialPanel, onActiveTabChange]);

  useEffect(() => {
    if (!focusRequest) {
      return;
    }
    const timeoutId = window.setTimeout(() => {
      document.getElementById(FIELD_IDS[focusRequest.field])?.focus({ preventScroll: true });
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [focusRequest]);

  const setDraftField = (field: keyof CustomDashboardDraftState, value: string) => {
    onDraftChange({ ...draft, [field]: value });
  };

  const requestTabChange = (tab: CustomDashboardEditorTab, focus = false): void => {
    const currentField = TAB_ERROR_FIELDS[effectiveActiveTab];
    if (currentField) {
      onValidateField(currentField);
    }
    onActiveTabChange(tab);
    if (focus) {
      window.setTimeout(() => tabRefs.current[tab]?.focus(), 0);
    }
  };

  const handleTabKeyDown = (event: KeyboardEvent, tab: CustomDashboardEditorTab): void => {
    const currentIndex = visibleTabs.findIndex((candidate) => candidate.id === tab);
    if (currentIndex < 0) {
      return;
    }
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = (currentIndex + 1) % visibleTabs.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex = (currentIndex - 1 + visibleTabs.length) % visibleTabs.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = visibleTabs.length - 1;
    }
    if (nextIndex === null) {
      return;
    }
    event.preventDefault();
    const nextTab = visibleTabs[nextIndex]?.id;
    if (nextTab) {
      requestTabChange(nextTab, true);
    }
  };

  const updateFileBundle = (nextFiles: CustomDashboardFileBundleEntry[]) => {
    const metadata = parsedBundle.ok ? parsedBundle.value.metadata : undefined;
    onDraftChange({
      ...draft,
      fileBundleText: stableJsonStringify({ files: nextFiles, ...(metadata ? { metadata } : {}) }),
    });
  };

  const updateSelectedFile = (patch: Partial<CustomDashboardFileBundleEntry>) => {
    if (!selectedFile) {
      return;
    }
    const nextFile = { ...selectedFile, ...patch };
    const nextFiles = files.map((file) => file.path === selectedFile.path ? nextFile : file);
    updateFileBundle(nextFiles);
    if (patch.path) {
      onSelectedFilePathChange(patch.path);
    }
  };

  const addFile = () => {
    const path = `src/custom-${files.length + 1}.tsx`;
    updateFileBundle([...files, { path, content: "export const value = null;\n", contentType: "text/typescript-jsx" }]);
    onSelectedFilePathChange(path);
  };

  const removeSelectedFile = () => {
    if (!selectedFile || files.length <= 1) {
      return;
    }
    const removedIndex = files.findIndex((file) => file.path === selectedFile.path);
    const nextFiles = files.filter((file) => file.path !== selectedFile.path);
    updateFileBundle(nextFiles);
    setRemovedFiles((current) => [...current, { file: selectedFile, index: removedIndex }]);
    onSelectedFilePathChange(nextFiles[Math.min(removedIndex, nextFiles.length - 1)]?.path ?? "");
    window.setTimeout(() => undoButtonRef.current?.focus(), 0);
  };

  const undoFileRemoval = (): void => {
    if (!removedFile) {
      return;
    }
    const nextFiles = [...files];
    nextFiles.splice(Math.min(removedFile.index, nextFiles.length), 0, removedFile.file);
    updateFileBundle(nextFiles);
    onSelectedFilePathChange(removedFile.file.path);
    setRemovedFiles((current) => current.slice(0, -1));
  };

  const addCatalogSource = (source: CustomDashboardCatalogSource) => {
    const parsedGraph = parseJsonDraft<CustomDashboardDataSourceNodeGraph>(
      draft.sourceGraphText,
      translate(customDashboardMessages, "sourceGraphFieldName"),
      locale,
    );
    if (!parsedGraph.ok) {
      onValidateField("sourceGraphText");
      onActiveTabChange("sources");
      return;
    }
    const exists = parsedGraph.value.nodes.some((node) => node.id === source.id);
    const nextGraph: CustomDashboardDataSourceNodeGraph = {
      ...parsedGraph.value,
      nodes: exists ? parsedGraph.value.nodes : [
        ...parsedGraph.value.nodes,
        { id: source.id, type: source.type, title: source.title, config: source.config as CustomDashboardJsonObject | undefined },
      ],
    };
    onDraftChange({ ...draft, sourceGraphText: stableJsonStringify(nextGraph) });
    onActiveTabChange("sources");
  };

  return (
    <section
      aria-label={translate(customDashboardMessages, "editorAriaLabel")}
      className="flex min-h-[34rem] min-w-0 flex-col rounded-[1.4rem] border border-black/[0.08] bg-white/70 p-4 shadow-[0_18px_52px_rgba(15,23,42,0.06)] backdrop-blur-xl dark:border-white/[0.08] dark:bg-white/[0.05]"
    >
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <label className="flex min-w-0 flex-col gap-1.5 text-xs font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
          {translate(customDashboardMessages, "titleField")}
          <input
            value={draft.title}
            onInput={(event) => setDraftField("title", event.currentTarget.value)}
            className="min-h-[2.75rem] rounded-[0.9rem] border border-black/[0.08] bg-white/80 px-3 text-sm font-semibold normal-case tracking-normal text-slate-900 outline-none focus:border-signal-500 focus:ring-2 focus:ring-signal-500/20 dark:border-white/[0.08] dark:bg-white/[0.06] dark:text-white"
          />
        </label>
        <label className="flex min-w-0 flex-col gap-1.5 text-xs font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
          {translate(customDashboardMessages, "descriptionField")}
          <input
            value={draft.description}
            onInput={(event) => setDraftField("description", event.currentTarget.value)}
            className="min-h-[2.75rem] rounded-[0.9rem] border border-black/[0.08] bg-white/80 px-3 text-sm font-medium normal-case tracking-normal text-slate-900 outline-none focus:border-signal-500 focus:ring-2 focus:ring-signal-500/20 dark:border-white/[0.08] dark:bg-white/[0.06] dark:text-white"
          />
        </label>
      </div>

      <div className="mt-4 flex min-w-0 gap-2 overflow-x-auto pb-1" role="tablist" aria-label={translate(customDashboardMessages, "draftSectionsAriaLabel")}>
        {visibleTabs.map((tab) => {
          const Icon = tab.icon;
          const selected = effectiveActiveTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={TAB_IDS[tab.id]}
              ref={(element) => { tabRefs.current[tab.id] = element; }}
              aria-selected={selected}
              aria-controls={PANEL_IDS[tab.id]}
              aria-label={errors[TAB_ERROR_FIELDS[tab.id] ?? "manifestText"] && TAB_ERROR_FIELDS[tab.id]
                ? translate(customDashboardMessages, "tabContainsErrors", { label: tab.label })
                : undefined}
              tabIndex={selected ? 0 : -1}
              onClick={() => requestTabChange(tab.id)}
              onKeyDown={(event) => handleTabKeyDown(event, tab.id)}
              className={`inline-flex min-h-[2.5rem] shrink-0 items-center gap-2 rounded-[0.9rem] px-3 text-sm font-bold transition-colors motion-reduce:transition-none focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/60 ${
                selected
                  ? "bg-signal-500 text-void-900"
                  : "bg-slate-900/[0.04] text-slate-600 hover:bg-slate-900/[0.08] dark:bg-white/[0.05] dark:text-slate-300 dark:hover:bg-white/[0.08]"
              }`}
            >
              <Icon aria-hidden="true" className="h-4 w-4" />
              {tab.label}
              {TAB_ERROR_FIELDS[tab.id] && errors[TAB_ERROR_FIELDS[tab.id]!] ? (
                <AlertCircle aria-hidden="true" className="h-3.5 w-3.5 text-status-red" />
              ) : null}
            </button>
          );
        })}
      </div>

      <div
        key={effectiveActiveTab}
        id={PANEL_IDS[effectiveActiveTab]}
        role="tabpanel"
        aria-labelledby={TAB_IDS[effectiveActiveTab]}
        tabIndex={0}
        data-panel-transition="instant"
        className="mt-4 min-h-0 flex-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/60 motion-reduce:transition-none"
      >
        {effectiveActiveTab === "manifest" ? (
          <JsonTextarea
            id={FIELD_IDS.manifestText}
            label={translate(customDashboardMessages, "manifestJson")}
            value={draft.manifestText}
            onInput={(value) => setDraftField("manifestText", value)}
            onBlur={(value) => onValidateField("manifestText", value)}
            error={errors.manifestText}
            rows={18}
          />
        ) : null}

        {effectiveActiveTab === "files" ? (
          <div className="grid min-h-0 gap-3 lg:grid-cols-[minmax(11rem,0.45fr)_minmax(0,1fr)]">
            <div className="flex min-h-[16rem] flex-col gap-2 rounded-[1rem] border border-black/[0.06] bg-slate-900/[0.03] p-2 dark:border-white/[0.06] dark:bg-white/[0.03]">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">{translate(customDashboardMessages, "bundle")}</span>
                <Button size="sm" variant="ghost" onClick={addFile}>{translate(customDashboardMessages, "add")}</Button>
              </div>
              {removedFile ? (
                <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-[0.8rem] border border-signal-500/25 bg-signal-500/[0.07] px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200">
                  <span>{translate(customDashboardMessages, "fileRemoved", { path: removedFile.file.path })}</span>
                  <button
                    ref={undoButtonRef}
                    type="button"
                    onClick={undoFileRemoval}
                    className="inline-flex min-h-9 items-center gap-2 rounded-[0.75rem] px-3 font-bold text-signal-700 hover:bg-signal-500/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/60 dark:text-signal-300"
                  >
                    <Undo2 aria-hidden="true" className="h-4 w-4" />
                    {translate(customDashboardMessages, "undoRemove")}
                  </button>
                </div>
              ) : null}
              <div className="flex flex-col gap-1 overflow-y-auto">
                {files.map((file) => (
                  <button
                    key={file.path}
                    type="button"
                    aria-pressed={file.path === selectedFile?.path}
                    onClick={() => onSelectedFilePathChange(file.path)}
                    className={`min-h-[2.25rem] rounded-[0.7rem] px-2 text-left text-xs font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/60 ${
                      file.path === selectedFile?.path
                        ? "bg-signal-500/15 text-signal-700 dark:text-signal-300"
                        : "text-slate-600 hover:bg-white/70 dark:text-slate-300 dark:hover:bg-white/[0.06]"
                    }`}
                  >
                    <span className="block truncate">{file.path}</span>
                  </button>
                ))}
              </div>
            </div>
            {selectedFile ? (
              <div className="flex min-w-0 flex-col gap-3">
                <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                  <input
                    aria-label={translate(customDashboardMessages, "selectedFilePath")}
                    value={selectedFile.path}
                    onInput={(event) => updateSelectedFile({ path: event.currentTarget.value })}
                    className="min-h-[2.5rem] min-w-0 rounded-[0.85rem] border border-black/[0.08] bg-white/80 px-3 text-sm font-semibold text-slate-900 outline-none focus:border-signal-500 focus:ring-2 focus:ring-signal-500/20 dark:border-white/[0.08] dark:bg-white/[0.06] dark:text-white"
                  />
                  <Button size="sm" variant="danger" disabled={files.length <= 1} onClick={removeSelectedFile}>
                    {translate(customDashboardMessages, "remove")}
                  </Button>
                </div>
                <textarea
                  aria-label={translate(customDashboardMessages, "selectedFileContent")}
                  value={selectedFile.content}
                  rows={18}
                  spellcheck={false}
                  onInput={(event) => updateSelectedFile({ content: event.currentTarget.value })}
                  className="min-h-[26rem] w-full resize-y rounded-[1rem] border border-black/[0.08] bg-slate-950 px-3 py-3 font-mono text-xs leading-relaxed text-slate-100 outline-none focus:border-signal-500 focus:ring-2 focus:ring-signal-500/20"
                />
              </div>
            ) : (
              <JsonTextarea
                id={FIELD_IDS.fileBundleText}
                label={translate(customDashboardMessages, "fileBundleJson")}
                value={draft.fileBundleText}
                onInput={(value) => setDraftField("fileBundleText", value)}
                onBlur={(value) => onValidateField("fileBundleText", value)}
                error={errors.fileBundleText}
                rows={18}
              />
            )}
          </div>
        ) : null}

        {effectiveActiveTab === "sources" ? (
          <JsonTextarea
            id={FIELD_IDS.sourceGraphText}
            label={translate(customDashboardMessages, "sourceGraphJson")}
            value={draft.sourceGraphText}
            onInput={(value) => setDraftField("sourceGraphText", value)}
            onBlur={(value) => onValidateField("sourceGraphText", value)}
            error={errors.sourceGraphText}
            rows={18}
          />
        ) : null}

        {effectiveActiveTab === "styleguide" ? (
          <JsonTextarea
            id={FIELD_IDS.styleguideText}
            label={translate(customDashboardMessages, "styleguideJson")}
            value={draft.styleguideText}
            onInput={(value) => setDraftField("styleguideText", value)}
            onBlur={(value) => onValidateField("styleguideText", value)}
            error={errors.styleguideText}
            rows={18}
          />
        ) : null}

        {effectiveActiveTab === "catalog" ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {(catalog?.sources ?? []).map((source) => (
              <article key={`${source.dashboardId}:${source.id}`} className="rounded-[1rem] border border-black/[0.08] bg-white/70 p-3 dark:border-white/[0.08] dark:bg-white/[0.04]">
                <div className="min-w-0">
                  <h3 className="truncate text-sm font-bold text-slate-900 dark:text-white">{source.title}</h3>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    {translate(customDashboardMessages, "catalogSourceOrigin", { type: source.type, dashboardTitle: source.dashboardTitle })}
                  </p>
                </div>
                <Button className="mt-3 w-full" size="sm" variant="secondary" onClick={() => addCatalogSource(source)}>
                  {translate(customDashboardMessages, "addToGraph")}
                </Button>
              </article>
            ))}
            {(!catalog || catalog.sources.length === 0) ? (
              <div className="rounded-[1rem] border border-dashed border-black/[0.12] p-6 text-sm text-slate-500 dark:border-white/[0.12] dark:text-slate-400">
                {translate(customDashboardMessages, "noCatalogSources")}
              </div>
            ) : null}
          </div>
        ) : null}

        {effectiveActiveTab === "credentials" ? credentialPanel : null}
      </div>
    </section>
  );
};

const JsonTextarea: FunctionComponent<{
  id: string;
  label: string;
  value: string;
  rows: number;
  onInput: (value: string) => void;
  onBlur: (value: string) => void;
  error?: string;
}> = ({ id, label, value, rows, onInput, onBlur, error }) => (
  <div className="flex min-h-0 flex-col gap-2 text-xs font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
    <label htmlFor={id}>{label}</label>
    <textarea
      id={id}
      value={value}
      rows={rows}
      spellcheck={false}
      onInput={(event) => onInput(event.currentTarget.value)}
      onBlur={(event) => onBlur(event.currentTarget.value)}
      aria-invalid={error ? "true" : undefined}
      aria-errormessage={error ? `${id}-error` : undefined}
      className={`min-h-[28rem] w-full resize-y overflow-auto rounded-[1rem] border bg-slate-950 px-3 py-3 font-mono text-xs leading-relaxed text-slate-100 outline-none focus:ring-2 ${
        error
          ? "border-status-red/70 focus:border-status-red focus:ring-status-red/20"
          : "border-black/[0.08] focus:border-signal-500 focus:ring-signal-500/20"
      }`}
    />
    {error ? (
      <span id={`${id}-error`} role="alert" className="normal-case tracking-normal text-status-red">
        {error}
      </span>
    ) : null}
  </div>
);
