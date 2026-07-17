import type { FunctionComponent } from "preact";
import { useEffect, useMemo, useRef, useState, useCallback } from "preact/hooks";
import {
  Library, Upload, FileText, FileCode, StickyNote, FolderGit2, Trash2, RefreshCw,
  Search, Loader2, AlertTriangle, Check, Plus, X, Sparkles, BookOpen, Copy,
} from "lucide-preact";
import { PageContainer } from "./components/layout/PageContainer.js";
import { PageHeader } from "./components/layout/PageHeader.js";
import { ConfirmDialog } from "./components/ui/ConfirmDialog.js";
import { useProjectData } from "./context/project-data.js";
import { useConfirmDialog } from "./hooks/use-confirm-dialog.js";
import { restoreFocusSafely } from "./hooks/use-focus-trap.js";
import { listEmbeddingModels } from "./lib/memory-api.js";
import { fetchAgentPresets } from "./lib/agent-preset-api.js";
import type { AgentPreset, Source } from "./types.js";
import { AvantgardeSelect } from "./components/ui/AvantgardeSelect.js";
import {
  fetchKnowledgeDocuments,
  addPastedDocument,
  addRepoPathDocuments,
  uploadKnowledgeFiles,
  importKnowledgeFromProject,
  deleteKnowledgeDocument,
  reembedKnowledgeDocument,
  searchKnowledge,
  type KnowledgeDocument,
  type KnowledgeSearchResult,
} from "./lib/knowledge-api.js";
import { useDashboardI18n } from "./i18n/context.js";
import { knowledgeMessages } from "./i18n/messages/knowledge.js";
import {
  formatKnowledgeDate,
  formatKnowledgeFileSize,
  formatKnowledgeProgress,
  getKnowledgeStatusMessageKey,
} from "./lib/knowledge-presentation.js";
import { useListReorder } from "./lib/motion/use-list-reorder.js";
import { useInteractionTokens } from "./lib/motion/tokens.js";

type AddMode = "upload" | "paste" | "repo" | "project" | null;

type DocumentMutationAction = "delete" | "reembed";
type DocumentMutationStatus = "pending" | "success" | "error";

interface DocumentMutationFeedback {
  action: DocumentMutationAction;
  status: DocumentMutationStatus;
  message: string;
  diagnostic?: string;
}

interface DeletionTombstone {
  document: KnowledgeDocument;
  index: number;
  restoreIndex: number;
  nextDocumentId: string | null;
  previousDocumentId: string | null;
}

interface UploadAttemptItem {
  file: File;
  status: "pending" | "success" | "error";
  diagnostic?: string;
}

interface UploadAttempt {
  projectId: string;
  items: UploadAttemptItem[];
}

interface PendingDeleteConfirmation {
  document: KnowledgeDocument;
  projectId: string;
  trigger: HTMLElement;
}

type DeleteOperationOutcome =
  | { status: "success"; tombstone: DeletionTombstone }
  | { status: "error"; documentId: string };

type LibraryItem =
  | { kind: "document"; document: KnowledgeDocument }
  | { kind: "deleting"; tombstone: DeletionTombstone };

const docIcon = (doc: KnowledgeDocument) => {
  const ref = (doc.sourceRef || doc.title || "").toLowerCase();
  if ((doc.mimeType || "").includes("pdf") || ref.endsWith(".pdf")) return { Icon: FileText, cls: "text-status-red" };
  if ((doc.mimeType || "").includes("wordprocessingml") || ref.endsWith(".docx")) return { Icon: FileText, cls: "text-sky-500" };
  if (doc.sourceType === "paste") return { Icon: StickyNote, cls: "text-amber-500" };
  if (doc.sourceType === "repo_path") return { Icon: FolderGit2, cls: "text-violet-500" };
  if (doc.sourceType === "project") return { Icon: Copy, cls: "text-sky-500" };
  if (/\.(ts|tsx|js|jsx|py|go|rs|java|rb|php|c|cpp|cs|sh|sql|css)$/.test(ref)) return { Icon: FileCode, cls: "text-signal-500" };
  return { Icon: FileText, cls: "text-slate-400" };
};

const StatusPill: FunctionComponent<{ doc: KnowledgeDocument }> = ({ doc }) => {
  const { formatNumber, translate, translatePlural } = useDashboardI18n();
  if (doc.status === "ready") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-signal-500/20 bg-signal-500/8 px-2 py-0.5 text-[10px] font-bold text-signal-600 dark:text-signal-400">
        <Check className="h-3 w-3" strokeWidth={2.6} />
        {translatePlural(knowledgeMessages, "statusChunkCount", doc.chunkCount, {
          formattedCount: formatNumber(doc.chunkCount),
        })}
      </span>
    );
  }
  if (doc.status === "error") {
    return (
      <span title={doc.errorMessage || translate(knowledgeMessages, "statusFailed")} className="inline-flex items-center gap-1 rounded-full border border-status-red/20 bg-status-red/8 px-2 py-0.5 text-[10px] font-bold text-status-red">
        <AlertTriangle className="h-3 w-3" strokeWidth={2.4} />
        {translate(knowledgeMessages, "statusError")}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/20 bg-amber-400/8 px-2 py-0.5 text-[10px] font-bold text-amber-600 dark:text-amber-400">
      <Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" strokeWidth={2.4} />
      {translate(knowledgeMessages, getKnowledgeStatusMessageKey(doc.status))}
    </span>
  );
};

