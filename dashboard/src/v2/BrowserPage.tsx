import type { FunctionComponent } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import gsap from "gsap";
import {
  Compass,
  ExternalLink,
  Play,
  RefreshCw,
  RotateCcw,
  Save,
  Square,
  FileCode2,
} from "lucide-preact";
import { useProjectData } from "./context/project-data.js";
import { useSprints } from "../hooks/useSprints.js";
import type { SprintPreviewScript, SprintPreviewSession } from "../types.js";
import {
  fetchPreviewLogs,
  fetchPreviewScript,
  rebuildPreviewSession,
  savePreviewScript,
  startPreviewSession,
  stopPreviewSession,
} from "./lib/browser-api.js";
import { normalizePath, buildPreviewOrigin } from "./lib/preview-origin.js";
import { usePreviewSessions } from "./hooks/use-preview-sessions.js";
import { PreviewSessionSlider } from "./components/browser/PreviewSessionSlider.js";
import { PreviewWindowChrome } from "./components/browser/PreviewWindowChrome.js";

const PREVIEW_MESSAGE_TYPE = "sprint-preview:state";
const PREVIEW_NAVIGATION_TYPE = "sprint-preview:navigate";

const formatPortMapping = (session: SprintPreviewSession): string => {
  const sourcePort = typeof session.containerAppPort === "number" ? session.containerAppPort : null;
  const routedPort = typeof session.hostPort === "number" ? session.hostPort : null;
  if (sourcePort && routedPort) {
    return `:${sourcePort} -> :${routedPort}`;
  }
  if (sourcePort) {
    return `:${sourcePort} -> pending`;
  }
  if (routedPort) {
    return `pending -> :${routedPort}`;
  }
  return "port pending";
};



