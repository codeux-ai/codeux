import type { FunctionComponent } from "preact";
import { useState } from "preact/hooks";
import { Database, FileCode2, KeyRound, Layers3, Map, Plus, ScrollText, Settings2, Trash2 } from "lucide-preact";
import type { AutomationCredentialMetadata } from "../../../../../src/contracts/automation-credential-types.js";
import { Button } from "../ui/Button.js";
import type {
  CustomDashboardCredentialSlot,
  CustomDashboardDataSourceNodeGraph,
  CustomDashboardFileBundle,
  CustomDashboardFileBundleEntry,
  CustomDashboardJsonObject,
  CustomDashboardManifest,
  CustomDashboardRouteDefinition,
} from "../../types.js";
import type { CustomDashboardDataCatalogResponse, CustomDashboardCatalogSource } from "../../lib/custom-dashboard-api.js";
import { parseJsonDraft, stableJsonStringify } from "../../lib/custom-dashboard-view-models.js";

export type CustomDashboardEditorTab = "manifest" | "routes" | "files" | "sources" | "credentials" | "catalog" | "advanced";

export interface CustomDashboardDraftState {
  title: string;
  description: string;
  manifestText: string;
  fileBundleText: string;
  sourceGraphText: string;
  routesText: string;
  credentialBindingsText: string;
  styleguideText: string;
}

interface CustomDashboardEditorPanelProps {
  draft: CustomDashboardDraftState;
  onDraftChange: (draft: CustomDashboardDraftState) => void;
  activeTab: CustomDashboardEditorTab;
  onActiveTabChange: (tab: CustomDashboardEditorTab) => void;
  selectedFilePath: string;
  onSelectedFilePathChange: (path: string) => void;
  catalog: CustomDashboardDataCatalogResponse | null;
  credentials: AutomationCredentialMetadata[];
  credentialsLoading?: boolean;
  onRotateCredential: (credentialId: string, value: string) => Promise<void>;
  onRevokeCredential: (credentialId: string) => Promise<boolean>;
}

const tabs: Array<{ id: CustomDashboardEditorTab; label: string; icon: typeof ScrollText }> = [
  { id: "manifest", label: "Manifest", icon: ScrollText },
  { id: "routes", label: "Routes", icon: Map },
  { id: "files", label: "Files", icon: FileCode2 },
  { id: "sources", label: "Sources", icon: Layers3 },
  { id: "credentials", label: "Credentials", icon: KeyRound },
  { id: "catalog", label: "Catalog", icon: Database },
  { id: "advanced", label: "Advanced JSON", icon: Settings2 },
];

