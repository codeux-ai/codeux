import type { FunctionComponent } from "preact";
import { useEffect, useMemo, useRef, useState, useCallback } from "preact/hooks";
import {
  Library, Upload, FileText, FileCode, StickyNote, FolderGit2, Trash2, RefreshCw,
  Search, Loader2, AlertTriangle, Check, Plus, X, Sparkles, BookOpen,
} from "lucide-preact";
import { PageContainer } from "./components/layout/PageContainer.js";
import { useProjectData } from "./context/project-data.js";
import { listEmbeddingModels } from "./lib/memory-api.js";
import { fetchAgentPresets } from "./lib/agent-preset-api.js";
import type { AgentPreset } from "./types.js";
import {
  fetchKnowledgeDocuments,
  addPastedDocument,
  addRepoPathDocuments,
  uploadKnowledgeFiles,
  deleteKnowledgeDocument,
  reembedKnowledgeDocument,
  searchKnowledge,
  type KnowledgeDocument,
  type KnowledgeSearchResult,
} from "./lib/knowledge-api.js";

type AddMode = "upload" | "paste" | "repo" | null;

const formatBytes = (bytes: number): string => {
  if (!bytes) return "0 KB";
  if (bytes < 1e6) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1e6).toFixed(1)} MB`;
};

const formatTokens = (tokens: number): string => {
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`;
  return String(tokens);
};

const docIcon = (doc: KnowledgeDocument) => {
  const ref = (doc.sourceRef || doc.title || "").toLowerCase();
  if ((doc.mimeType || "").includes("pdf") || ref.endsWith(".pdf")) return { Icon: FileText, cls: "text-status-red" };
  if ((doc.mimeType || "").includes("wordprocessingml") || ref.endsWith(".docx")) return { Icon: FileText, cls: "text-sky-500" };
  if (doc.sourceType === "paste") return { Icon: StickyNote, cls: "text-amber-500" };
  if (doc.sourceType === "repo_path") return { Icon: FolderGit2, cls: "text-violet-500" };
  if (/\.(ts|tsx|js|jsx|py|go|rs|java|rb|php|c|cpp|cs|sh|sql|css)$/.test(ref)) return { Icon: FileCode, cls: "text-signal-500" };
  return { Icon: FileText, cls: "text-slate-400" };
};

const StatusPill: FunctionComponent<{ doc: KnowledgeDocument }> = ({ doc }) => {
  if (doc.status === "ready") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-signal-500/20 bg-signal-500/8 px-2 py-0.5 text-[10px] font-bold text-signal-600 dark:text-signal-400">
        <Check className="h-3 w-3" strokeWidth={2.6} />
        {doc.chunkCount} chunk{doc.chunkCount === 1 ? "" : "s"}
      </span>
    );
  }
  if (doc.status === "error") {
    return (
      <span title={doc.errorMessage || "Failed"} className="inline-flex items-center gap-1 rounded-full border border-status-red/20 bg-status-red/8 px-2 py-0.5 text-[10px] font-bold text-status-red">
        <AlertTriangle className="h-3 w-3" strokeWidth={2.4} />
        Error
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/20 bg-amber-400/8 px-2 py-0.5 text-[10px] font-bold text-amber-600 dark:text-amber-400">
      <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2.4} />
      {doc.status === "pending" ? "Queued" : "Embedding"}
    </span>
  );
};