export const KnowledgePage: FunctionComponent = () => {
  const { locale, formatNumber, translate, translatePlural } = useDashboardI18n();
  const translateRef = useRef(translate);
  translateRef.current = translate;
  const { selectedProject, projects } = useProjectData();
  const pid = selectedProject?.id || "";
  const pidRef = useRef(pid);
  pidRef.current = pid;

  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [agentPresets, setAgentPresets] = useState<AgentPreset[]>([]);
  const [modelActive, setModelActive] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [addMode, setAddMode] = useState<AddMode>(null);
  const [dragging, setDragging] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [documentFeedback, setDocumentFeedback] = useState<Record<string, DocumentMutationFeedback>>({});
  const [deletionTombstones, setDeletionTombstones] = useState<Record<string, DeletionTombstone>>({});
  const [uploadAttempt, setUploadAttempt] = useState<UploadAttempt | null>(null);
  const ingestionInFlight = useRef(false);
  const ingestionGenerationRef = useRef(0);
  const loadGenerationRef = useRef(0);
  const documentsRef = useRef(documents);
  documentsRef.current = documents;
  const deletionTombstonesRef = useRef(deletionTombstones);
  deletionTombstonesRef.current = deletionTombstones;
  const deleteOperationsRef = useRef(new Map<string, symbol>());
  const reembedOperationsRef = useRef(new Map<string, symbol>());
  const documentFocusRefs = useRef(new Map<string, HTMLElement>());
  const documentDeleteButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const pendingDeleteConfirmationRef = useRef<PendingDeleteConfirmation | null>(null);
  const listHeadingRef = useRef<HTMLHeadingElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const deleteConfirm = useConfirmDialog();
  const deleteConfirmOpenRef = useRef(deleteConfirm.isOpen);
  deleteConfirmOpenRef.current = deleteConfirm.isOpen;
  const deleteConfirmCancelRef = useRef(deleteConfirm.handleCancel);
  deleteConfirmCancelRef.current = deleteConfirm.handleCancel;
  const interactionTokens = useInteractionTokens();

  const agentNameById = useMemo(() => {
    const map = new Map<string, AgentPreset>();
    for (const preset of agentPresets) map.set(preset.id, preset);
    return map;
  }, [agentPresets]);

  const loadData = useCallback(async () => {
    if (!pid) {
      setDocuments([]);
      setModelActive(null);
      return;
    }
    const requestPid = pid;
    const generation = ++loadGenerationRef.current;
    setLoading(true);
    setError(null);
    try {
      const [docs, models, presets] = await Promise.all([
        fetchKnowledgeDocuments(pid),
        listEmbeddingModels().catch(() => []),
        fetchAgentPresets(pid).catch(() => [] as AgentPreset[]),
      ]);
      if (pidRef.current !== requestPid || loadGenerationRef.current !== generation) return;
      setDocuments(docs.filter((document) => !deleteOperationsRef.current.has(document.id)));
      setModelActive(models.some((m) => m.active));
      setAgentPresets(presets);
    } catch (err) {
      if (pidRef.current !== requestPid || loadGenerationRef.current !== generation) return;
      setError(err instanceof Error ? err.message : translateRef.current(knowledgeMessages, "loadFailed"));
    } finally {
      if (pidRef.current === requestPid && loadGenerationRef.current === generation) setLoading(false);
    }
  }, [pid]);

  useEffect(() => { void loadData(); }, [loadData]);

  useEffect(() => {
    ingestionGenerationRef.current += 1;
    ingestionInFlight.current = false;
    deleteOperationsRef.current.clear();
    reembedOperationsRef.current.clear();
    if (deleteConfirmOpenRef.current) deleteConfirmCancelRef.current();
    pendingDeleteConfirmationRef.current = null;
    setDocuments([]);
    setAgentPresets([]);
    setModelActive(null);
    setError(null);
    setBusy(false);
    setAddMode(null);
    setDocumentFeedback({});
    setDeletionTombstones({});
    setUploadAttempt(null);
    setAnnouncement("");
  }, [pid]);

  // Poll while any document is still being processed.
  const processing = documents.some((d) => d.status === "pending" || d.status === "embedding");
  const processingRef = useRef(processing);
  processingRef.current = processing;
  useEffect(() => {
    if (!pid) return;
    const interval = setInterval(() => {
      if (!processingRef.current) return;
      const requestPid = pid;
      fetchKnowledgeDocuments(requestPid).then((nextDocuments) => {
        if (pidRef.current !== requestPid) return;
        const deletingIds = deleteOperationsRef.current;
        setDocuments(nextDocuments.filter((document) => !deletingIds.has(document.id)));
      }).catch(() => {});
    }, 1500);
    return () => clearInterval(interval);
  }, [pid]);

  const runIngestion = useCallback(async (
    operation: (requestPid: string) => Promise<void>,
    fallbackMessage: string,
  ): Promise<void> => {
    const requestPid = pidRef.current;
    if (!requestPid || ingestionInFlight.current) return;
    const generation = ++ingestionGenerationRef.current;
    ingestionInFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      await operation(requestPid);
    } catch (err) {
      if (pidRef.current !== requestPid || ingestionGenerationRef.current !== generation) return;
      setError(err instanceof Error ? err.message : fallbackMessage);
    } finally {
      if (pidRef.current === requestPid && ingestionGenerationRef.current === generation) {
        ingestionInFlight.current = false;
        setBusy(false);
      }
    }
  }, []);

  const handleUpload = useCallback(async (files: File[]) => {
    const requestPid = pidRef.current;
    if (!requestPid || files.length === 0 || ingestionInFlight.current) return;
    const generation = ++ingestionGenerationRef.current;
    ingestionInFlight.current = true;
    setBusy(true);
    setError(null);
    setUploadAttempt({
      projectId: requestPid,
      items: files.map((file) => ({ file, status: "pending" })),
    });

    try {
      const result = await uploadKnowledgeFiles(requestPid, files);
      if (pidRef.current !== requestPid || ingestionGenerationRef.current !== generation) return;
      const errorsByFileName = new Map(result.errors.map((item) => [item.fileName, item.error]));
      const items: UploadAttemptItem[] = files.map((file) => {
        const diagnostic = errorsByFileName.get(file.name);
        return diagnostic
          ? { file, status: "error", diagnostic }
          : { file, status: "success" };
      });
      setUploadAttempt({ projectId: requestPid, items });
      setDocuments((current) => {
        const next = [...current];
        const indexById = new Map(next.map((document, index) => [document.id, index]));
        for (const document of result.documents) {
          const existingIndex = indexById.get(document.id);
          if (existingIndex === undefined) {
            indexById.set(document.id, next.length);
            next.push(document);
          } else {
            next[existingIndex] = document;
          }
        }
        return next;
      });

      const failedCount = items.filter((item) => item.status === "error").length;
      const succeededCount = items.length - failedCount;
      if (failedCount > 0) {
        setAnnouncement(translate(knowledgeMessages, "uploadPartialComplete", {
          succeededCount: formatNumber(succeededCount),
          failedCount: formatNumber(failedCount),
        }));
      } else {
        setAnnouncement(translatePlural(knowledgeMessages, "uploadComplete", result.documents.length, {
          formattedCount: formatNumber(result.documents.length),
        }));
        setAddMode(null);
      }
    } catch (err) {
      if (pidRef.current !== requestPid || ingestionGenerationRef.current !== generation) return;
      const diagnostic = err instanceof Error ? err.message : translate(knowledgeMessages, "uploadFailed");
      setUploadAttempt({
        projectId: requestPid,
        items: files.map((file) => ({ file, status: "error", diagnostic })),
      });
      setAnnouncement(translatePlural(knowledgeMessages, "uploadBatchFailed", files.length, {
        formattedCount: formatNumber(files.length),
      }));
    } finally {
      if (pidRef.current === requestPid && ingestionGenerationRef.current === generation) {
        ingestionInFlight.current = false;
        setBusy(false);
      }
    }
  }, [formatNumber, translate, translatePlural]);

  const onDrop = useCallback((e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const files = e.dataTransfer ? Array.from(e.dataTransfer.files) : [];
    if (files.length > 0) void handleUpload(files);
  }, [handleUpload]);

  const executeDelete = useCallback(async (doc: KnowledgeDocument, requestPid: string): Promise<DeleteOperationOutcome | null> => {
    const currentDocuments = documentsRef.current;
    const restoreIndex = currentDocuments.findIndex((document) => document.id === doc.id);
    if (restoreIndex < 0) return null;
    const currentItems: LibraryItem[] = currentDocuments.map((document) => ({ kind: "document", document }));
    const currentTombstones = Object.values(deletionTombstonesRef.current).sort((a, b) => a.index - b.index);
    for (const currentTombstone of currentTombstones) {
      currentItems.splice(Math.min(currentTombstone.index, currentItems.length), 0, { kind: "deleting", tombstone: currentTombstone });
    }
    const index = currentItems.findIndex((item) => item.kind === "document" && item.document.id === doc.id);
    const operationToken = Symbol(doc.id);
    deleteOperationsRef.current.set(doc.id, operationToken);
    const tombstone: DeletionTombstone = {
      document: doc,
      index,
      restoreIndex,
      nextDocumentId: currentDocuments[restoreIndex + 1]?.id ?? null,
      previousDocumentId: currentDocuments[restoreIndex - 1]?.id ?? null,
    };
    setDocumentFeedback((current) => ({
      ...current,
      [doc.id]: {
        action: "delete",
        status: "pending",
        message: translate(knowledgeMessages, "deletingDocument", { title: doc.title }),
      },
    }));
    setDeletionTombstones((current) => ({ ...current, [doc.id]: tombstone }));
    setDocuments((current) => current.filter((document) => document.id !== doc.id));
    try {
      await deleteKnowledgeDocument(requestPid, doc.id);
      if (pidRef.current !== requestPid || deleteOperationsRef.current.get(doc.id) !== operationToken) return null;
      setDeletionTombstones((current) => {
        const next = { ...current };
        delete next[doc.id];
        return next;
      });
      setDocumentFeedback((current) => {
        const next = { ...current };
        delete next[doc.id];
        return next;
      });
      setAnnouncement(translate(knowledgeMessages, "documentDeleted", { title: doc.title }));
      return { status: "success", tombstone };
    } catch (err) {
      if (pidRef.current !== requestPid || deleteOperationsRef.current.get(doc.id) !== operationToken) return null;
      const diagnostic = err instanceof Error ? err.message : translate(knowledgeMessages, "deleteFailed");
      setDocuments((current) => {
        if (current.some((document) => document.id === doc.id)) return current;
        const next = [...current];
        next.splice(Math.min(tombstone.restoreIndex, next.length), 0, tombstone.document);
        return next;
      });
      setDeletionTombstones((current) => {
        const next = { ...current };
        delete next[doc.id];
        return next;
      });
      setDocumentFeedback((current) => ({
        ...current,
        [doc.id]: {
          action: "delete",
          status: "error",
          message: translate(knowledgeMessages, "deleteFailedForDocument", { title: doc.title }),
          diagnostic,
        },
      }));
      setAnnouncement(translate(knowledgeMessages, "deleteRestored", { title: doc.title }));
      return { status: "error", documentId: doc.id };
    } finally {
      if (deleteOperationsRef.current.get(doc.id) === operationToken) deleteOperationsRef.current.delete(doc.id);
    }
  }, [translate]);

  const confirmPendingDelete = useCallback(async (): Promise<void> => {
    const pending = pendingDeleteConfirmationRef.current;
    if (!pending || pidRef.current !== pending.projectId) {
      deleteConfirm.handleCancel();
      pendingDeleteConfirmationRef.current = null;
      return;
    }

    const outcome = await executeDelete(pending.document, pending.projectId);
    if (pendingDeleteConfirmationRef.current !== pending) return;
    pendingDeleteConfirmationRef.current = null;
    if (!outcome || pidRef.current !== pending.projectId) {
      deleteConfirm.handleCancel();
      return;
    }

    deleteConfirm.handleConfirm();
    const focusDelay = Number.parseFloat(interactionTokens.enterExit.duration) + 20;
    window.setTimeout(() => {
      if (pidRef.current !== pending.projectId) return;
      if (outcome.status === "success") {
        restoreFocusSafely(
          outcome.tombstone.nextDocumentId ? documentFocusRefs.current.get(outcome.tombstone.nextDocumentId) : null,
          outcome.tombstone.previousDocumentId ? documentFocusRefs.current.get(outcome.tombstone.previousDocumentId) : null,
          listHeadingRef.current,
        );
      } else {
        restoreFocusSafely(documentDeleteButtonRefs.current.get(outcome.documentId), listHeadingRef.current);
      }
    }, focusDelay);
  }, [deleteConfirm, executeDelete, interactionTokens.enterExit.duration]);

  const removeDocument = useCallback(async (doc: KnowledgeDocument, trigger: HTMLElement) => {
    const confirmationPid = pidRef.current;
    if (!confirmationPid || pendingDeleteConfirmationRef.current || deleteOperationsRef.current.has(doc.id) || reembedOperationsRef.current.has(doc.id)) return;
    const pending: PendingDeleteConfirmation = { document: doc, projectId: confirmationPid, trigger };
    pendingDeleteConfirmationRef.current = pending;
    deleteConfirm.triggerRef.current = trigger;
    const confirmed = await deleteConfirm.requestConfirm({
      title: translate(knowledgeMessages, "deleteDialogTitle", { title: doc.title }),
      body: translate(knowledgeMessages, "deleteDialogBody", { title: doc.title }),
      confirmLabel: translate(knowledgeMessages, "confirmDelete"),
      cancelLabel: translate(knowledgeMessages, "cancelDelete"),
      destructive: true,
    });
    if (confirmed || pendingDeleteConfirmationRef.current !== pending) return;
    pendingDeleteConfirmationRef.current = null;
    if (pidRef.current !== confirmationPid) return;
    const focusDelay = Number.parseFloat(interactionTokens.enterExit.duration) + 20;
    window.setTimeout(() => {
      if (pidRef.current === confirmationPid) restoreFocusSafely(pending.trigger, listHeadingRef.current);
    }, focusDelay);
  }, [deleteConfirm, interactionTokens.enterExit.duration, translate]);

  const reembed = useCallback(async (doc: KnowledgeDocument) => {
    const requestPid = pidRef.current;
    if (!requestPid || deleteOperationsRef.current.has(doc.id) || reembedOperationsRef.current.has(doc.id)) return;
    const operationToken = Symbol(doc.id);
    reembedOperationsRef.current.set(doc.id, operationToken);
    setDocumentFeedback((current) => ({
      ...current,
      [doc.id]: {
        action: "reembed",
        status: "pending",
        message: translate(knowledgeMessages, "reembeddingDocument", { title: doc.title }),
      },
    }));
    try {
      const updated = await reembedKnowledgeDocument(requestPid, doc.id);
      if (pidRef.current !== requestPid || reembedOperationsRef.current.get(doc.id) !== operationToken) return;
      setDocuments((prev) => prev.map((d) => (d.id === doc.id ? updated : d)));
      setDocumentFeedback((current) => ({
        ...current,
        [doc.id]: {
          action: "reembed",
          status: "success",
          message: translate(knowledgeMessages, "embeddingRetried", { title: doc.title }),
        },
      }));
      setAnnouncement(translate(knowledgeMessages, "embeddingRetried", { title: doc.title }));
    } catch (err) {
      if (pidRef.current !== requestPid || reembedOperationsRef.current.get(doc.id) !== operationToken) return;
      setDocumentFeedback((current) => ({
        ...current,
        [doc.id]: {
          action: "reembed",
          status: "error",
          message: translate(knowledgeMessages, "reembedFailedForDocument", { title: doc.title }),
          diagnostic: err instanceof Error ? err.message : translate(knowledgeMessages, "reembedFailed"),
        },
      }));
    } finally {
      if (reembedOperationsRef.current.get(doc.id) === operationToken) reembedOperationsRef.current.delete(doc.id);
    }
  }, [translate]);

  const libraryItems = useMemo<LibraryItem[]>(() => {
    const items: LibraryItem[] = documents.map((document) => ({ kind: "document", document }));
    const tombstones = Object.values(deletionTombstones).sort((a, b) => a.index - b.index);
    for (const tombstone of tombstones) {
      items.splice(Math.min(tombstone.index, items.length), 0, { kind: "deleting", tombstone });
    }
    return items;
  }, [deletionTombstones, documents]);
  useListReorder(listRef, libraryItems.map((item) => item.kind === "document" ? item.document.id : item.tombstone.document.id));

  const totalChunks = documents.reduce((sum, d) => sum + d.chunkCount, 0);
  const readyCount = documents.filter((d) => d.status === "ready").length;

  return (
    <PageContainer aria-label={translate(knowledgeMessages, "pageLabel")} padding="section" className="gap-8">
      <ConfirmDialog
        isOpen={deleteConfirm.isOpen}
        options={deleteConfirm.options}
        onConfirm={confirmPendingDelete}
        onCancel={deleteConfirm.handleCancel}
        restoreFocus={false}
      />
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{announcement}</p>
      {/* Header */}
      <PageHeader
        icon={Library}
        eyebrow={translate(knowledgeMessages, "eyebrow")}
        title={translate(knowledgeMessages, "title")}
        subtitle={
          <>
            {translate(knowledgeMessages, "subtitleBeforeTool")} <code className="rounded bg-black/[0.05] px-1 py-0.5 font-mono text-[11px] dark:bg-white/[0.06]">{translate(knowledgeMessages, "searchToolName")}</code>{translate(knowledgeMessages, "subtitleAfterTool")}
            {documents.length > 0 && (
              <span className="mt-2 flex flex-wrap items-center gap-2 text-[11px] font-semibold text-slate-400 dark:text-slate-500">
                <span>{translatePlural(knowledgeMessages, "documentCount", documents.length, { formattedCount: formatNumber(documents.length) })}</span>
                <span>·</span>
                <span>{translatePlural(knowledgeMessages, "readyCount", readyCount, { formattedCount: formatNumber(readyCount) })}</span>
                <span>·</span>
                <span>{translatePlural(knowledgeMessages, "chunkCount", totalChunks, { formattedCount: formatNumber(totalChunks) })}</span>
              </span>
            )}
          </>
        }
        actions={
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setUploadAttempt(null);
              setAddMode("upload");
            }}
            disabled={!pid}
            className="inline-flex items-center gap-2 rounded-full bg-signal-500 px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-signal-500/15 transition-all hover:scale-[1.03] hover:bg-signal-400 disabled:cursor-not-allowed disabled:opacity-50 dark:text-void-900"
          >
            <Upload className="h-4 w-4" strokeWidth={2.5} />
            {translate(knowledgeMessages, "upload")}
          </button>
          <button
            type="button"
            onClick={() => setAddMode("paste")}
            disabled={!pid}
            className="inline-flex items-center gap-2 rounded-full border border-black/[0.08] bg-white/60 px-4 py-2.5 text-sm font-bold text-slate-600 transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-200 dark:hover:bg-white/[0.08]"
          >
            <StickyNote className="h-4 w-4" strokeWidth={2.4} />
            {translate(knowledgeMessages, "paste")}
          </button>
          <button
            type="button"
            onClick={() => setAddMode("repo")}
            disabled={!pid}
            className="inline-flex items-center gap-2 rounded-full border border-black/[0.08] bg-white/60 px-4 py-2.5 text-sm font-bold text-slate-600 transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-200 dark:hover:bg-white/[0.08]"
          >
            <FolderGit2 className="h-4 w-4" strokeWidth={2.4} />
            {translate(knowledgeMessages, "fromRepo")}
          </button>
          <button
            type="button"
            onClick={() => setAddMode("project")}
            disabled={!pid || projects.filter((project) => project.id !== pid).length === 0}
            className="inline-flex items-center gap-2 rounded-full border border-black/[0.08] bg-white/60 px-4 py-2.5 text-sm font-bold text-slate-600 transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-200 dark:hover:bg-white/[0.08]"
          >
            <Copy className="h-4 w-4" strokeWidth={2.4} />
            {translate(knowledgeMessages, "fromProject")}
          </button>
          <button
            type="button"
            onClick={() => void loadData()}
            disabled={!pid || loading}
            aria-label={translate(knowledgeMessages, loading ? "refreshing" : "refresh")}
            title={translate(knowledgeMessages, "refresh")}
            className="inline-flex items-center justify-center rounded-full border border-black/[0.08] bg-white/60 p-2.5 text-slate-500 transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-300 dark:hover:bg-white/[0.08]"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin motion-reduce:animate-none" : ""}`} strokeWidth={2.4} />
          </button>
        </div>
        }
      />

      {/* Embedding model gate */}
      {modelActive === false && (
        <div role="status" className="flex items-center gap-3 rounded-2xl border border-amber-400/25 bg-amber-400/[0.06] px-5 py-4 text-sm text-amber-700 dark:text-amber-300">
          <AlertTriangle className="h-5 w-5 shrink-0" strokeWidth={2.2} />
          <span>
            {translate(knowledgeMessages, "noModelBeforeLink")} {" "}
            <a href="/memory" className="font-bold underline">{translate(knowledgeMessages, "memoryPage")}</a>{" "}
            {translate(knowledgeMessages, "noModelAfterLink")}
          </span>
        </div>
      )}

      {error && (
        <div role="alert" className="flex items-start gap-3 rounded-2xl border border-status-red/25 bg-status-red/[0.06] px-5 py-3 text-sm text-status-red">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2.2} />
          <span className="flex-1">{error}</span>
          <button type="button" onClick={() => setError(null)} aria-label={translate(knowledgeMessages, "dismiss")}><X className="h-4 w-4" /></button>
        </div>
      )}

      {uploadAttempt && addMode !== "upload" && (
        <UploadFeedback
          attempt={uploadAttempt}
          busy={busy}
          onDismiss={() => setUploadAttempt(null)}
          onRetry={(files) => void handleUpload(files)}
        />
      )}

      {/* Search test box */}
      {readyCount > 0 && <KnowledgeSearchBox projectId={pid} agentPresets={agentPresets} />}

      {/* Library grid */}
      <h2 id="knowledge-library-heading" ref={listHeadingRef} tabIndex={-1} className="sr-only">{translate(knowledgeMessages, "libraryHeading")}</h2>
      {!pid ? (
        <EmptyState icon={BookOpen} title={translate(knowledgeMessages, "selectProject")} body={translate(knowledgeMessages, "selectProjectBody")} />
      ) : loading && documents.length === 0 ? (
        <div role="status" aria-label={translate(knowledgeMessages, "loadingDocuments")} className="flex items-center justify-center py-24 text-slate-400">
          <Loader2 className="h-6 w-6 animate-spin motion-reduce:animate-none" />
        </div>
      ) : libraryItems.length === 0 ? (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={`flex flex-col items-center gap-4 rounded-[1.8rem] border-2 border-dashed px-8 py-20 text-center transition-colors motion-reduce:transition-none ${dragging ? "border-signal-500 bg-signal-500/[0.05]" : "border-black/[0.08] dark:border-white/[0.08]"}`}
        >
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-signal-500/10 text-signal-500">
            <Sparkles className="h-7 w-7" strokeWidth={2} />
          </div>
          <div className="flex flex-col gap-1">
            <p className="text-lg font-bold text-slate-700 dark:text-slate-200">{translate(knowledgeMessages, "buildKnowledgeBase")}</p>
            <p className="text-sm text-slate-400 dark:text-slate-500">{translate(knowledgeMessages, "emptyLibraryBody")}</p>
            {dragging && <p role="status" className="font-bold text-signal-600 dark:text-signal-400">{translate(knowledgeMessages, "dropFilesHere")}</p>}
          </div>
        </div>
      ) : (
        <div
          ref={listRef}
          aria-labelledby="knowledge-library-heading"
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={`grid grid-cols-1 gap-4 rounded-[1.5rem] transition-colors motion-reduce:transition-none sm:grid-cols-2 xl:grid-cols-3 ${dragging ? "ring-2 ring-signal-500/40" : ""}`}
        >
          {libraryItems.map((item) => {
            if (item.kind === "deleting") {
              const doc = item.tombstone.document;
              return (
                <div
                  key={doc.id}
                  data-flip-id={doc.id}
                  data-motion-contract="asyncFeedback"
                  role="status"
                  aria-live="polite"
                  style={{
                    transitionDuration: interactionTokens.asyncFeedback.duration,
                    transitionTimingFunction: interactionTokens.asyncFeedback.ease,
                  }}
                  className="flex min-h-40 flex-col justify-between gap-4 rounded-2xl border border-status-red/20 bg-status-red/[0.04] p-5 motion-reduce:transition-none dark:bg-status-red/[0.07]"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-slate-700 dark:text-slate-200" title={doc.title}>{doc.title}</p>
                    <p className="mt-1 truncate font-mono text-[10px] text-slate-400" title={doc.sourceRef || ""}>{doc.sourceRef || doc.sourceType}</p>
                  </div>
                  <div className="flex items-center gap-2 text-sm font-semibold text-status-red">
                    <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin motion-reduce:animate-none" />
                    {translate(knowledgeMessages, "deletingDocument", { title: doc.title })}
                  </div>
                </div>
              );
            }
            const doc = item.document;
            const { Icon, cls } = docIcon(doc);
            const subscribers = doc.subscriberAgentIds.map((id) => agentNameById.get(id)?.name).filter(Boolean) as string[];
            const feedback = documentFeedback[doc.id];
            const rowBusy = feedback?.status === "pending";
            return (
              <div
                key={doc.id}
                data-document-id={doc.id}
                data-flip-id={doc.id}
                className="group relative flex flex-col gap-3 rounded-2xl border border-black/[0.06] bg-white/70 p-5 shadow-[0_2px_16px_rgba(0,0,0,0.03)] backdrop-blur-xl transition-all motion-reduce:transition-none hover:shadow-[0_4px_24px_rgba(0,0,0,0.06)] dark:border-white/[0.06] dark:bg-void-800/50"
              >
                <div className="flex items-start gap-3">
                  <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-black/[0.04] dark:bg-white/[0.05] ${cls}`}>
                    <Icon className="h-5 w-5" strokeWidth={2.2} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3
                      ref={(element) => {
                        if (element) documentFocusRefs.current.set(doc.id, element);
                        else documentFocusRefs.current.delete(doc.id);
                      }}
                      tabIndex={-1}
                      className="truncate text-sm font-bold text-slate-800 outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50 dark:text-slate-100"
                      title={doc.title}
                    >
                      {doc.title}
                    </h3>
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
                      {translate(knowledgeMessages, "documentDetails", {
                        size: formatKnowledgeFileSize(doc.byteSize, locale),
                        tokens: formatNumber(doc.tokenCount),
                        date: translate(knowledgeMessages, "updatedDate", {
                          date: formatKnowledgeDate(doc.updatedAt, locale),
                        }),
                      })}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 transition-opacity motion-reduce:transition-none group-hover:opacity-100 group-focus-within:opacity-100">
                    {doc.status === "error" && feedback?.action !== "reembed" && (
                      <button type="button" disabled={rowBusy} onClick={() => void reembed(doc)} aria-label={translate(knowledgeMessages, "retryEmbedding", { title: doc.title })} title={translate(knowledgeMessages, "retryEmbedding", { title: doc.title })} className="rounded-lg p-1.5 text-slate-400 hover:bg-black/[0.05] hover:text-signal-500 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-white/[0.06]">
                        <RefreshCw className="h-3.5 w-3.5" strokeWidth={2.2} />
                      </button>
                    )}
                    <button
                      ref={(element) => {
                        if (element) documentDeleteButtonRefs.current.set(doc.id, element);
                        else documentDeleteButtonRefs.current.delete(doc.id);
                      }}
                      type="button"
                      disabled={rowBusy}
                      onClick={(event) => void removeDocument(doc, event.currentTarget)}
                      aria-label={translate(knowledgeMessages, "deleteDocument", { title: doc.title })}
                      title={translate(knowledgeMessages, "deleteDocument", { title: doc.title })}
                      className="rounded-lg p-1.5 text-slate-400 hover:bg-status-red/10 hover:text-status-red disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Trash2 className="h-3.5 w-3.5" strokeWidth={2.2} />
                    </button>
                  </div>
                </div>

                {feedback && (
                  <div
                    data-motion-contract="asyncFeedback"
                    role={feedback.status === "error" ? "alert" : "status"}
                    style={{
                      transitionDuration: interactionTokens.asyncFeedback.duration,
                      transitionTimingFunction: interactionTokens.asyncFeedback.ease,
                    }}
                    className={`rounded-xl border px-3 py-2 text-[11px] font-semibold motion-reduce:transition-none ${feedback.status === "error"
                      ? "border-status-red/20 bg-status-red/[0.06] text-status-red"
                      : feedback.status === "success"
                        ? "border-status-green/20 bg-status-green/[0.06] text-status-green"
                        : "border-amber-400/20 bg-amber-400/[0.06] text-amber-700 dark:text-amber-300"}`}
                  >
                    <div className="flex items-start gap-2">
                      {feedback.status === "pending" ? <Loader2 aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin motion-reduce:animate-none" /> : feedback.status === "success" ? <Check aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <AlertTriangle aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
                      <span className="min-w-0 flex-1">
                        <span className="block">{feedback.message}</span>
                        {feedback.diagnostic && <span className="mt-0.5 block break-words font-mono font-normal">{feedback.diagnostic}</span>}
                      </span>
                      {feedback.status === "error" && (
                        <button
                          type="button"
                          onClick={(event) => feedback.action === "delete" ? void removeDocument(doc, event.currentTarget) : void reembed(doc)}
                          className="shrink-0 rounded-lg border border-current/20 px-2 py-1 font-bold hover:bg-white/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current"
                        >
                          {translate(knowledgeMessages, feedback.action === "delete" ? "retryDelete" : "retryReembed")}
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {subscribers.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 border-t border-black/[0.05] pt-2.5 dark:border-white/[0.05]">
                    {subscribers.slice(0, 4).map((name) => (
                      <span key={name} className="inline-flex items-center rounded-full bg-signal-500/[0.08] px-2 py-0.5 text-[10px] font-bold text-signal-600 dark:text-signal-400">{name}</span>
                    ))}
                    {subscribers.length > 4 && <span className="text-[10px] font-bold text-slate-400">{translate(knowledgeMessages, "subscriberOverflow", { formattedCount: formatNumber(subscribers.length - 4) })}</span>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {addMode === "upload" && <UploadModal
        busy={busy}
        attempt={uploadAttempt}
        onClose={() => setAddMode(null)}
        onFiles={handleUpload}
        onDismissAttempt={() => setUploadAttempt(null)}
        onRetry={(files) => void handleUpload(files)}
      />}
      {addMode === "paste" && <PasteModal busy={busy} onClose={() => setAddMode(null)} onSubmit={async (title, text) => {
        await runIngestion(async (requestPid) => {
          await addPastedDocument(requestPid, { title, text });
          if (pidRef.current !== requestPid) return;
          await loadData();
          if (pidRef.current !== requestPid) return;
          setAnnouncement(translate(knowledgeMessages, "pasteComplete", { title }));
          setAddMode(null);
        }, translate(knowledgeMessages, "pasteFailed"));
      }} />}
      {addMode === "repo" && <RepoPathModal busy={busy} onClose={() => setAddMode(null)} onSubmit={async (repoPath) => {
        await runIngestion(async (requestPid) => {
          const result = await addRepoPathDocuments(requestPid, repoPath);
          if (pidRef.current !== requestPid) return;
          const diagnostics = result.errors.map((e) => `${e.fileName}: ${e.error}`).join(" · ");
          await loadData();
          if (pidRef.current !== requestPid) return;
          if (diagnostics) setError(diagnostics);
          setAnnouncement(translatePlural(knowledgeMessages, "repoIngestComplete", result.documents.length, {
            formattedCount: formatNumber(result.documents.length),
            path: repoPath,
          }));
          setAddMode(null);
        }, translate(knowledgeMessages, "repoIngestFailed"));
      }} />}
      {addMode === "project" && <ProjectKnowledgeModal
        busy={busy}
        currentProjectId={pid}
        projects={projects}
        onClose={() => setAddMode(null)}
        onSubmit={async (sourceProjectId, documentIds) => {
          await runIngestion(async (requestPid) => {
            const result = await importKnowledgeFromProject(requestPid, { sourceProjectId, documentIds });
            if (pidRef.current !== requestPid) return;
            const diagnostics = result.errors.map((e) => `${e.fileName}: ${e.error}`).join(" · ");
            await loadData();
            if (pidRef.current !== requestPid) return;
            if (diagnostics) setError(diagnostics);
            setAnnouncement(translatePlural(knowledgeMessages, "projectImportComplete", result.documents.length, {
              formattedCount: formatNumber(result.documents.length),
            }));
            setAddMode(null);
          }, translate(knowledgeMessages, "projectImportFailed"));
        }}
      />}
    </PageContainer>
  );
};

/* ── Search test box ── */
const KnowledgeSearchBox: FunctionComponent<{ projectId: string; agentPresets: AgentPreset[] }> = ({ projectId, agentPresets }) => {
  const { locale, formatNumber, translate, translatePlural } = useDashboardI18n();
  const [query, setQuery] = useState("");
  const [agentId, setAgentId] = useState("");
  const [results, setResults] = useState<KnowledgeSearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const searchInFlight = useRef(false);
  const searchGenerationRef = useRef(0);
  const projectIdRef = useRef(projectId);
  projectIdRef.current = projectId;

  useEffect(() => {
    searchGenerationRef.current += 1;
    searchInFlight.current = false;
    setResults(null);
    setSearchError(null);
    setSearching(false);
  }, [projectId]);

  const run = useCallback(async () => {
    if (!query.trim() || searchInFlight.current) return;
    const requestProjectId = projectId;
    const generation = ++searchGenerationRef.current;
    searchInFlight.current = true;
    setSearching(true);
    setSearchError(null);
    try {
      const found = await searchKnowledge(requestProjectId, { query, agentPresetId: agentId || undefined, limit: 6 });
      if (projectIdRef.current !== requestProjectId || searchGenerationRef.current !== generation) return;
      setResults(found);
    } catch (err) {
      if (projectIdRef.current !== requestProjectId || searchGenerationRef.current !== generation) return;
      setSearchError(err instanceof Error ? err.message : translate(knowledgeMessages, "searchFailed"));
      setResults([]);
    } finally {
      if (projectIdRef.current === requestProjectId && searchGenerationRef.current === generation) {
        searchInFlight.current = false;
        setSearching(false);
      }
    }
  }, [projectId, query, agentId, translate]);

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-black/[0.06] bg-white/50 p-4 backdrop-blur-xl dark:border-white/[0.06] dark:bg-white/[0.02]">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => { if (e.key === "Enter") void run(); }}
            placeholder={translate(knowledgeMessages, "searchPlaceholder")}
            aria-label={translate(knowledgeMessages, "searchInputLabel")}
            className="w-full rounded-xl border border-black/[0.08] bg-white/70 py-2.5 pl-9 pr-3 text-sm text-slate-700 outline-none focus:border-signal-500/40 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-200"
          />
        </div>
        <AvantgardeSelect
          value={agentId}
          onChange={setAgentId}
          className="min-w-[12rem]"
          aria-label={translate(knowledgeMessages, "agentSelectorLabel")}
          options={[
            { value: "", label: translate(knowledgeMessages, "wholeLibrary") },
            ...agentPresets.map((preset) => ({ value: preset.id, label: translate(knowledgeMessages, "agentDocuments", { agentName: preset.name }) })),
          ]}
        />
        <button type="button" onClick={run} disabled={searching || !query.trim()} className="inline-flex items-center gap-2 rounded-xl bg-signal-500/90 px-4 py-2.5 text-sm font-bold text-white hover:bg-signal-400 disabled:opacity-50 dark:text-void-900">
          {searching ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <Search className="h-4 w-4" strokeWidth={2.5} />}
          {translate(knowledgeMessages, "search")}
        </button>
      </div>
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {searching
          ? translate(knowledgeMessages, "searching")
          : results
            ? translatePlural(knowledgeMessages, "resultCount", results.length, { formattedCount: formatNumber(results.length) })
            : ""}
      </p>
      {searchError && <p role="alert" className="px-1 text-sm text-status-red">{searchError}</p>}
      {results && (
        <div className="flex flex-col gap-2">
          {results.length === 0 ? (
            <p className="px-1 py-2 text-sm text-slate-400">{translate(knowledgeMessages, "noResults")}</p>
          ) : results.map((r, i) => (
            <div key={i} className="rounded-xl border border-black/[0.05] bg-white/40 p-3 dark:border-white/[0.05] dark:bg-white/[0.02]">
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="truncate text-[11px] font-bold text-signal-600 dark:text-signal-400">
                  {r.documentTitle}{r.heading ? ` › ${r.heading}` : ""}
                </span>
                <span className="shrink-0 font-mono text-[10px] text-slate-400">{formatKnowledgeProgress(r.similarity, locale)}</span>
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
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm" onClick={onClose} onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}>
    <div role="dialog" aria-modal="true" aria-label={title} className="w-full max-w-lg rounded-3xl border border-black/[0.08] bg-white p-6 shadow-2xl dark:border-white/[0.08] dark:bg-void-800" onClick={(e) => e.stopPropagation()}>
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">{title}</h3>
        <ModalCloseButton title={title} onClose={onClose} />
      </div>
      {children}
    </div>
  </div>
);

const ModalCloseButton: FunctionComponent<{ title: string; onClose: () => void }> = ({ title, onClose }) => {
  const { translate } = useDashboardI18n();
  return (
    <button type="button" onClick={onClose} aria-label={translate(knowledgeMessages, "closeDialog", { title })} className="rounded-lg p-1.5 text-slate-400 hover:bg-black/[0.05] dark:hover:bg-white/[0.06]">
      <X className="h-5 w-5" />
    </button>
  );
};

const UploadFeedback: FunctionComponent<{
  attempt: UploadAttempt;
  busy: boolean;
  onDismiss: () => void;
  onRetry: (files: File[]) => void;
}> = ({ attempt, busy, onDismiss, onRetry }) => {
  const { formatNumber, translate, translatePlural } = useDashboardI18n();
  const tokens = useInteractionTokens();
  const pendingItems = attempt.items.filter((item) => item.status === "pending");
  const successfulItems = attempt.items.filter((item) => item.status === "success");
  const failedItems = attempt.items.filter((item) => item.status === "error");

  return (
    <section
      aria-label={translate(knowledgeMessages, "uploadActivity")}
      data-motion-contract="asyncFeedback"
      style={{
        transitionDuration: tokens.asyncFeedback.duration,
        transitionTimingFunction: tokens.asyncFeedback.ease,
      }}
      className="rounded-2xl border border-black/[0.07] bg-white/65 p-4 shadow-sm motion-reduce:transition-none dark:border-white/[0.08] dark:bg-white/[0.03]"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">{translate(knowledgeMessages, "uploadActivity")}</h3>
          <p className="mt-0.5 text-[11px] text-slate-400">
            {translatePlural(knowledgeMessages, "uploadFileCount", attempt.items.length, { formattedCount: formatNumber(attempt.items.length) })}
          </p>
        </div>
        {!busy && (
          <button type="button" onClick={onDismiss} aria-label={translate(knowledgeMessages, "dismissUploadResults")} className="rounded-lg p-1.5 text-slate-400 hover:bg-black/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50 dark:hover:bg-white/[0.06]">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {pendingItems.length > 0 && (
        <div role="status" aria-live="polite" className="mt-3 space-y-1.5">
          {pendingItems.map((item, index) => (
            <div key={`${item.file.name}-${index}`} className="flex items-center gap-2 rounded-xl bg-amber-400/[0.07] px-3 py-2 text-[11px] font-semibold text-amber-700 dark:text-amber-300">
              <Loader2 aria-hidden="true" className="h-3.5 w-3.5 shrink-0 animate-spin motion-reduce:animate-none" />
              <span className="min-w-0 flex-1 truncate" title={item.file.name}>{translate(knowledgeMessages, "uploadFilePending", { fileName: item.file.name })}</span>
              <span role="progressbar" aria-label={translate(knowledgeMessages, "uploadProgressForFile", { fileName: item.file.name })} className="h-1.5 w-16 overflow-hidden rounded-full bg-amber-400/20">
                <span className="block h-full w-2/3 animate-pulse rounded-full bg-amber-500 motion-reduce:animate-none" />
              </span>
            </div>
          ))}
        </div>
      )}

      {successfulItems.length > 0 && (
        <div className="mt-3">
          <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-status-green">{translate(knowledgeMessages, "uploadSucceededHeading")}</p>
          <ul className="mt-1.5 space-y-1">
            {successfulItems.map((item, index) => (
              <li key={`${item.file.name}-${index}`} className="flex items-center gap-2 text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                <Check aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-status-green" />
                <span className="truncate" title={item.file.name}>{item.file.name}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {failedItems.length > 0 && (
        <div role="alert" className="mt-3 rounded-xl border border-status-red/20 bg-status-red/[0.05] p-3">
          <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-status-red">{translate(knowledgeMessages, "uploadFailedHeading")}</p>
          <ul className="mt-1.5 space-y-2">
            {failedItems.map((item, index) => (
              <li key={`${item.file.name}-${index}`} className="text-[11px] text-status-red">
                <span className="block font-bold">{item.file.name}</span>
                {item.diagnostic && <span className="block break-words font-mono">{item.diagnostic}</span>}
              </li>
            ))}
          </ul>
          <button
            type="button"
            disabled={busy}
            onClick={() => onRetry(failedItems.map((item) => item.file))}
            className="mt-3 inline-flex items-center gap-2 rounded-lg border border-status-red/25 bg-white/50 px-3 py-1.5 text-[11px] font-bold text-status-red hover:bg-white disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white/[0.04] dark:hover:bg-white/[0.08]"
          >
            {busy && <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />}
            {translatePlural(knowledgeMessages, "retryFailedUploads", failedItems.length, { formattedCount: formatNumber(failedItems.length) })}
          </button>
        </div>
      )}
    </section>
  );
};

const UploadModal: FunctionComponent<{
  busy: boolean;
  attempt: UploadAttempt | null;
  onClose: () => void;
  onFiles: (files: File[]) => void;
  onDismissAttempt: () => void;
  onRetry: (files: File[]) => void;
}> = ({ busy, attempt, onClose, onFiles, onDismissAttempt, onRetry }) => {
  const { translate } = useDashboardI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <ModalShell title={translate(knowledgeMessages, "uploadDocuments")} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-black/[0.1] py-12 transition-colors motion-reduce:transition-none hover:border-signal-500/50 hover:bg-signal-500/[0.03] disabled:opacity-50 dark:border-white/[0.1]"
        >
          {busy ? <Loader2 className="h-8 w-8 animate-spin text-signal-500 motion-reduce:animate-none" /> : <Upload className="h-8 w-8 text-signal-500" strokeWidth={1.8} />}
          <span className="text-sm font-bold text-slate-600 dark:text-slate-300">{translate(knowledgeMessages, busy ? "uploading" : "chooseFiles")}</span>
          <span className="text-[11px] text-slate-400">{translate(knowledgeMessages, "supportedFiles")}</span>
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          disabled={busy}
          aria-label={translate(knowledgeMessages, "chooseFilesLabel")}
          className="hidden"
          onChange={(e) => {
            const files = Array.from((e.target as HTMLInputElement).files || []);
            if (files.length > 0) onFiles(files);
          }}
        />
        {attempt && <UploadFeedback attempt={attempt} busy={busy} onDismiss={onDismissAttempt} onRetry={onRetry} />}
      </div>
    </ModalShell>
  );
};

const PasteModal: FunctionComponent<{ busy: boolean; onClose: () => void; onSubmit: (title: string, text: string) => void }> = ({ busy, onClose, onSubmit }) => {
  const { translate } = useDashboardI18n();
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  return (
    <ModalShell title={translate(knowledgeMessages, "pasteNote")} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <input
          value={title}
          onInput={(e) => setTitle((e.target as HTMLInputElement).value)}
          placeholder={translate(knowledgeMessages, "noteTitle")}
          aria-label={translate(knowledgeMessages, "noteTitleLabel")}
          className="rounded-xl border border-black/[0.08] bg-white/70 px-3 py-2.5 text-sm outline-none focus:border-signal-500/40 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-200"
        />
        <textarea
          value={text}
          onInput={(e) => setText((e.target as HTMLTextAreaElement).value)}
          placeholder={translate(knowledgeMessages, "noteBody")}
          aria-label={translate(knowledgeMessages, "noteBodyLabel")}
          rows={10}
          className="resize-y rounded-xl border border-black/[0.08] bg-white/70 px-3 py-2.5 font-mono text-[12px] outline-none focus:border-signal-500/40 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-200"
        />
        <button
          type="button"
          disabled={busy || !title.trim() || !text.trim()}
          aria-label={translate(knowledgeMessages, busy ? "addingToLibrary" : "addToLibrary")}
          onClick={() => onSubmit(title.trim(), text)}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-signal-500 px-4 py-2.5 text-sm font-bold text-white hover:bg-signal-400 disabled:opacity-50 dark:text-void-900"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <Plus className="h-4 w-4" strokeWidth={2.5} />}
          {translate(knowledgeMessages, "addToLibrary")}
        </button>
      </div>
    </ModalShell>
  );
};

const RepoPathModal: FunctionComponent<{ busy: boolean; onClose: () => void; onSubmit: (path: string) => void }> = ({ busy, onClose, onSubmit }) => {
  const { translate } = useDashboardI18n();
  const [repoPath, setRepoPath] = useState("");
  return (
    <ModalShell title={translate(knowledgeMessages, "ingestFromRepo")} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <p className="text-[12px] leading-relaxed text-slate-500 dark:text-slate-400">
          {translate(knowledgeMessages, "repoInstructions")}
        </p>
        <input
          value={repoPath}
          onInput={(e) => setRepoPath((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !busy && repoPath.trim()) onSubmit(repoPath.trim()); }}
          placeholder={translate(knowledgeMessages, "repoPathPlaceholder")}
          aria-label={translate(knowledgeMessages, "repoPathLabel")}
          className="rounded-xl border border-black/[0.08] bg-white/70 px-3 py-2.5 font-mono text-sm outline-none focus:border-signal-500/40 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-200"
        />
        <button
          type="button"
          disabled={busy || !repoPath.trim()}
          aria-label={translate(knowledgeMessages, busy ? "ingesting" : "ingest")}
          onClick={() => onSubmit(repoPath.trim())}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-signal-500 px-4 py-2.5 text-sm font-bold text-white hover:bg-signal-400 disabled:opacity-50 dark:text-void-900"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <FolderGit2 className="h-4 w-4" strokeWidth={2.4} />}
          {translate(knowledgeMessages, "ingest")}
        </button>
      </div>
    </ModalShell>
  );
};

const ProjectKnowledgeModal: FunctionComponent<{
  busy: boolean;
  currentProjectId: string;
  projects: Source[];
  onClose: () => void;
  onSubmit: (sourceProjectId: string, documentIds: string[]) => void;
}> = ({ busy, currentProjectId, projects, onClose, onSubmit }) => {
  const { formatNumber, translate } = useDashboardI18n();
  const translateRef = useRef(translate);
  translateRef.current = translate;
  const sourceProjects = projects.filter((project) => project.id !== currentProjectId);
  const [sourceProjectId, setSourceProjectId] = useState(sourceProjects[0]?.id || "");
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!sourceProjectId) {
      setDocuments([]);
      setSelectedIds(new Set());
      return;
    }
    let cancelled = false;
    setLoadingDocs(true);
    setLoadError(null);
    fetchKnowledgeDocuments(sourceProjectId)
      .then((docs) => {
        if (cancelled) return;
        setDocuments(docs);
        setSelectedIds(new Set(docs.map((doc) => doc.id)));
      })
      .catch((err) => {
        if (cancelled) return;
        setDocuments([]);
        setSelectedIds(new Set());
        setLoadError(err instanceof Error ? err.message : translateRef.current(knowledgeMessages, "projectDocumentsLoadFailed"));
      })
      .finally(() => {
        if (!cancelled) setLoadingDocs(false);
      });
    return () => { cancelled = true; };
  }, [sourceProjectId]);

  const toggle = (documentId: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(documentId)) next.delete(documentId);
      else next.add(documentId);
      return next;
    });
  };

  return (
    <ModalShell title={translate(knowledgeMessages, "importFromProject")} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <AvantgardeSelect
          value={sourceProjectId}
          onChange={setSourceProjectId}
          aria-label={translate(knowledgeMessages, "sourceProjectLabel")}
          options={sourceProjects.map((project) => ({ value: project.id, label: project.name }))}
        />

        <div className="flex max-h-72 flex-col gap-2 overflow-y-auto rounded-2xl border border-black/[0.06] bg-black/[0.02] p-2 dark:border-white/[0.06] dark:bg-white/[0.02]">
          {loadingDocs ? (
            <div role="status" aria-label={translate(knowledgeMessages, "loadingProjectDocuments")} className="flex items-center justify-center py-10 text-slate-400"><Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" /></div>
          ) : loadError ? (
            <p role="alert" className="px-2 py-8 text-center text-sm text-status-red">{loadError}</p>
          ) : documents.length === 0 ? (
            <p className="px-2 py-8 text-center text-sm text-slate-400">{translate(knowledgeMessages, "noProjectDocuments")}</p>
          ) : documents.map((doc) => {
            const checked = selectedIds.has(doc.id);
            return (
              <button
                key={doc.id}
                type="button"
                onClick={() => toggle(doc.id)}
                aria-pressed={checked}
                aria-label={translate(knowledgeMessages, "selectDocument", { title: doc.title })}
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors motion-reduce:transition-none ${checked ? "bg-signal-500/[0.08]" : "hover:bg-white/60 dark:hover:bg-white/[0.04]"}`}
              >
                <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg ${checked ? "bg-signal-500 text-white dark:text-void-900" : "bg-black/[0.05] text-slate-400 dark:bg-white/[0.06]"}`}>
                  {checked ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : <FileText className="h-3.5 w-3.5" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold text-slate-700 dark:text-slate-200">{doc.title}</span>
                  <span className="block truncate text-[11px] text-slate-400 dark:text-slate-500">{doc.summary || doc.sourceRef || doc.sourceType}</span>
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            disabled={documents.length === 0}
            onClick={() => setSelectedIds(selectedIds.size === documents.length ? new Set() : new Set(documents.map((doc) => doc.id)))}
            className="rounded-xl border border-black/[0.08] px-3 py-2 text-[12px] font-bold text-slate-500 hover:bg-white disabled:opacity-50 dark:border-white/[0.08] dark:text-slate-300 dark:hover:bg-white/[0.06]"
          >
            {translate(knowledgeMessages, selectedIds.size === documents.length ? "clear" : "selectAll")}
          </button>
          <button
            type="button"
            disabled={busy || !sourceProjectId || selectedIds.size === 0}
            onClick={() => onSubmit(sourceProjectId, [...selectedIds])}
            aria-label={translate(knowledgeMessages, busy ? "importing" : "importSelected", { formattedCount: formatNumber(selectedIds.size) })}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-signal-500 px-4 py-2.5 text-sm font-bold text-white hover:bg-signal-400 disabled:opacity-50 dark:text-void-900"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <Copy className="h-4 w-4" strokeWidth={2.4} />}
            {translate(knowledgeMessages, "importSelected", { formattedCount: selectedIds.size ? formatNumber(selectedIds.size) : "" })}
          </button>
        </div>
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
