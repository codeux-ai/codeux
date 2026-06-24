import type { FunctionComponent } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import {
  FolderTree,
  GitCompare,
  Loader2,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  Server,
  Square,
  Columns2,
  Rows2,
  GitBranch,
} from "lucide-preact";
import { useProjectData } from "./context/project-data.js";
import { useSprints } from "../hooks/useSprints.js";
import { useIsDark } from "./hooks/use-is-dark.js";
import { useFileBrowserSessions } from "./hooks/use-file-browser-sessions.js";
import {
  fetchFileBrowserChanges,
  fetchFileBrowserDiff,
  fetchFileBrowserFile,
  fetchFileBrowserTree,
  rebuildFileBrowserSession,
  removeFileBrowserSession,
  startFileBrowserSession,
  stopFileBrowserSession,
} from "./lib/file-browser-api.js";
import type {
  FileBrowserChangeSet,
  FileBrowserDiff,
  FileBrowserFileContent,
  FileBrowserSession,
  FileBrowserTree as FileBrowserTreeType,
} from "../types.js";
import { PageContainer } from "./components/layout/PageContainer.js";
import { FileTree } from "./components/file-browser/FileTree.js";
import { FileViewer } from "./components/file-browser/FileViewer.js";
import { ChangesList } from "./components/file-browser/ChangesList.js";
import { DiffViewer } from "./components/file-browser/DiffViewer.js";

type BrowserMode = "files" | "changes";

const STATUS_PILL: Record<FileBrowserSession["status"], { label: string; dot: string; text: string }> = {
  running: { label: "Running", dot: "bg-status-green shadow-[0_0_8px_rgba(34,197,94,0.7)]", text: "text-status-green" },
  starting: { label: "Starting", dot: "bg-ember-500 animate-pulse", text: "text-ember-500" },
  stopped: { label: "Stopped", dot: "bg-slate-400", text: "text-slate-400" },
  error: { label: "Error", dot: "bg-status-red", text: "text-status-red" },
};

