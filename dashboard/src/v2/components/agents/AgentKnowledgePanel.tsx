import type { FunctionComponent } from "preact";
import { useEffect, useMemo, useState, useCallback } from "preact/hooks";
import { Library, FileText, Check, Loader2, ExternalLink } from "lucide-preact";
import {
  fetchKnowledgeDocuments,
  fetchAgentKnowledgeSubscriptions,
  setAgentKnowledgeSubscriptions,
  type KnowledgeDocument,
} from "../../lib/knowledge-api.js";

/**
 * Per-agent knowledge subscription manager. Lets an agent subscribe to documents from the project's
 * shared knowledge library. Subscriptions persist immediately (independent of the preset save).
 */
export const AgentKnowledgePanel: FunctionComponent<{
  agentPresetId: string;
  projectId: string;
  disabled?: boolean;
}> = ({ agentPresetId, projectId, disabled }) => {
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      fetchKnowledgeDocuments(projectId).catch(() => [] as KnowledgeDocument[]),
      fetchAgentKnowledgeSubscriptions(agentPresetId).catch(() => [] as string[]),
    ]).then(([docs, subs]) => {
      if (cancelled) return;
      setDocuments(docs);
      setSelected(new Set(subs));
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [projectId, agentPresetId]);

  const toggle = useCallback(async (documentId: string) => {
    const next = new Set(selected);
    if (next.has(documentId)) next.delete(documentId);
    else next.add(documentId);
    setSelected(next);
    setSavingId(documentId);
    setError(null);
    try {
      const persisted = await setAgentKnowledgeSubscriptions(agentPresetId, [...next]);
      setSelected(new Set(persisted));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update subscription");
      // Revert on failure
      setSelected(selected);
    } finally {
      setSavingId(null);
    }
  }, [agentPresetId, selected]);

  const selectedCount = selected.size;
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

      {error && <p className="text-[12px] text-status-red">{error}</p>}

      <div className="flex max-h-72 flex-col gap-1.5 overflow-y-auto pr-1">
        {documents.map((doc) => {
          const isSelected = selected.has(doc.id);
          const isReady = doc.status === "ready";
          return (
            <button
              key={doc.id}
              type="button"
              disabled={disabled || savingId === doc.id}
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