export const CustomDashboardEditorPanel: FunctionComponent<CustomDashboardEditorPanelProps> = ({
  draft, onDraftChange, activeTab, onActiveTabChange, selectedFilePath, onSelectedFilePathChange,
  catalog, credentials, credentialsLoading = false, onRotateCredential, onRevokeCredential,
}) => {
  const parsedBundle = parseJsonDraft<CustomDashboardFileBundle>(draft.fileBundleText, "File bundle");
  const files = parsedBundle.ok && Array.isArray(parsedBundle.value.files) ? parsedBundle.value.files : [];
  const selectedFile = files.find((file) => file.path === selectedFilePath) ?? files[0] ?? null;
  const parsedManifest = parseJsonDraft<CustomDashboardManifest>(draft.manifestText, "Manifest");
  const manifest = parsedManifest.ok ? parsedManifest.value : null;
  const parsedRoutes = parseJsonDraft<CustomDashboardRouteDefinition[]>(draft.routesText, "Routes");
  const routes = parsedRoutes.ok && Array.isArray(parsedRoutes.value) ? parsedRoutes.value : [];
  const parsedGraph = parseJsonDraft<CustomDashboardDataSourceNodeGraph>(draft.sourceGraphText, "Source graph");
  const graph = parsedGraph.ok ? parsedGraph.value : null;
  const parsedBindings = parseJsonDraft<Array<{ slot: string; credentialId: string }>>(draft.credentialBindingsText, "Credential bindings");
  const bindings = parsedBindings.ok && Array.isArray(parsedBindings.value) ? parsedBindings.value : [];

  const setDraftField = (field: keyof CustomDashboardDraftState, value: string): void => onDraftChange({ ...draft, [field]: value });
  const updateManifest = (patch: Partial<CustomDashboardManifest>): void => {
    if (manifest) onDraftChange({ ...draft, manifestText: stableJsonStringify({ ...manifest, ...patch }) });
  };
  const updateRoutes = (next: CustomDashboardRouteDefinition[]): void => onDraftChange({ ...draft, routesText: stableJsonStringify(next) });
  const updateGraph = (next: CustomDashboardDataSourceNodeGraph): void => onDraftChange({ ...draft, sourceGraphText: stableJsonStringify(next) });
  const updateBindings = (next: Array<{ slot: string; credentialId: string }>): void => onDraftChange({ ...draft, credentialBindingsText: stableJsonStringify(next) });
  const updateFileBundle = (nextFiles: CustomDashboardFileBundleEntry[]): void => onDraftChange({
    ...draft,
    fileBundleText: stableJsonStringify({ files: nextFiles, ...(parsedBundle.ok && parsedBundle.value.metadata ? { metadata: parsedBundle.value.metadata } : {}) }),
  });
  const updateSelectedFile = (patch: Partial<CustomDashboardFileBundleEntry>): void => {
    if (!selectedFile) return;
    updateFileBundle(files.map((file) => file.path === selectedFile.path ? { ...file, ...patch } : file));
    if (patch.path) onSelectedFilePathChange(patch.path);
  };
  const addCatalogSource = (source: CustomDashboardCatalogSource): void => {
    if (!graph || graph.nodes.some((node) => node.id === source.id)) return;
    updateGraph({ ...graph, nodes: [...graph.nodes, { id: source.id, type: source.type, title: source.title, config: source.config as CustomDashboardJsonObject | undefined }] });
    onActiveTabChange("sources");
  };

  return (
    <section aria-label="Custom dashboard editor" className="flex min-h-[34rem] min-w-0 flex-col rounded-[1.4rem] border border-black/[0.08] bg-white/70 p-4 shadow-[0_18px_52px_rgba(15,23,42,0.06)] backdrop-blur-xl dark:border-white/[0.08] dark:bg-white/[0.05]">
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <TypedInput label="Title" value={draft.title} onInput={(value) => setDraftField("title", value)} />
        <TypedInput label="Description" value={draft.description} onInput={(value) => setDraftField("description", value)} />
      </div>
      <div className="mt-4 flex min-w-0 gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Custom dashboard draft sections">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const selected = activeTab === tab.id;
          return <button key={tab.id} type="button" role="tab" aria-selected={selected} onClick={() => onActiveTabChange(tab.id)} className={`inline-flex min-h-[2.5rem] shrink-0 items-center gap-2 rounded-[0.9rem] px-3 text-sm font-bold focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/60 ${selected ? "bg-signal-500 text-void-900" : "bg-slate-900/[0.04] text-slate-600 hover:bg-slate-900/[0.08] dark:bg-white/[0.05] dark:text-slate-300"}`}><Icon aria-hidden="true" className="h-4 w-4" />{tab.label}</button>;
        })}
      </div>

      <div className="mt-4 min-h-0 flex-1">
        {activeTab === "manifest" ? manifest ? (
          <div className="grid gap-4 md:grid-cols-2">
            <TypedInput label="App title" value={manifest.title} onInput={(title) => updateManifest({ title })} />
            <TypedInput label="Entry file" value={manifest.entryFile} mono onInput={(entryFile) => updateManifest({ entryFile })} />
            <TypedInput label="Schema version" value={String(manifest.schemaVersion)} inputMode="numeric" onInput={(value) => updateManifest({ schemaVersion: Math.max(1, Number(value) || 1) })} />
            <TypedInput label="App description" value={manifest.description ?? ""} onInput={(description) => updateManifest({ description })} />
            <label className="md:col-span-2 flex flex-col gap-2 text-xs font-bold uppercase tracking-[0.14em] text-slate-500">Declared files<select multiple onChange={(event) => updateManifest({ filePaths: Array.from(event.currentTarget.selectedOptions).map((option) => option.value) })} className="min-h-40 rounded-[1rem] border border-black/[0.08] bg-white/80 p-3 font-mono text-xs normal-case tracking-normal dark:border-white/[0.08] dark:bg-white/[0.06]">{files.map((file) => <option key={file.path} value={file.path} selected={manifest.filePaths.includes(file.path)}>{file.path}</option>)}</select></label>
          </div>
        ) : <InlineJsonError message={parsedManifest.ok ? "Manifest must be an object." : parsedManifest.message} onOpenAdvanced={() => onActiveTabChange("advanced")} /> : null}

        {activeTab === "routes" ? <div className="space-y-3">
          <div className="flex items-center justify-between gap-3"><p className="text-sm text-slate-500">Local paths become route controls and shareable deep links.</p><Button size="sm" icon={Plus} onClick={() => updateRoutes([...routes, { path: `/page-${routes.length + 1}`, label: `Page ${routes.length + 1}`, entryFile: manifest?.entryFile ?? files[0]?.path ?? "src/dashboard.tsx" }])}>Add route</Button></div>
          {routes.map((route, index) => <div key={`${route.path}:${index}`} className="grid gap-2 rounded-[1rem] border border-black/[0.08] p-3 sm:grid-cols-[1fr_1fr_1.2fr_auto] dark:border-white/[0.08]">
            <TypedInput label="Path" value={route.path} mono onInput={(path) => updateRoutes(routes.map((item, i) => i === index ? { ...item, path } : item))} />
            <TypedInput label="Label" value={route.label} onInput={(label) => updateRoutes(routes.map((item, i) => i === index ? { ...item, label } : item))} />
            <label className="flex flex-col gap-1.5 text-xs font-bold uppercase tracking-[0.12em] text-slate-500">Entry file<select value={route.entryFile} onChange={(event) => updateRoutes(routes.map((item, i) => i === index ? { ...item, entryFile: event.currentTarget.value } : item))} className="min-h-[2.6rem] rounded-[0.8rem] border border-black/[0.08] bg-white/80 px-2 font-mono text-xs normal-case tracking-normal dark:border-white/[0.08] dark:bg-white/[0.06]">{files.map((file) => <option key={file.path} value={file.path}>{file.path}</option>)}</select></label>
            <Button className="self-end" size="sm" variant="danger" icon={Trash2} aria-label={`Remove route ${route.label}`} onClick={() => updateRoutes(routes.filter((_, i) => i !== index))}>Remove</Button>
          </div>)}
          {routes.length === 0 ? <EmptyEditorState>No subpages declared. The viewer will use the root route.</EmptyEditorState> : null}
        </div> : null}

        {activeTab === "files" ? <div className="grid min-h-0 gap-3 lg:grid-cols-[minmax(11rem,0.45fr)_minmax(0,1fr)]">
          <div className="flex min-h-[16rem] flex-col gap-2 rounded-[1rem] border border-black/[0.06] bg-slate-900/[0.03] p-2 dark:border-white/[0.06] dark:bg-white/[0.03]">
            <div className="flex items-center justify-between"><span className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">Bundle</span><Button size="sm" variant="ghost" onClick={() => { const path = `src/custom-${files.length + 1}.tsx`; updateFileBundle([...files, { path, content: "export const value = null;\n", contentType: "text/typescript-jsx" }]); onSelectedFilePathChange(path); }}>Add</Button></div>
            <div className="flex flex-col gap-1 overflow-y-auto">{files.map((file) => <button key={file.path} type="button" aria-pressed={file.path === selectedFile?.path} onClick={() => onSelectedFilePathChange(file.path)} className={`min-h-[2.25rem] rounded-[0.7rem] px-2 text-left text-xs font-semibold focus-visible:ring-2 focus-visible:ring-signal-500 ${file.path === selectedFile?.path ? "bg-signal-500/15 text-signal-700 dark:text-signal-300" : "text-slate-600 dark:text-slate-300"}`}><span className="block truncate">{file.path}</span></button>)}</div>
          </div>
          {selectedFile ? <div className="flex min-w-0 flex-col gap-3"><div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(10rem,0.45fr)_auto]"><TypedInput label="Selected file path" value={selectedFile.path} mono onInput={(path) => updateSelectedFile({ path })} /><label className="flex flex-col gap-1.5 text-xs font-bold uppercase tracking-[0.12em] text-slate-500">Content type<select aria-label="Selected file content type" value={selectedFile.contentType ?? "text/typescript-jsx"} onChange={(event) => updateSelectedFile({ contentType: event.currentTarget.value })} className="min-h-[2.6rem] rounded-[0.8rem] border border-black/[0.08] bg-white/80 px-2 text-sm normal-case tracking-normal dark:border-white/[0.08] dark:bg-white/[0.06]"><option value="text/typescript-jsx">TypeScript JSX</option><option value="text/typescript">TypeScript</option><option value="text/css">CSS</option><option value="text/html">HTML (legacy)</option><option value="text/javascript">Browser JavaScript (legacy)</option></select></label><Button className="self-end" size="sm" variant="danger" disabled={files.length <= 1} onClick={() => { const next = files.filter((file) => file.path !== selectedFile.path); updateFileBundle(next); onSelectedFilePathChange(next[0]?.path ?? ""); }}>Remove</Button></div><textarea aria-label="Selected file content" value={selectedFile.content} rows={18} spellcheck={false} onInput={(event) => updateSelectedFile({ content: event.currentTarget.value })} className="min-h-[26rem] max-w-full resize-y overflow-auto rounded-[1rem] border border-black/[0.08] bg-slate-950 p-3 font-mono text-xs leading-relaxed text-slate-100 focus:ring-2 focus:ring-signal-500" /></div> : <EmptyEditorState>Add a file to begin editing.</EmptyEditorState>}
        </div> : null}

        {activeTab === "sources" ? graph ? <div className="space-y-3">
          <div className="flex justify-end"><Button size="sm" icon={Plus} onClick={() => updateGraph({ ...graph, nodes: [...graph.nodes, { id: `source-${graph.nodes.length + 1}`, type: "stats", title: `Source ${graph.nodes.length + 1}` }] })}>Add source</Button></div>
          {graph.nodes.map((node, index) => <div key={`${node.id}:${index}`} className="grid gap-3 rounded-[1rem] border border-black/[0.08] p-3 sm:grid-cols-3 dark:border-white/[0.08]">
            <TypedInput label="Source ID" value={node.id} mono onInput={(id) => updateGraph({ ...graph, nodes: graph.nodes.map((item, i) => i === index ? { ...item, id } : item) })} />
            <label className="flex flex-col gap-1.5 text-xs font-bold uppercase tracking-[0.12em] text-slate-500">Type<select value={node.type} onChange={(event) => updateGraph({ ...graph, nodes: graph.nodes.map((item, i) => i === index ? { ...item, type: event.currentTarget.value } : item) })} className="min-h-[2.6rem] rounded-[0.8rem] border border-black/[0.08] bg-white/80 px-2 text-sm normal-case tracking-normal dark:border-white/[0.08] dark:bg-white/[0.06]"><option value="project_dashboard_data">Project data</option><option value="stats">Stats</option><option value="telemetry">Telemetry</option><option value="integrations_metadata">Integration metadata</option><option value="external_api">External API</option></select></label>
            <TypedInput label="Title" value={node.title} onInput={(title) => updateGraph({ ...graph, nodes: graph.nodes.map((item, i) => i === index ? { ...item, title } : item) })} />
            <div className="sm:col-span-3 space-y-2 rounded-[0.8rem] bg-slate-900/[0.03] p-2 dark:bg-white/[0.03]">
              <div className="flex items-center justify-between gap-2"><span className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">Credential slots</span><Button size="sm" variant="ghost" onClick={() => updateGraph({ ...graph, nodes: graph.nodes.map((item, i) => i === index ? { ...item, credentialSlots: [...(item.credentialSlots ?? []), { slot: `credential_${(item.credentialSlots?.length ?? 0) + 1}`, label: "Credential", required: true, allowedKinds: ["api-token"], requiredCapability: "read" }] } : item) })}>Add slot</Button></div>
              {(node.credentialSlots ?? []).map((slot, slotIndex) => <div key={`${slot.slot}:${slotIndex}`} className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_1fr_auto]">
                <TypedInput label="Slot" value={slot.slot} mono onInput={(value) => updateGraph({ ...graph, nodes: graph.nodes.map((item, i) => i === index ? { ...item, credentialSlots: (item.credentialSlots ?? []).map((entry, j) => j === slotIndex ? { ...entry, slot: value } : entry) } : item) })} />
                <TypedInput label="Label" value={slot.label} onInput={(value) => updateGraph({ ...graph, nodes: graph.nodes.map((item, i) => i === index ? { ...item, credentialSlots: (item.credentialSlots ?? []).map((entry, j) => j === slotIndex ? { ...entry, label: value } : entry) } : item) })} />
                <TypedInput label="Allowed kinds" value={slot.allowedKinds.join(", ")} onInput={(value) => updateGraph({ ...graph, nodes: graph.nodes.map((item, i) => i === index ? { ...item, credentialSlots: (item.credentialSlots ?? []).map((entry, j) => j === slotIndex ? { ...entry, allowedKinds: value.split(",").map((kind) => kind.trim()).filter(Boolean) } : entry) } : item) })} />
                <TypedInput label="Capability" value={slot.requiredCapability} onInput={(value) => updateGraph({ ...graph, nodes: graph.nodes.map((item, i) => i === index ? { ...item, credentialSlots: (item.credentialSlots ?? []).map((entry, j) => j === slotIndex ? { ...entry, requiredCapability: value } : entry) } : item) })} />
                <Button className="self-end" size="sm" variant="danger" aria-label={`Remove credential slot ${slot.label}`} onClick={() => updateGraph({ ...graph, nodes: graph.nodes.map((item, i) => i === index ? { ...item, credentialSlots: (item.credentialSlots ?? []).filter((_, j) => j !== slotIndex) } : item) })}>Remove</Button>
              </div>)}
            </div>
            <div className="sm:col-span-3 flex justify-end"><Button size="sm" variant="danger" icon={Trash2} onClick={() => updateGraph({ ...graph, nodes: graph.nodes.filter((_, i) => i !== index), edges: graph.edges.filter((edge) => edge.fromNodeId !== node.id && edge.toNodeId !== node.id) })}>Remove source</Button></div>
          </div>)}
          {graph.nodes.length === 0 ? <EmptyEditorState>No sources declared. Add a typed source or choose one from the catalog.</EmptyEditorState> : null}
        </div> : <InlineJsonError message={parsedGraph.ok ? "Source graph must be an object." : parsedGraph.message} onOpenAdvanced={() => onActiveTabChange("advanced")} /> : null}

        {activeTab === "credentials" ? <div className="space-y-3">
          <p className="text-sm leading-relaxed text-slate-500">Only credential metadata and IDs appear here. Values are write-only and travel directly to the project credential broker.</p>
          {(graph?.nodes.flatMap((node) => (node.credentialSlots ?? []).map((slot) => ({ node, slot }))) ?? []).map(({ node, slot }) => <CredentialSlotEditor key={`${node.id}:${slot.slot}`} nodeTitle={node.title} slot={slot} binding={bindings.find((item) => item.slot === slot.slot)} credentials={credentials.filter((credential) => credential.status === "active" && credential.configured && slot.allowedKinds.includes(credential.kind) && credential.capabilities.includes(slot.requiredCapability))} loading={credentialsLoading} onBind={(credentialId) => updateBindings([...bindings.filter((item) => item.slot !== slot.slot), ...(credentialId ? [{ slot: slot.slot, credentialId }] : [])])} onRotate={onRotateCredential} onRevoke={onRevokeCredential} />)}
          {(graph?.nodes.every((node) => !node.credentialSlots?.length) ?? true) ? <EmptyEditorState>Declare credential slots in Advanced JSON, then bind eligible project credentials here.</EmptyEditorState> : null}
        </div> : null}

        {activeTab === "catalog" ? <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{(catalog?.sources ?? []).map((source) => <article key={`${source.dashboardId}:${source.id}`} className="rounded-[1rem] border border-black/[0.08] bg-white/70 p-3 dark:border-white/[0.08] dark:bg-white/[0.04]"><h3 className="truncate text-sm font-bold">{source.title}</h3><p className="mt-1 text-xs text-slate-500">{source.type} from {source.dashboardTitle}</p><Button className="mt-3 w-full" size="sm" variant="secondary" onClick={() => addCatalogSource(source)}>Add to graph</Button></article>)}{(!catalog || catalog.sources.length === 0) ? <EmptyEditorState>No catalog sources are available for this project yet.</EmptyEditorState> : null}</div> : null}

        {activeTab === "advanced" ? <div className="grid gap-4 xl:grid-cols-2"><JsonTextarea label="Manifest JSON" value={draft.manifestText} onInput={(value) => setDraftField("manifestText", value)} /><JsonTextarea label="Routes JSON" value={draft.routesText} onInput={(value) => setDraftField("routesText", value)} /><JsonTextarea label="Source graph JSON" value={draft.sourceGraphText} onInput={(value) => setDraftField("sourceGraphText", value)} /><JsonTextarea label="Credential bindings JSON (IDs only)" value={draft.credentialBindingsText} onInput={(value) => setDraftField("credentialBindingsText", value)} /><JsonTextarea label="File bundle JSON" value={draft.fileBundleText} onInput={(value) => setDraftField("fileBundleText", value)} /><JsonTextarea label="Styleguide JSON" value={draft.styleguideText} onInput={(value) => setDraftField("styleguideText", value)} /></div> : null}
      </div>
    </section>
  );
};