export const BrowserPage: FunctionComponent = () => {
  const shellRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const { selectedProject } = useProjectData();
  const { data: sprints, selectedSprint, selectedSprintId } = useSprints(selectedProject?.id || null);

  const [script, setScript] = useState<SprintPreviewScript | null>(null);
  const [scriptDraft, setScriptDraft] = useState("");
  const [logs, setLogs] = useState("");

  const [mutating, setMutating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addressValue, setAddressValue] = useState("/");
  const [currentPath, setCurrentPath] = useState("/");
  const [showScriptEditor, setShowScriptEditor] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  useEffect(() => {
    if (shellRef.current) {
      gsap.fromTo(shellRef.current, { y: 20, opacity: 0 }, { y: 0, opacity: 1, duration: 0.7, ease: "power3.out" });
    }
  }, []);

  const { sessions, selectedSession, loading, error: fetchError, refresh: refreshSessions } = usePreviewSessions({
    projectId: selectedProject?.id || null,
    selectedSprintId,
    activeSessionId,
  });

  useEffect(() => {
    if (fetchError) {
      setError(fetchError);
    } else {
      setError(null);
    }
  }, [fetchError]);

  const scriptTargetSprint = useMemo(() => {
    if (selectedSession) {
      return sprints.find((sprint) => sprint.id === selectedSession.sprintId) || null;
    }
    return selectedSprint || null;
  }, [selectedSession, selectedSprint, sprints]);

  useEffect(() => {
    if (selectedSession) {
      setActiveSessionId(selectedSession.id);
      const nextPath = normalizePath(selectedSession.lastKnownPath || "/");
      setCurrentPath(nextPath);
      setAddressValue(nextPath);
    }
  }, [selectedSession?.id]);

  useEffect(() => {
    if (!selectedProject || !scriptTargetSprint) {
      setScript(null);
      setScriptDraft("");
      return;
    }
    void fetchPreviewScript(selectedProject.id, scriptTargetSprint.id)
      .then((data) => {
        setScript(data);
        setScriptDraft(data.content);
      })
      .catch((fetchError) => {
        setError(fetchError instanceof Error ? fetchError.message : String(fetchError));
      });
  }, [selectedProject?.id, scriptTargetSprint?.id]);

  useEffect(() => {
    if (!selectedSession) {
      setLogs("");
      return;
    }
    void fetchPreviewLogs(selectedSession.id, 160)
      .then((result) => setLogs(result.logs))
      .catch(() => setLogs(""));
  }, [selectedSession?.id]);

  useEffect(() => {
    if (!selectedSession) {
      return;
    }
    const timer = window.setInterval(() => {
      void fetchPreviewLogs(selectedSession.id, 160)
        .then((result) => setLogs(result.logs))
        .catch(() => undefined);
    }, 8000);
    return () => window.clearInterval(timer);
  }, [selectedSession?.id]);

  useEffect(() => {
    const handlePreviewMessage = (event: MessageEvent) => {
      if (!selectedSession) {
        return;
      }
      if (event.origin !== buildPreviewOrigin(selectedSession.id)) {
        return;
      }
      const payload = event.data as { type?: string; path?: string } | null;
      if (!payload || payload.type !== PREVIEW_MESSAGE_TYPE) {
        return;
      }
      const nextPath = normalizePath(payload.path || "/");
      setCurrentPath(nextPath);
      setAddressValue(nextPath);
    };

    window.addEventListener("message", handlePreviewMessage);
    return () => window.removeEventListener("message", handlePreviewMessage);
  }, [selectedSession?.id]);

  const currentFrameSrc = selectedSession
    ? `${buildPreviewOrigin(selectedSession.id)}${normalizePath(currentPath)}`
    : "";

  const postNavigationCommand = (action: "back" | "forward" | "reload" | "push", path?: string) => {
    if (!selectedSession || !frameRef.current?.contentWindow) {
      return;
    }
    frameRef.current.contentWindow.postMessage({
      type: PREVIEW_NAVIGATION_TYPE,
      action,
      path,
    }, buildPreviewOrigin(selectedSession.id));
  };

  const handleStart = async () => {
    if (!selectedProject || !selectedSprint) return;
    setMutating(true);
    try {
      const session = await startPreviewSession(selectedProject.id, selectedSprint.id);
      setActiveSessionId(session.id);
      await refreshSessions(true);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : String(actionError));
    } finally {
      setMutating(false);
    }
  };

  const handleRebuild = async () => {
    if (!selectedSession) return;
    setMutating(true);
    try {
      await rebuildPreviewSession(selectedSession.id);
      await refreshSessions(true);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : String(actionError));
    } finally {
      setMutating(false);
    }
  };

  const handleStop = async () => {
    if (!selectedSession) return;
    setMutating(true);
    try {
      await stopPreviewSession(selectedSession.id);
      await refreshSessions(true);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : String(actionError));
    } finally {
      setMutating(false);
    }
  };

  const handleSaveScript = async () => {
    if (!selectedProject || !scriptTargetSprint) return;
    setMutating(true);
    try {
      const nextScript = await savePreviewScript(selectedProject.id, scriptTargetSprint.id, scriptDraft);
      setScript(nextScript);
      setShowScriptEditor(false);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : String(actionError));
    } finally {
      setMutating(false);
    }
  };

  const navigate = () => {
    const nextPath = normalizePath(addressValue);
    setCurrentPath(nextPath);
    setAddressValue(nextPath);
    postNavigationCommand("push", nextPath);
  };

  const sessionCards = sessions.filter((session) => !selectedProject || session.projectId === selectedProject.id);

  if (!selectedProject) {
    return (
      <div className="p-8">
        <div className="rounded-[2rem] border border-black/[0.06] bg-white/60 p-8 text-sm text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.04] dark:text-slate-300">
          Select a project first. The in-app browser launches one isolated preview container per sprint.
        </div>
      </div>
    );
  }

  return (
    <div ref={shellRef} className="min-h-full px-6 py-6 md:px-8">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-signal-500/20 bg-signal-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-signal-500">
            <Compass className="h-3.5 w-3.5" strokeWidth={2} />
            Sprint Browser
          </div>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-900 dark:text-white">
            Build previews per sprint, isolated by container.
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500 dark:text-slate-400">
            Each sprint preview runs from its own exported sprint snapshot and container, bound to a private host port and surfaced through the in-app browser.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void refreshSessions()}
            className="inline-flex h-11 items-center gap-2 rounded-2xl border border-black/[0.08] bg-white/70 px-4 text-sm font-semibold text-slate-700 transition hover:border-black/[0.16] hover:text-slate-900 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-200 dark:hover:border-white/[0.16] dark:hover:text-white"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} strokeWidth={2} />
            Refresh
          </button>
          <button
            type="button"
            onClick={handleStart}
            disabled={!selectedSprint || mutating}
            className="inline-flex h-11 items-center gap-2 rounded-2xl bg-signal-500 px-4 text-sm font-semibold text-void-900 transition hover:bg-signal-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Play className="h-4 w-4" strokeWidth={2.2} />
            Start Preview
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-5 rounded-2xl border border-status-red/20 bg-status-red/10 px-4 py-3 text-sm text-status-red">
          {error}
        </div>
      )}

      <div className="mb-5">
        <PreviewSessionSlider
          sessions={sessionCards}
          selectedSessionId={activeSessionId}
          onSelectSession={setActiveSessionId}
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <PreviewWindowChrome
          session={selectedSession}
          onNavigateBack={() => postNavigationCommand("back")}
          onNavigateForward={() => postNavigationCommand("forward")}
          onReload={() => postNavigationCommand("reload")}
          addressValue={addressValue}
          onAddressChange={setAddressValue}
          onAddressSubmit={(value) => {
            const nextPath = normalizePath(value);
            setCurrentPath(nextPath);
            setAddressValue(nextPath);
            postNavigationCommand("push", nextPath);
          }}
        >
          {selectedSession && (
            <iframe
              ref={frameRef}
              title={`Sprint preview ${selectedSession.sprintName}`}
              src={currentFrameSrc}
              className="h-full w-full border-0 bg-white"
            />
          )}
        </PreviewWindowChrome>

        <div className="space-y-5">
          <div className="rounded-[2rem] border border-black/[0.06] bg-white/70 p-5 shadow-[0_20px_60px_rgba(15,23,42,0.06)] dark:border-white/[0.06] dark:bg-white/[0.03] dark:shadow-[0_20px_60px_rgba(0,0,0,0.24)]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Selected Sprint</div>
                <div className="mt-2 text-lg font-semibold text-slate-900 dark:text-white">
                  {scriptTargetSprint?.name || "All sprints"}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowScriptEditor((value) => !value)}
                className="inline-flex h-10 items-center gap-2 rounded-2xl border border-black/[0.08] px-3 text-xs font-semibold text-slate-600 transition hover:border-black/[0.16] hover:text-slate-900 dark:border-white/[0.08] dark:text-slate-300 dark:hover:border-white/[0.16] dark:hover:text-white"
              >
                <FileCode2 className="h-4 w-4" strokeWidth={2} />
                Script
              </button>
            </div>
            <div className="mt-4 space-y-3 text-sm">
              {selectedSession && (
                <div className="rounded-2xl border border-black/[0.06] bg-black/[0.02] px-4 py-3 dark:border-white/[0.06] dark:bg-white/[0.03]">
                  <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Port routing</div>
                  <div className="mt-1 font-mono text-[12px] text-slate-700 dark:text-slate-300">{formatPortMapping(selectedSession)}</div>
                </div>
              )}
              <div className="rounded-2xl border border-black/[0.06] bg-black/[0.02] px-4 py-3 dark:border-white/[0.06] dark:bg-white/[0.03]">
                <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Script path</div>
                <div className="mt-1 break-all font-mono text-[12px] text-slate-700 dark:text-slate-300">{script?.path || "Loading..."}</div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={handleRebuild}
                  disabled={!selectedSession || mutating}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-2xl border border-black/[0.08] text-xs font-semibold text-slate-700 transition hover:border-black/[0.16] hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.08] dark:text-slate-200 dark:hover:border-white/[0.16] dark:hover:text-white"
                >
                  <RotateCcw className="h-4 w-4" strokeWidth={2} />
                  Rebuild
                </button>
                <button
                  type="button"
                  onClick={handleStop}
                  disabled={!selectedSession || mutating}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-2xl border border-black/[0.08] text-xs font-semibold text-slate-700 transition hover:border-black/[0.16] hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.08] dark:text-slate-200 dark:hover:border-white/[0.16] dark:hover:text-white"
                >
                  <Square className="h-4 w-4" strokeWidth={2} />
                  Stop
                </button>
                <a
                  href={currentFrameSrc || undefined}
                  target="_blank"
                  rel="noreferrer"
                  className={`inline-flex h-10 items-center justify-center gap-2 rounded-2xl border border-black/[0.08] text-xs font-semibold text-slate-700 transition hover:border-black/[0.16] hover:text-slate-900 dark:border-white/[0.08] dark:text-slate-200 dark:hover:border-white/[0.16] dark:hover:text-white ${!currentFrameSrc ? "pointer-events-none opacity-50" : ""}`}
                >
                  <ExternalLink className="h-4 w-4" strokeWidth={2} />
                  Open
                </a>
              </div>
            </div>
          </div>

          <div className="rounded-[2rem] border border-black/[0.06] bg-white/70 p-5 shadow-[0_20px_60px_rgba(15,23,42,0.06)] dark:border-white/[0.06] dark:bg-white/[0.03] dark:shadow-[0_20px_60px_rgba(0,0,0,0.24)]">
            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Runtime notes</div>
            <div className="mt-4 space-y-3 text-sm text-slate-600 dark:text-slate-300">
              <p>Ports are assigned from the sprint preview range and bound to `127.0.0.1` to avoid conflicts with the main dashboard.</p>
              <p>Each preview container runs from a dedicated sprint snapshot directory, so multiple active sprints from the same project stay isolated without registering git worktrees.</p>
            </div>
          </div>

          {showScriptEditor && (
            <div className="rounded-[2rem] border border-black/[0.06] bg-white/70 p-5 shadow-[0_20px_60px_rgba(15,23,42,0.06)] dark:border-white/[0.06] dark:bg-white/[0.03] dark:shadow-[0_20px_60px_rgba(0,0,0,0.24)]">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Startup script</div>
                  <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">
                    {script?.mode === "script" ? "Custom file" : "Auto-generated fallback"}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleSaveScript}
                  disabled={mutating || !scriptTargetSprint}
                  className="inline-flex h-10 items-center gap-2 rounded-2xl bg-slate-900 px-4 text-xs font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100"
                >
                  <Save className="h-4 w-4" strokeWidth={2} />
                  Save
                </button>
              </div>
              <textarea
                value={scriptDraft}
                onInput={(event) => setScriptDraft((event.currentTarget as HTMLTextAreaElement).value)}
                className="h-72 w-full rounded-[1.5rem] border border-black/[0.08] bg-[#f7f3ea] p-4 font-mono text-[12px] leading-6 text-slate-800 outline-none transition focus:border-signal-500/40 dark:border-white/[0.08] dark:bg-[#05080d] dark:text-slate-100"
              />
            </div>
          )}

          <div className="rounded-[2rem] border border-black/[0.06] bg-white/70 p-5 shadow-[0_20px_60px_rgba(15,23,42,0.06)] dark:border-white/[0.06] dark:bg-white/[0.03] dark:shadow-[0_20px_60px_rgba(0,0,0,0.24)]">
            <div className="mb-3 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Container logs</div>
            <pre className="max-h-[360px] overflow-auto rounded-[1.5rem] bg-[#f7f3ea] p-4 font-mono text-[11px] leading-6 text-slate-700 dark:bg-[#05080d] dark:text-slate-300">
              {logs || "No logs yet."}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
};