export const KnowledgePage: FunctionComponent = () => {
  const { selectedProject } = useProjectData();
  const pid = selectedProject?.id || "";

  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [agentPresets, setAgentPresets] = useState<AgentPreset[]>([]);
  const [modelActive, setModelActive] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [addMode, setAddMode] = useState<AddMode>(null);
  const [dragging, setDragging] = useState(false);

  const agentNameById = useMemo(() => {
    const map = new Map<string, AgentPreset>();
    for (const preset of agentPresets) map.set(preset.id, preset);
    return map;
  }, [agentPresets]);

  const loadData = useCallback(async () => {
    if (!pid) {
      setDocuments([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [docs, models, presets] = await Promise.all([
        fetchKnowledgeDocuments(pid),
        listEmbeddingModels().catch(() => []),
        fetchAgentPresets(pid).catch(() => [] as AgentPreset[]),
      ]);
      setDocuments(docs);
      setModelActive(models.some((m) => m.active));
      setAgentPresets(presets);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load knowledge base");
    } finally {
      setLoading(false);
    }
  }, [pid]);

  useEffect(() => { void loadData(); }, [loadData]);

  // Poll while any document is still being processed.
  const processing = documents.some((d) => d.status === "pending" || d.status === "embedding");
  const processingRef = useRef(processing);
  processingRef.current = processing;
  useEffect(() => {
    if (!pid) return;
    const interval = setInterval(() => {
      if (!processingRef.current) return;
      fetchKnowledgeDocuments(pid).then(setDocuments).catch(() => {});
    }, 1500);
    return () => clearInterval(interval);
  }, [pid]);

  const handleUpload = useCallback(async (files: File[]) => {
    if (!pid || files.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const result = await uploadKnowledgeFiles(pid, files);
      if (result.errors.length > 0) {
        setError(result.errors.map((e) => `${e.fileName}: ${e.error}`).join(" · "));
      }
      await loadData();
      setAddMode(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }, [pid, loadData]);

  const onDrop = useCallback((e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const files = e.dataTransfer ? Array.from(e.dataTransfer.files) : [];
    if (files.length > 0) void handleUpload(files);
  }, [handleUpload]);

  const removeDocument = useCallback(async (documentId: string) => {
    setDocuments((prev) => prev.filter((d) => d.id !== documentId));
    try {
      await deleteKnowledgeDocument(documentId);
    } catch {
      await loadData();
    }
  }, [loadData]);

  const reembed = useCallback(async (documentId: string) => {
    try {
      const updated = await reembedKnowledgeDocument(documentId);
      setDocuments((prev) => prev.map((d) => (d.id === documentId ? updated : d)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Re-embed failed");
    }
  }, []);

  const totalChunks = documents.reduce((sum, d) => sum + d.chunkCount, 0);
  const readyCount = documents.filter((d) => d.status === "ready").length;

  return (
    <PageContainer padding="section" className="gap-8">
      {/* Header */}
      <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2.5 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-signal-500">
            <Library className="h-3.5 w-3.5" strokeWidth={2.5} />
            Knowledge Base
          </div>
          <h1 className="font-display text-4xl font-black tracking-tight text-slate-900 dark:text-white">
            Documents
          </h1>
          <p className="max-w-2xl text-sm leading-relaxed text-slate-500 dark:text-slate-400">
            Upload specs, docs, and code into a shared library. Each document is embedded once with your
            local model, and agents subscribe to the ones they should know. They retrieve passages on
            demand via <code className="rounded bg-black/[0.05] px-1 py-0.5 font-mono text-[11px] dark:bg-white/[0.06]">search_knowledge</code>.
          </p>
          {documents.length > 0 && (
            <div className="flex flex-wrap items-center gap-4 text-[11px] font-semibold text-slate-400 dark:text-slate-500">
              <span>{documents.length} document{documents.length === 1 ? "" : "s"}</span>
              <span>·</span>
              <span>{readyCount} ready</span>
              <span>·</span>
              <span>{totalChunks} embedded chunks</span>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setAddMode("upload")}
            disabled={!pid}
            className="inline-flex items-center gap-2 rounded-full bg-signal-500 px-5 py-2.5 text-sm font-bold text-slate-900 shadow-lg shadow-signal-500/15 transition-all hover:scale-[1.03] hover:bg-signal-400 disabled:cursor-not-allowed disabled:opacity-50 dark:text-void-900"
          >
            <Upload className="h-4 w-4" strokeWidth={2.5} />
            Upload
          </button>
          <button
            type="button"
            onClick={() => setAddMode("paste")}
            disabled={!pid}
            className="inline-flex items-center gap-2 rounded-full border border-black/[0.08] bg-white/60 px-4 py-2.5 text-sm font-bold text-slate-600 transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-200 dark:hover:bg-white/[0.08]"
          >
            <StickyNote className="h-4 w-4" strokeWidth={2.4} />
            Paste
          </button>
          <button
            type="button"
            onClick={() => setAddMode("repo")}
            disabled={!pid}
            className="inline-flex items-center gap-2 rounded-full border border-black/[0.08] bg-white/60 px-4 py-2.5 text-sm font-bold text-slate-600 transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-200 dark:hover:bg-white/[0.08]"
          >
            <FolderGit2 className="h-4 w-4" strokeWidth={2.4} />
            From repo
          </button>
        </div>
      </div>

      {/* Embedding model gate */}
      {modelActive === false && (
        <div className="flex items-center gap-3 rounded-2xl border border-amber-400/25 bg-amber-400/[0.06] px-5 py-4 text-sm text-amber-700 dark:text-amber-300">
          <AlertTriangle className="h-5 w-5 shrink-0" strokeWidth={2.2} />
          <span>
            No embedding model is active. Download and select one on the{" "}
            <a href="/memory" className="font-bold underline">Memory</a> page before adding documents.
          </span>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-3 rounded-2xl border border-status-red/25 bg-status-red/[0.06] px-5 py-3 text-sm text-status-red">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2.2} />
          <span className="flex-1">{error}</span>
          <button type="button" onClick={() => setError(null)} aria-label="Dismiss"><X className="h-4 w-4" /></button>
        </div>
      )}

      {/* Search test box */}
      {readyCount > 0 && <KnowledgeSearchBox projectId={pid} agentPresets={agentPresets} />}

      {/* Library grid */}
      {!pid ? (
        <EmptyState icon={BookOpen} title="Select a project" body="Choose a project to manage its knowledge base." />
      ) : loading && documents.length === 0 ? (
        <div className="flex items-center justify-center py-24 text-slate-400">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : documents.length === 0 ? (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={`flex flex-col items-center gap-4 rounded-[1.8rem] border-2 border-dashed px-8 py-20 text-center transition-colors ${dragging ? "border-signal-500 bg-signal-500/[0.05]" : "border-black/[0.08] dark:border-white/[0.08]"}`}
        >
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-signal-500/10 text-signal-500">
            <Sparkles className="h-7 w-7" strokeWidth={2} />
          </div>
          <div className="flex flex-col gap-1">
            <p className="text-lg font-bold text-slate-700 dark:text-slate-200">Build your knowledge base</p>
            <p className="text-sm text-slate-400 dark:text-slate-500">Drag files here, or use Upload / Paste / From repo above.</p>
          </div>
        </div>
      ) : (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={`grid grid-cols-1 gap-4 rounded-[1.5rem] transition-colors sm:grid-cols-2 xl:grid-cols-3 ${dragging ? "ring-2 ring-signal-500/40" : ""}`}
        >
          {documents.map((doc) => {
            const { Icon, cls } = docIcon(doc);
            const subscribers = doc.subscriberAgentIds.map((id) => agentNameById.get(id)?.name).filter(Boolean) as string[];
            return (
              <div
                key={doc.id}
                className="group relative flex flex-col gap-3 rounded-2xl border border-black/[0.06] bg-white/70 p-5 shadow-[0_2px_16px_rgba(0,0,0,0.03)] backdrop-blur-xl transition-all hover:shadow-[0_4px_24px_rgba(0,0,0,0.06)] dark:border-white/[0.06] dark:bg-void-800/50"
              >
                <div className="flex items-start gap-3">
                  <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-black/[0.04] dark:bg-white/[0.05] ${cls}`}>
                    <Icon className="h-5 w-5" strokeWidth={2.2} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-bold text-slate-800 dark:text-slate-100" title={doc.title}>{doc.title}</div>
                    <div className="mt-0.5 truncate font-mono text-[10px] text-slate-400 dark:text-slate-500" title={doc.sourceRef || ""}>
                      {doc.sourceRef || doc.sourceType}
                    </div>
                  </div>
                </div>

                {doc.summary && (
                  <p className="line-clamp-2 text-[12px] leading-relaxed text-slate-500 dark:text-slate-400">{doc.summary}</p>
                )}

                <div className="mt-auto flex items-center justify-between gap-2 pt-1">
                  <div className="flex items-center gap-2">
                    <StatusPill doc={doc} />
                    <span className="text-[10px] font-semibold text-slate-400 dark:text-slate-500">
                      {formatBytes(doc.byteSize)} · ~{formatTokens(doc.tokenCount)} tok
                    </span>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    {doc.status === "error" && (
                      <button type="button" onClick={() => reembed(doc.id)} title="Retry embedding" className="rounded-lg p-1.5 text-slate-400 hover:bg-black/[0.05] hover:text-signal-500 dark:hover:bg-white/[0.06]">
                        <RefreshCw className="h-3.5 w-3.5" strokeWidth={2.2} />
                      </button>
                    )}
                    <button type="button" onClick={() => removeDocument(doc.id)} title="Delete" className="rounded-lg p-1.5 text-slate-400 hover:bg-status-red/10 hover:text-status-red">
                      <Trash2 className="h-3.5 w-3.5" strokeWidth={2.2} />
                    </button>
                  </div>
                </div>

                {subscribers.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 border-t border-black/[0.05] pt-2.5 dark:border-white/[0.05]">
                    {subscribers.slice(0, 4).map((name) => (
                      <span key={name} className="inline-flex items-center rounded-full bg-signal-500/[0.08] px-2 py-0.5 text-[10px] font-bold text-signal-600 dark:text-signal-400">{name}</span>
                    ))}
                    {subscribers.length > 4 && <span className="text-[10px] font-bold text-slate-400">+{subscribers.length - 4}</span>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {addMode === "upload" && <UploadModal busy={busy} onClose={() => setAddMode(null)} onFiles={handleUpload} />}
      {addMode === "paste" && <PasteModal busy={busy} onClose={() => setAddMode(null)} onSubmit={async (title, text) => {
        setBusy(true);
        setError(null);
        try { await addPastedDocument(pid, { title, text }); await loadData(); setAddMode(null); }
        catch (err) { setError(err instanceof Error ? err.message : "Failed to add note"); }
        finally { setBusy(false); }
      }} />}
      {addMode === "repo" && <RepoPathModal busy={busy} onClose={() => setAddMode(null)} onSubmit={async (repoPath) => {
        setBusy(true);
        setError(null);
        try {
          const result = await addRepoPathDocuments(pid, repoPath);
          if (result.errors.length > 0) setError(result.errors.map((e) => `${e.fileName}: ${e.error}`).join(" · "));
          await loadData();
          setAddMode(null);
        } catch (err) { setError(err instanceof Error ? err.message : "Failed to ingest path"); }
        finally { setBusy(false); }
      }} />}
    </PageContainer>
  );
};

/* ── Search test box ── */
const KnowledgeSearchBox: FunctionComponent<{ projectId: string; agentPresets: AgentPreset[] }> = ({ projectId, agentPresets }) => {
  const [query, setQuery] = useState("");
  const [agentId, setAgentId] = useState("");
  const [results, setResults] = useState<KnowledgeSearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);

  const run = useCallback(async () => {
    if (!query.trim()) return;
    setSearching(true);
    try {
      const found = await searchKnowledge(projectId, { query, agentPresetId: agentId || undefined, limit: 6 });
      setResults(found);
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, [projectId, query, agentId]);

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-black/[0.06] bg-white/50 p-4 backdrop-blur-xl dark:border-white/[0.06] dark:bg-white/[0.02]">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => { if (e.key === "Enter") void run(); }}
            placeholder="Test what an agent would retrieve…"
            className="w-full rounded-xl border border-black/[0.08] bg-white/70 py-2.5 pl-9 pr-3 text-sm text-slate-700 outline-none focus:border-signal-500/40 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-200"
          />
        </div>
        <select
          value={agentId}
          onChange={(e) => setAgentId((e.target as HTMLSelectElement).value)}
          className="rounded-xl border border-black/[0.08] bg-white/70 px-3 py-2.5 text-sm font-semibold text-slate-600 outline-none dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-300"
        >
          <option value="">Whole library</option>
          {agentPresets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}'s docs</option>)}
        </select>
        <button type="button" onClick={run} disabled={searching || !query.trim()} className="inline-flex items-center gap-2 rounded-xl bg-signal-500/90 px-4 py-2.5 text-sm font-bold text-slate-900 hover:bg-signal-400 disabled:opacity-50 dark:text-void-900">
          {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" strokeWidth={2.5} />}
          Search
        </button>
      </div>
      {results && (
        <div className="flex flex-col gap-2">
          {results.length === 0 ? (
            <p className="px-1 py-2 text-sm text-slate-400">No relevant passages found.</p>
          ) : results.map((r, i) => (
            <div key={i} className="rounded-xl border border-black/[0.05] bg-white/40 p-3 dark:border-white/[0.05] dark:bg-white/[0.02]">
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="truncate text-[11px] font-bold text-signal-600 dark:text-signal-400">
                  {r.documentTitle}{r.heading ? ` › ${r.heading}` : ""}
                </span>
                <span className="shrink-0 font-mono text-[10px] text-slate-400">{Math.round(r.similarity * 100)}%</span>
              </div>
              <p className="line-clamp-3 text-[12px] leading-relaxed text-slate-500 dark:text-slate-400">{r.content}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

/* ── Modals ── */
const ModalShell: FunctionComponent<{ title: string; onClose: () => void; children: preact.ComponentChildren }> = ({ title, onClose, children }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm" onClick={onClose}>
    <div className="w-full max-w-lg rounded-3xl border border-black/[0.08] bg-white p-6 shadow-2xl dark:border-white/[0.08] dark:bg-void-800" onClick={(e) => e.stopPropagation()}>
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">{title}</h3>
        <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-black/[0.05] dark:hover:bg-white/[0.06]"><X className="h-5 w-5" /></button>
      </div>
      {children}
    </div>
  </div>
);

const UploadModal: FunctionComponent<{ busy: boolean; onClose: () => void; onFiles: (files: File[]) => void }> = ({ busy, onClose, onFiles }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <ModalShell title="Upload documents" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-black/[0.1] py-12 transition-colors hover:border-signal-500/50 hover:bg-signal-500/[0.03] disabled:opacity-50 dark:border-white/[0.1]"
        >
          {busy ? <Loader2 className="h-8 w-8 animate-spin text-signal-500" /> : <Upload className="h-8 w-8 text-signal-500" strokeWidth={1.8} />}
          <span className="text-sm font-bold text-slate-600 dark:text-slate-300">{busy ? "Uploading…" : "Choose files"}</span>
          <span className="text-[11px] text-slate-400">Text, Markdown, code, JSON/CSV, HTML, PDF, DOCX</span>
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = Array.from((e.target as HTMLInputElement).files || []);
            if (files.length > 0) onFiles(files);
          }}
        />
      </div>
    </ModalShell>
  );
};

const PasteModal: FunctionComponent<{ busy: boolean; onClose: () => void; onSubmit: (title: string, text: string) => void }> = ({ busy, onClose, onSubmit }) => {
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  return (
    <ModalShell title="Paste a note" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <input
          value={title}
          onInput={(e) => setTitle((e.target as HTMLInputElement).value)}
          placeholder="Title"
          className="rounded-xl border border-black/[0.08] bg-white/70 px-3 py-2.5 text-sm outline-none focus:border-signal-500/40 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-200"
        />
        <textarea
          value={text}
          onInput={(e) => setText((e.target as HTMLTextAreaElement).value)}
          placeholder="Paste documentation, conventions, runbooks…"
          rows={10}
          className="resize-y rounded-xl border border-black/[0.08] bg-white/70 px-3 py-2.5 font-mono text-[12px] outline-none focus:border-signal-500/40 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-200"
        />
        <button
          type="button"
          disabled={busy || !title.trim() || !text.trim()}
          onClick={() => onSubmit(title.trim(), text)}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-signal-500 px-4 py-2.5 text-sm font-bold text-slate-900 hover:bg-signal-400 disabled:opacity-50 dark:text-void-900"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" strokeWidth={2.5} />}
          Add to library
        </button>
      </div>
    </ModalShell>
  );
};

const RepoPathModal: FunctionComponent<{ busy: boolean; onClose: () => void; onSubmit: (path: string) => void }> = ({ busy, onClose, onSubmit }) => {
  const [repoPath, setRepoPath] = useState("");
  return (
    <ModalShell title="Ingest from the repo" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <p className="text-[12px] leading-relaxed text-slate-500 dark:text-slate-400">
          Enter a file or directory path relative to the project root. Directories are walked for
          text-extractable files (build output and dependencies are skipped).
        </p>
        <input
          value={repoPath}
          onInput={(e) => setRepoPath((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => { if (e.key === "Enter" && repoPath.trim()) onSubmit(repoPath.trim()); }}
          placeholder="docs/ or README.md"
          className="rounded-xl border border-black/[0.08] bg-white/70 px-3 py-2.5 font-mono text-sm outline-none focus:border-signal-500/40 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-200"
        />
        <button
          type="button"
          disabled={busy || !repoPath.trim()}
          onClick={() => onSubmit(repoPath.trim())}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-signal-500 px-4 py-2.5 text-sm font-bold text-slate-900 hover:bg-signal-400 disabled:opacity-50 dark:text-void-900"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderGit2 className="h-4 w-4" strokeWidth={2.4} />}
          Ingest
        </button>
      </div>
    </ModalShell>
  );
};

const EmptyState: FunctionComponent<{ icon: typeof BookOpen; title: string; body: string }> = ({ icon: Icon, title, body }) => (
  <div className="flex flex-col items-center gap-4 rounded-[1.8rem] border border-black/[0.06] bg-white/40 px-8 py-20 text-center dark:border-white/[0.06] dark:bg-white/[0.02]">
    <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-black/[0.04] text-slate-400 dark:bg-white/[0.05]">
      <Icon className="h-6 w-6" strokeWidth={2} />
    </div>
    <div className="flex flex-col gap-1">
      <p className="text-lg font-bold text-slate-700 dark:text-slate-200">{title}</p>
      <p className="text-sm text-slate-400 dark:text-slate-500">{body}</p>
    </div>
  </div>
);