const TypedInput: FunctionComponent<{ label: string; value: string; onInput: (value: string) => void; mono?: boolean; inputMode?: "numeric" }> = ({ label, value, onInput, mono = false, inputMode }) => <label className="flex min-w-0 flex-col gap-1.5 text-xs font-bold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">{label}<input value={value} inputMode={inputMode} onInput={(event) => onInput(event.currentTarget.value)} className={`min-h-[2.6rem] min-w-0 rounded-[0.8rem] border border-black/[0.08] bg-white/80 px-3 text-sm normal-case tracking-normal outline-none focus:border-signal-500 focus:ring-2 focus:ring-signal-500/20 dark:border-white/[0.08] dark:bg-white/[0.06] ${mono ? "font-mono text-xs" : "font-semibold"}`} /></label>;

const CredentialSlotEditor: FunctionComponent<{ nodeTitle: string; slot: CustomDashboardCredentialSlot; binding?: { slot: string; credentialId: string }; credentials: AutomationCredentialMetadata[]; loading: boolean; onBind: (credentialId: string) => void; onRotate: (credentialId: string, value: string) => Promise<void>; onRevoke: (credentialId: string) => Promise<boolean> }> = ({ nodeTitle, slot, binding, credentials, loading, onBind, onRotate, onRevoke }) => {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const credential = credentials.find((item) => item.id === binding?.credentialId);
  const mutate = async (action: "rotate" | "revoke"): Promise<void> => { if (!credential) return; setBusy(true); setError(null); try { if (action === "rotate") { await onRotate(credential.id, value); setValue(""); } else if (await onRevoke(credential.id)) onBind(""); } catch (caught) { setError(caught instanceof Error ? caught.message : `Failed to ${action} credential.`); } finally { setBusy(false); } };
  return <fieldset className="rounded-[1rem] border border-black/[0.08] p-3 dark:border-white/[0.08]"><legend className="px-2 text-sm font-bold">{slot.label}</legend><p className="text-xs text-slate-500">{nodeTitle} · {slot.required ? "Required" : "Optional"} · {slot.requiredCapability} · {slot.allowedKinds.join(", ")}</p><label className="mt-3 flex flex-col gap-1 text-xs font-bold uppercase tracking-[0.12em] text-slate-500">Credential reference<select aria-label={`${slot.label} credential`} value={binding?.credentialId ?? ""} disabled={loading || busy} onChange={(event) => onBind(event.currentTarget.value)} className="min-h-[2.6rem] rounded-[0.8rem] border border-black/[0.08] bg-white/80 px-2 text-sm normal-case tracking-normal dark:border-white/[0.08] dark:bg-white/[0.06]"><option value="">Unbound</option>{credentials.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.kind} · v{item.version}</option>)}</select></label>{credential ? <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]"><input type="password" aria-label={`${credential.name} new secret value`} autoComplete="new-password" value={value} onInput={(event) => setValue(event.currentTarget.value)} placeholder="New write-only value" className="min-h-[2.6rem] rounded-[0.8rem] border border-black/[0.08] bg-white/80 px-3 font-mono text-sm dark:border-white/[0.08] dark:bg-white/[0.06]" /><Button size="sm" disabled={busy || !value} onClick={() => void mutate("rotate")}>Rotate</Button><Button size="sm" variant="danger" disabled={busy} onClick={() => void mutate("revoke")}>Revoke</Button></div> : null}{error ? <p role="alert" className="mt-2 text-xs font-semibold text-status-red">{error}</p> : null}</fieldset>;
};

const JsonTextarea: FunctionComponent<{ label: string; value: string; onInput: (value: string) => void }> = ({ label, value, onInput }) => <label className="flex min-h-0 min-w-0 flex-col gap-2 text-xs font-bold uppercase tracking-[0.14em] text-slate-500">{label}<textarea value={value} rows={14} spellcheck={false} onInput={(event) => onInput(event.currentTarget.value)} className="min-h-[20rem] max-w-full resize-y overflow-auto rounded-[1rem] border border-black/[0.08] bg-slate-950 p-3 font-mono text-xs leading-relaxed text-slate-100 focus:ring-2 focus:ring-signal-500" /></label>;
const EmptyEditorState: FunctionComponent = ({ children }) => <div className="rounded-[1rem] border border-dashed border-black/[0.12] p-6 text-sm text-slate-500 dark:border-white/[0.12]">{children}</div>;
const InlineJsonError: FunctionComponent<{ message: string; onOpenAdvanced: () => void }> = ({ message, onOpenAdvanced }) => <div role="alert" className="rounded-[1rem] border border-status-red/20 bg-status-red/[0.06] p-4 text-sm text-status-red">{message}<Button className="mt-3" size="sm" onClick={onOpenAdvanced}>Open Advanced JSON</Button></div>;
