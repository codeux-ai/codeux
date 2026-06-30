import type { FunctionComponent } from "preact";
import { useEffect, useMemo, useState, useCallback } from "preact/hooks";
import { Library, FileText, Check, Loader2, ExternalLink, Search, CheckSquare, Square } from "lucide-preact";
import {
  fetchKnowledgeDocuments,
  fetchAgentKnowledgeSubscriptions,
  setAgentKnowledgeSubscriptions,
  type KnowledgeDocument,
} from "../../lib/knowledge-api.js";

/**
 * Per-agent knowledge subscription manager. Lets an agent subscribe to documents from the project's
 * shared knowledge library. Subscriptions persist immediately; the editor can still mark itself
 * dirty so the user can acknowledge the change with Save.
 */
export const AgentKnowledgePanel: FunctionComponent<{
  agentPresetId: string;
  projectId: string;
  disabled?: boolean;
  onSubscriptionsChanged?: (documentIds: string[]) => void;
}> = ({ agentPresetId, projectId, disabled, onSubscriptionsChanged }) => {
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      fetchKnowledgeDocuments(projectId).catch(() => [] as KnowledgeDocument[]),
      fetchAgentKnowledgeSubscriptions(agentPresetId).catch(() => [] as string[]),
    ]).then(([docs, subs]) => {
      if (cancelled) return;
      setDocuments(docs);
      setSelected(new Set(subs));
      setQuery("");
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [projectId, agentPresetId]);

  const persistSelection = useCallback(async (next: Set<string>, savingKey: string) => {
    setSelected(next);
    setSavingId(savingKey);
    setError(null);
    try {
      const persisted = await setAgentKnowledgeSubscriptions(agentPresetId, [...next]);
      setSelected(new Set(persisted));
      onSubscriptionsChanged?.(persisted);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update subscription");
      setSelected(selected);
    } finally {
      setSavingId(null);
    }
  }, [agentPresetId, onSubscriptionsChanged, selected]);

  const toggle = useCallback(async (documentId: string) => {
    const next = new Set(selected);
    if (next.has(documentId)) next.delete(documentId);
    else next.add(documentId);
    await persistSelection(next, documentId);
  }, [persistSelection, selected]);

  const selectedCount = selected.size;
  const filteredDocuments = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return documents;
    return documents.filter((doc) => [
      doc.title,
      doc.summary,
      doc.sourceRef || "",
      doc.sourceType,
    ].some((value) => value.toLowerCase().includes(needle)));
  }, [documents, query]);
  const filteredIds = useMemo(() => filteredDocuments.map((doc) => doc.id), [filteredDocuments]);
  const selectedVisibleCount = filteredIds.filter((id) => selected.has(id)).length;
  const allVisibleSelected = filteredIds.length > 0 && selectedVisibleCount === filteredIds.length;

  const selectVisible = useCallback(async () => {
    const next = new Set(selected);
    for (const id of filteredIds) next.add(id);
    await persistSelection(next, "__bulk__");
  }, [filteredIds, persistSelection, selected]);

  const unselectVisible = useCallback(async () => {
    const next = new Set(selected);
    for (const id of filteredIds) next.delete(id);
    await persistSelection(next, "__bulk__");
  }, [filteredIds, persistSelection, selected]);

  const manifestTokens = useMemo(
    () => documents.filter((d) => selected.has(d.id) && d.status === "ready").reduce((sum, d) => sum + Math.max(8, Math.ceil((d.summary.length + d.title.length) / 4)), 0),
    [documents, selected],
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8 text-slate-400">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (documents.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-black/[0.08] px-6 py-10 text-center dark:border-white/[0.08]">
        <Library className="h-7 w-7 text-slate-300 dark:text-slate-600" strokeWidth={1.8} />
        <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">The knowledge library is empty.</p>
        <a href="/knowledge" className="inline-flex items-center gap-1.5 text-[12px] font-bold text-signal-600 hover:underline dark:text-signal-400">
          Add documents on the Knowledge page <ExternalLink className="h-3 w-3" />
        </a>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between text-[11px] font-semibold text-slate-400 dark:text-slate-500">
        <span>{selectedCount} subscribed · {documents.length} in library</span>
        {selectedCount > 0 && <span>~{manifestTokens} tok manifest</span>}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" strokeWidth={2.4} />
          <input
            type="search"
            value={query}
            onInput={(event) => setQuery(event.currentTarget.value)}
            placeholder="Search knowledge"
            className="w-full rounded-xl border border-black/[0.06] bg-white/50 py-2 pl-8 pr-3 text-[12px] font-medium text-slate-700 outline-none transition-colors placeholder:text-slate-400 focus:border-signal-500/40 dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-slate-200 dark:placeholder:text-slate-500"
          />
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          <button
            type="button"
            disabled={disabled || savingId !== null || filteredIds.length === 0 || allVisibleSelected}
            onClick={() => void selectVisible()}
            className="inline-flex items-center gap-1.5 rounded-xl border border-black/[0.06] bg-white/45 px-2.5 py-2 text-[11px] font-bold text-slate-500 transition-colors hover:bg-white hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-slate-300 dark:hover:bg-white/[0.07] dark:hover:text-white"
          >
            {savingId === "__bulk__" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckSquare className="h-3.5 w-3.5" strokeWidth={2.3} />}
            Select all
          </button>
          <button
            type="button"
            disabled={disabled || savingId !== null || filteredIds.length === 0 || selectedVisibleCount === 0}
            onClick={() => void unselectVisible()}
            className="inline-flex items-center gap-1.5 rounded-xl border border-black/[0.06] bg-white/45 px-2.5 py-2 text-[11px] font-bold text-slate-500 transition-colors hover:bg-white hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-slate-300 dark:hover:bg-white/[0.07] dark:hover:text-white"
          >
            <Square className="h-3.5 w-3.5" strokeWidth={2.3} />
            Unselect all
          </button>
        </div>
      </div>

      {error && <p className="text-[12px] text-status-red">{error}</p>}

      <div className="flex max-h-72 flex-col gap-1.5 overflow-y-auto pr-1">
        {filteredDocuments.length === 0 ? (
          <div className="rounded-xl border border-dashed border-black/[0.08] px-4 py-8 text-center text-[12px] font-semibold text-slate-400 dark:border-white/[0.08] dark:text-slate-500">
            No matching knowledge documents.
          </div>
        ) : filteredDocuments.map((doc) => {
          const isSelected = selected.has(doc.id);
          const isReady = doc.status === "ready";
          return (
            <button
              key={doc.id}
              type="button"
              disabled={disabled || savingId !== null}
              onClick={() => toggle(doc.id)}
              className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors disabled:opacity-60 ${
                isSelected
                  ? "border-signal-500/30 bg-signal-500/[0.07]"
                  : "border-black/[0.06] bg-white/40 hover:bg-white/70 dark:border-white/[0.06] dark:bg-white/[0.02] dark:hover:bg-white/[0.05]"
              }`}
            >
              <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${isSelected ? "bg-signal-500 text-slate-900 dark:text-void-900" : "bg-black/[0.05] text-slate-400 dark:bg-white/[0.06]"}`}>
                {savingId === doc.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : isSelected ? <Check className="h-4 w-4" strokeWidth={3} /> : <FileText className="h-3.5 w-3.5" strokeWidth={2.2} />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-semibold text-slate-700 dark:text-slate-200">{doc.title}</div>
                {doc.summary && <div className="truncate text-[11px] text-slate-400 dark:text-slate-500">{doc.summary}</div>}
              </div>
              <span className={`shrink-0 text-[10px] font-bold ${isReady ? "text-slate-400" : "text-amber-500"}`}>
                {isReady ? `${doc.chunkCount} chunks` : doc.status === "error" ? "error" : "embedding…"}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};