export const FileBrowserPage: FunctionComponent = () => {
  const { selectedProject } = useProjectData();
  const { data: sprints, selectedSprint, selectedSprintId } = useSprints(selectedProject?.id || null);
  const isDark = useIsDark();

  const [mode, setMode] = useState<BrowserMode>("files");
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [launchSprintId, setLaunchSprintId] = useState("");
  const [sideBySide, setSideBySide] = useState(true);
  const [treeSearch, setTreeSearch] = useState("");
  const [error, setError] = useState<string | null>(null);

  const [launching, setLaunching] = useState(false);
  const [actionPending, setActionPending] = useState(false);

  const [tree, setTree] = useState<FileBrowserTreeType | null>(null);
  const [treeLoading, setTreeLoading] = useState(false);

  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [file, setFile] = useState<FileBrowserFileContent | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

  const [changes, setChanges] = useState<FileBrowserChangeSet | null>(null);
  const [changesLoading, setChangesLoading] = useState(false);
  const [selectedChangePath, setSelectedChangePath] = useState<string | null>(null);
  const [diff, setDiff] = useState<FileBrowserDiff | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);

  const autoStartedSprintRef = useRef<string | null>(null);

  const { sessions, selectedSession, loading, error: fetchError, refresh } = useFileBrowserSessions({
    projectId: selectedProject?.id || null,
    selectedSprintId,
    activeSessionId,
  });

  useEffect(() => {
    setError(fetchError);
  }, [fetchError]);

  useEffect(() => {
    const fallback = selectedSprint?.id || sprints[0]?.id || "";
    setLaunchSprintId((current) => (current && sprints.some((s) => s.id === current) ? current : fallback));
  }, [selectedSprint?.id, sprints]);

  const runningSession = selectedSession && selectedSession.status === "running" ? selectedSession : null;
  const sessionSprintName = useMemo(() => {
    if (!selectedSession) return null;
    return sprints.find((sprint) => sprint.id === selectedSession.sprintId)?.name || selectedSession.sprintName;
  }, [selectedSession, sprints]);

  // Start the container on demand the first time a sprint's file browser is opened.
  useEffect(() => {
    if (!selectedProject || !selectedSprintId || loading || launching) {
      return;
    }
    const existing = sessions.find((session) => session.sprintId === selectedSprintId);
    if (existing && (existing.status === "running" || existing.status === "starting")) {
      autoStartedSprintRef.current = selectedSprintId;
      return;
    }
    if (autoStartedSprintRef.current === selectedSprintId) {
      return;
    }
    autoStartedSprintRef.current = selectedSprintId;
    void handleStart(selectedSprintId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProject?.id, selectedSprintId, sessions, loading]);

  // Load the file tree whenever the running session changes.
  useEffect(() => {
    if (!runningSession) {
      setTree(null);
      return;
    }
    let cancelled = false;
    setTreeLoading(true);
    void fetchFileBrowserTree(runningSession.id)
      .then((data) => {
        if (!cancelled) setTree(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setTreeLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [runningSession?.id, runningSession?.lastBuildAt]);

  // Reset file selection when the session changes.
  useEffect(() => {
    setSelectedFilePath(null);
    setFile(null);
    setFileError(null);
    setSelectedChangePath(null);
    setDiff(null);
    setDiffError(null);
  }, [runningSession?.id]);

  // Load selected file content.
  useEffect(() => {
    if (!runningSession || !selectedFilePath) {
      setFile(null);
      return;
    }
    let cancelled = false;
    setFileLoading(true);
    setFileError(null);
    void fetchFileBrowserFile(runningSession.id, selectedFilePath)
      .then((data) => {
        if (!cancelled) setFile(data);
      })
      .catch((err) => {
        if (!cancelled) {
          setFile(null);
          setFileError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!cancelled) setFileLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [runningSession?.id, selectedFilePath]);

  // Load the change set when entering changes mode or rebuilding.
  useEffect(() => {
    if (!runningSession || mode !== "changes") {
      return;
    }
    let cancelled = false;
    setChangesLoading(true);
    void fetchFileBrowserChanges(runningSession.id)
      .then((data) => {
        if (cancelled) return;
        setChanges(data);
        if (data.files.length > 0) {
          setSelectedChangePath((current) =>
            current && data.files.some((f) => f.path === current) ? current : data.files[0].path,
          );
        } else {
          setSelectedChangePath(null);
          setDiff(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setChangesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [runningSession?.id, runningSession?.lastBuildAt, mode]);

  // Load diff for the selected changed file.
  useEffect(() => {
    if (!runningSession || mode !== "changes" || !selectedChangePath) {
      setDiff(null);
      return;
    }
    let cancelled = false;
    setDiffLoading(true);
    setDiffError(null);
    void fetchFileBrowserDiff(runningSession.id, selectedChangePath)
      .then((data) => {
        if (!cancelled) setDiff(data);
      })
      .catch((err) => {
        if (!cancelled) {
          setDiff(null);
          setDiffError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!cancelled) setDiffLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [runningSession?.id, selectedChangePath, mode]);

  const handleStart = async (sprintId = launchSprintId) => {
    if (!selectedProject || !sprintId) return;
    setLaunching(true);
    setError(null);
    try {
      const session = await startFileBrowserSession(selectedProject.id, sprintId);
      setActiveSessionId(session.id);
      await refresh(true);
    } catch (err) {
      setError(`Failed to start file browser: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLaunching(false);
    }
  };

  const handleRebuild = async () => {
    if (!selectedSession) return;
    setActionPending(true);
    setError(null);
    try {
      await rebuildFileBrowserSession(selectedSession.id);
      await refresh(true);
    } catch (err) {
      setError(`Failed to rebuild: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setActionPending(false);
    }
  };

  const handleStop = async () => {
    if (!selectedSession) return;
    setActionPending(true);
    setError(null);
    try {
      await stopFileBrowserSession(selectedSession.id);
      await removeFileBrowserSession(selectedSession.id).catch(() => undefined);
      // Keep the auto-start guard set so a manual stop is not immediately undone by
      // the on-visit auto-start. The launch panel offers an explicit restart.
      setActiveSessionId(null);
      setTree(null);
      setChanges(null);
      await refresh(true);
    } catch (err) {
      setError(`Failed to stop: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setActionPending(false);
    }
  };

  if (!selectedProject) {
    return (
      <PageContainer padding="workbench">
        <div class="rounded-[1.75rem] border border-black/[0.06] bg-white/72 p-8 text-sm text-slate-600 shadow-[0_16px_44px_rgba(15,23,42,0.06)] backdrop-blur-xl dark:border-white/[0.07] dark:bg-void-900/45 dark:text-slate-300">
          Select a project to open the sprint file browser. The workspace launches one containerized snapshot of the selected sprint branch.
        </div>
      </PageContainer>
    );
  }

  const statusPill = selectedSession ? STATUS_PILL[selectedSession.status] : null;
  const changeCount = changes?.files.length ?? 0;

  return (
    <PageContainer padding="workbench" className="min-h-full" data-testid="file-browser-page-root">
      <div class="mb-6 flex flex-wrap items-end justify-between gap-4" data-testid="file-browser-page-header">
        <div>
          <div class="inline-flex items-center gap-2 rounded-full border border-signal-500/20 bg-signal-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-signal-600 dark:text-signal-400">
            <FolderTree class="h-3.5 w-3.5" strokeWidth={2} />
            Sprint File Browser
          </div>
          <div class="relative overflow-hidden mt-3">
            <h2 aria-hidden class="absolute -top-10 -left-3 text-[7rem] font-black tracking-tighter text-black/[0.04] dark:text-white/[0.03] pointer-events-none select-none font-display leading-none">
              FILES
            </h2>
            <h1 class="font-display text-5xl font-black tracking-tighter text-slate-900 dark:text-white leading-[0.92] relative z-10 md:text-7xl">
              Browse and Diff the Sprint Branch.
            </h1>
          </div>
          <p class="mt-3 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300 md:text-[15px]">
            A single containerized snapshot of the active sprint rebuilds automatically as tasks merge. Inspect every file
            and review what changed versus the default branch — all without leaving the dashboard.
          </p>
        </div>
        <div class="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => void refresh()}
            class="inline-flex h-11 items-center gap-2 rounded-2xl border border-black/[0.08] bg-white/78 px-4 text-sm font-semibold text-slate-700 shadow-[0_10px_24px_rgba(15,23,42,0.05)] backdrop-blur-md transition hover:-translate-y-px hover:border-black/[0.16] hover:text-slate-900 dark:border-white/[0.08] dark:bg-white/[0.05] dark:text-slate-200 dark:hover:border-white/[0.16] dark:hover:text-white"
          >
            <RefreshCw class={`h-4 w-4 ${loading ? "animate-spin" : ""}`} strokeWidth={2} />
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div class="mb-5 rounded-2xl border border-status-red/25 bg-status-red/[0.12] px-4 py-3 text-sm text-status-red dark:border-status-red/30 dark:bg-status-red/[0.14]">
          {error}
        </div>
      )}

      {/* Control bar */}
      <div class="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-[1.5rem] border border-black/[0.06] bg-white/74 px-4 py-3 shadow-[0_12px_30px_rgba(15,23,42,0.05)] backdrop-blur-md dark:border-white/[0.07] dark:bg-void-900/42">
        <div class="flex flex-wrap items-center gap-3">
          {statusPill && (
            <span class="inline-flex items-center gap-2 rounded-full border border-black/[0.06] bg-black/[0.02] px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.14em] dark:border-white/[0.08] dark:bg-white/[0.03]">
              <span class={`h-2 w-2 rounded-full ${statusPill.dot}`} />
              <span class={statusPill.text}>{statusPill.label}</span>
            </span>
          )}
          <span class="inline-flex items-center gap-1.5 text-[12px] font-medium text-slate-500 dark:text-slate-400">
            <Server class="h-3.5 w-3.5" strokeWidth={2} />
            {sessionSprintName || selectedSprint?.name || "No sprint"}
          </span>
          {selectedSession?.featureBranch && (
            <span class="inline-flex items-center gap-1.5 rounded-lg border border-black/[0.06] bg-white/75 px-2 py-1 font-mono text-[11px] text-slate-600 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-300">
              <GitBranch class="h-3 w-3 text-signal-600 dark:text-signal-400" strokeWidth={2.2} />
              {selectedSession.featureBranch}
            </span>
          )}
        </div>

        <div class="flex items-center gap-2">
          {/* Mode toggle */}
          <div class="flex items-center rounded-xl border border-black/[0.08] bg-black/[0.02] p-0.5 dark:border-white/[0.08] dark:bg-white/[0.03]">
            <button
              type="button"
              onClick={() => setMode("files")}
              class={`inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition ${
                mode === "files"
                  ? "bg-signal-500/14 text-signal-700 dark:text-signal-300"
                  : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white"
              }`}
            >
              <FolderTree class="h-3.5 w-3.5" strokeWidth={2} />
              Files
            </button>
            <button
              type="button"
              onClick={() => setMode("changes")}
              class={`inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition ${
                mode === "changes"
                  ? "bg-signal-500/14 text-signal-700 dark:text-signal-300"
                  : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white"
              }`}
            >
              <GitCompare class="h-3.5 w-3.5" strokeWidth={2} />
              Changes
              {changeCount > 0 && (
                <span class="ml-0.5 rounded-full bg-signal-500/20 px-1.5 text-[10px] font-bold text-signal-700 dark:text-signal-200">
                  {changeCount}
                </span>
              )}
            </button>
          </div>

          <button
            type="button"
            onClick={handleRebuild}
            disabled={!selectedSession || actionPending}
            class="inline-flex h-9 items-center gap-2 rounded-xl border border-black/[0.08] bg-white/75 px-3 text-xs font-semibold text-slate-700 transition hover:-translate-y-px hover:border-black/[0.16] hover:text-slate-900 disabled:cursor-not-allowed disabled:border-black/[0.06] disabled:bg-black/[0.03] disabled:text-slate-400 disabled:opacity-100 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-slate-200 dark:hover:border-white/[0.16] dark:hover:text-white dark:disabled:bg-white/[0.02] dark:disabled:text-slate-500"
          >
            <RotateCcw class={`h-3.5 w-3.5 ${actionPending ? "animate-spin" : ""}`} strokeWidth={2} />
            Rebuild
          </button>
          <button
            type="button"
            onClick={handleStop}
            disabled={!selectedSession || actionPending}
            class="inline-flex h-9 items-center gap-2 rounded-xl border border-black/[0.08] bg-white/75 px-3 text-xs font-semibold text-slate-700 transition hover:-translate-y-px hover:border-status-red/35 hover:text-status-red disabled:cursor-not-allowed disabled:border-black/[0.06] disabled:bg-black/[0.03] disabled:text-slate-400 disabled:opacity-100 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-slate-200 dark:disabled:bg-white/[0.02] dark:disabled:text-slate-500"
          >
            <Square class="h-3.5 w-3.5" strokeWidth={2} />
            Stop
          </button>
        </div>
      </div>

      {!runningSession ? (
        <LaunchPanel
          launching={launching || selectedSession?.status === "starting"}
          sprints={sprints}
          launchSprintId={launchSprintId}
          onLaunchSprintChange={setLaunchSprintId}
          onLaunch={() => void handleStart()}
          lastError={selectedSession?.status === "error" ? selectedSession.lastError : null}
        />
      ) : (
        <div class="grid h-[calc(100vh-340px)] min-h-[520px] grid-cols-1 gap-5 lg:grid-cols-[340px_minmax(0,1fr)]" data-testid="file-browser-main-tool-panel">
          {/* Sidebar panel */}
          <div class="flex min-h-0 flex-col overflow-hidden rounded-[1.5rem] border border-black/[0.06] bg-white/74 shadow-[0_12px_30px_rgba(15,23,42,0.05)] backdrop-blur-md dark:border-white/[0.07] dark:bg-void-900/42">
            {mode === "files" ? (
              <>
                <div class="border-b border-black/[0.05] p-3 dark:border-white/[0.05]">
                  <div class="flex items-center gap-2 rounded-xl border border-black/[0.08] bg-black/[0.02] px-3 dark:border-white/[0.08] dark:bg-white/[0.03]">
                    <Search class="h-3.5 w-3.5 text-slate-400" strokeWidth={2} />
                    <input
                      type="text"
                      value={treeSearch}
                      onInput={(event) => setTreeSearch((event.currentTarget as HTMLInputElement).value)}
                      placeholder="Filter files…"
                      class="h-9 flex-1 bg-transparent text-[13px] text-slate-700 outline-none placeholder:text-slate-400 dark:text-slate-200"
                    />
                  </div>
                </div>
                <div class="min-h-0 flex-1 p-2">
                  {treeLoading ? (
                    <div class="flex h-full items-center justify-center gap-2 text-sm text-slate-500">
                      <Loader2 class="h-4 w-4 animate-spin text-signal-500" strokeWidth={2} />
                      Indexing files…
                    </div>
                  ) : tree && tree.root.length > 0 ? (
                    <FileTree
                      nodes={tree.root}
                      selectedPath={selectedFilePath}
                      onSelectFile={setSelectedFilePath}
                      searchTerm={treeSearch}
                    />
                  ) : (
                    <div class="flex h-full items-center justify-center p-6 text-center text-sm text-slate-500">
                      No files found in this snapshot.
                    </div>
                  )}
                </div>
                {tree?.truncated && (
                  <div class="border-t border-black/[0.05] px-3 py-2 text-[11px] text-ember-500 dark:border-white/[0.05]">
                    Large workspace — file tree was truncated.
                  </div>
                )}
              </>
            ) : (
              <>
                <div class="flex items-center justify-between border-b border-black/[0.05] px-4 py-3 dark:border-white/[0.05]">
                  <div class="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">
                    Changed files
                  </div>
                  {changesLoading && <Loader2 class="h-3.5 w-3.5 animate-spin text-signal-500" strokeWidth={2} />}
                </div>
                <div class="min-h-0 flex-1">
                  {changes && !changes.available ? (
                    <div class="flex h-full items-center justify-center p-6 text-center text-sm text-slate-500">
                      {changes.reason || "Diff unavailable for this sprint."}
                    </div>
                  ) : (
                    <ChangesList
                      files={changes?.files ?? []}
                      selectedPath={selectedChangePath}
                      onSelect={setSelectedChangePath}
                    />
                  )}
                </div>
                {changes?.available && (
                  <div class="border-t border-black/[0.05] px-4 py-2 font-mono text-[11px] text-slate-400 dark:border-white/[0.05]">
                    {changes.featureBranch} ↔ {changes.defaultBranch}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Viewer panel */}
          <div class="flex min-h-0 flex-col overflow-hidden rounded-[1.5rem] border border-black/[0.06] bg-white/74 shadow-[0_12px_30px_rgba(15,23,42,0.05)] backdrop-blur-md dark:border-white/[0.07] dark:bg-void-900/46">
            <div class="flex items-center justify-between gap-3 border-b border-black/[0.05] px-4 py-2.5 dark:border-white/[0.06]">
              <div class="min-w-0 truncate font-mono text-[12px] text-slate-500 dark:text-slate-400">
                {mode === "files"
                  ? selectedFilePath || "No file selected"
                  : selectedChangePath || "No file selected"}
              </div>
              {mode === "changes" && (
                <button
                  type="button"
                  onClick={() => setSideBySide((value) => !value)}
                  class="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-black/[0.08] bg-white/75 px-2.5 text-[11px] font-semibold text-slate-600 transition hover:text-slate-900 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-slate-300 dark:hover:text-white"
                  title={sideBySide ? "Switch to inline diff" : "Switch to side-by-side diff"}
                >
                  {sideBySide ? <Columns2 class="h-3.5 w-3.5" strokeWidth={2} /> : <Rows2 class="h-3.5 w-3.5" strokeWidth={2} />}
                  {sideBySide ? "Split" : "Inline"}
                </button>
              )}
            </div>
            <div class="min-h-0 flex-1">
              {mode === "files" ? (
                <FileViewer file={file} loading={fileLoading} error={fileError} isDark={isDark} />
              ) : (
                <DiffViewer diff={diff} loading={diffLoading} error={diffError} isDark={isDark} sideBySide={sideBySide} />
              )}
            </div>
          </div>
        </div>
      )}
    </PageContainer>
  );
};

interface LaunchPanelProps {
  launching: boolean;
  sprints: Array<{ id: string; name: string }>;
  launchSprintId: string;
  onLaunchSprintChange: (value: string) => void;
  onLaunch: () => void;
  lastError: string | null;
}

const LaunchPanel: FunctionComponent<LaunchPanelProps> = ({
  launching,
  sprints,
  launchSprintId,
  onLaunchSprintChange,
  onLaunch,
  lastError,
}) => (
  <div class="relative flex flex-col items-center justify-center overflow-hidden rounded-[1.75rem] border border-black/[0.06] bg-white/74 px-8 py-20 text-center shadow-[0_22px_54px_rgba(15,23,42,0.08)] backdrop-blur-xl dark:border-white/[0.07] dark:bg-void-900/46">
    <div class="relative z-10 flex max-w-md flex-col items-center gap-5">
      <div class="flex h-16 w-16 items-center justify-center rounded-3xl border border-signal-500/20 bg-signal-500/[0.12] text-signal-600 ring-1 ring-inset ring-signal-500/20 dark:text-signal-300">
        {launching ? <Loader2 class="h-7 w-7 animate-spin" strokeWidth={2} /> : <FolderTree class="h-7 w-7" strokeWidth={1.8} />}
      </div>
      <div>
        <div class="text-[10px] font-bold uppercase tracking-[0.2em] text-signal-600 dark:text-signal-400">Workspace Snapshot</div>
        <h2 class="mt-2 font-display text-3xl font-black tracking-tight text-slate-900 dark:text-white">
          {launching ? "Starting file browser…" : "Launch the file browser"}
        </h2>
        <p class="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
          {launching
            ? "Exporting the feature branch snapshot into a containerized workspace."
            : "Spin up a single containerized snapshot of the selected sprint to browse files and review diffs."}
        </p>
      </div>

      {lastError && (
        <div class="w-full rounded-xl border border-status-red/25 bg-status-red/[0.12] px-3 py-2 text-xs text-status-red dark:border-status-red/30 dark:bg-status-red/[0.14]">
          {lastError}
        </div>
      )}

      <div class="flex w-full flex-col items-stretch gap-2 sm:flex-row">
        <select
          value={launchSprintId}
          onChange={(event) => onLaunchSprintChange((event.currentTarget as HTMLSelectElement).value)}
          disabled={launching}
          class="h-11 flex-1 rounded-2xl border border-black/[0.08] bg-white/85 px-4 text-sm font-medium text-slate-700 outline-none transition focus:border-signal-500/40 disabled:cursor-not-allowed disabled:border-black/[0.06] disabled:bg-black/[0.03] disabled:text-slate-400 disabled:opacity-100 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-200 dark:disabled:bg-white/[0.02] dark:disabled:text-slate-500"
        >
          {sprints.length === 0 && <option value="">No sprints available</option>}
          {sprints.map((sprint) => (
            <option key={sprint.id} value={sprint.id}>
              {sprint.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={onLaunch}
          disabled={launching || !launchSprintId}
          class="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-signal-500 px-6 text-sm font-bold text-void-950 shadow-[0_12px_30px_rgba(0,224,160,0.22)] transition hover:-translate-y-px hover:bg-signal-400 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600 disabled:shadow-none disabled:opacity-100 dark:disabled:bg-slate-700 dark:disabled:text-slate-300"
        >
          <Play class="h-4 w-4" strokeWidth={2.4} />
          Open file browser
        </button>
      </div>
    </div>
  </div>
);
