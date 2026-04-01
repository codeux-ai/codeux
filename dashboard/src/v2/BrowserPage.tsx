import type { FunctionComponent } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import gsap from "gsap";
import {
  Compass,
  ExternalLink,
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
  removePreviewSession,
  rebuildPreviewSession,
  savePreviewScript,
  startPreviewSession,
  stopPreviewSession,
} from "./lib/browser-api.js";
import { normalizePath, buildPreviewOrigin } from "./lib/preview-origin.js";
import { usePreviewSessions } from "./hooks/use-preview-sessions.js";
import { useProjectEffectiveSettings } from "./hooks/use-project-effective-settings.js";
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

const buildPathTabLabel = (path: string, sprintName: string): string => {
  const normalized = normalizePath(path);
  if (normalized === "/") {
    return sprintName;
  }
  const trimmed = normalized.replace(/\/$/, "");
  const segment = trimmed.split("/").filter(Boolean).at(-1) || sprintName;
  return segment.length > 18 ? `${segment.slice(0, 18)}...` : segment;
};

const isPreviewSessionReady = (session: SprintPreviewSession | null): boolean => (
  Boolean(session && session.status === "running" && session.healthStatus === "healthy" && session.hostPort)
);

const getStandbyCopy = (session: SprintPreviewSession | null): { title: string; description: string } => {
  if (!session) {
    return {
      title: "No preview active",
      description: "Launch a container from the rail to open the sprint inside the in-app browser.",
    };
  }

  if (session.status === "starting") {
    return {
      title: "Container is starting",
      description: "Sprint OS is waiting for the preview container to become reachable. The browser will reconnect as soon as it is ready.",
    };
  }

  if (session.status === "stopped") {
    return {
      title: "Container is stopped",
      description: "This preview container is not running right now. Start it again or rebuild it to restore the in-app browser.",
    };
  }

  return {
    title: "Container is unavailable",
    description: session.lastError?.trim()
      || "The preview container is down or still warming up. Start or rebuild it to bring the browser back online.",
  };
};



export const BrowserPage: FunctionComponent = () => {
  const shellRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const currentPathRef = useRef("/");
  const previousReadyRef = useRef<{ sessionId: string | null; ready: boolean }>({ sessionId: null, ready: false });
  const { selectedProject } = useProjectData();
  const { data: sprints, selectedSprint, selectedSprintId } = useSprints(selectedProject?.id || null);
  const { data: effectiveSettings } = useProjectEffectiveSettings(selectedProject?.id || null);

  const [script, setScript] = useState<SprintPreviewScript | null>(null);
  const [scriptDraft, setScriptDraft] = useState("");
  const [logs, setLogs] = useState("");

  const [launching, setLaunching] = useState(false);
  const [sessionActionPending, setSessionActionPending] = useState(false);
  const [savingScript, setSavingScript] = useState(false);
  const [removingSessionIds, setRemovingSessionIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [addressValue, setAddressValue] = useState("/");
  const [currentPath, setCurrentPath] = useState("/");
  const [showScriptEditor, setShowScriptEditor] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [launchSprintId, setLaunchSprintId] = useState("");
  const [frameSrc, setFrameSrc] = useState("");
  const [frameKey, setFrameKey] = useState(0);
  const [sessionTabs, setSessionTabs] = useState<Record<string, string[]>>({});

  useEffect(() => {
    if (shellRef.current) {
      gsap.fromTo(shellRef.current, { y: 20, opacity: 0 }, { y: 0, opacity: 1, duration: 0.7, ease: "power3.out" });
    }
  }, []);

  const { sessions, selectedSession, loading, error: fetchError, refresh: refreshSessions } = usePreviewSessions({
    projectId: selectedProject?.id || null,
    selectedSprintId,
    activeSessionId,
    pollInterval: 2000,
  });

  useEffect(() => {
    if (fetchError) {
      setError(fetchError);
    } else {
      setError(null);
    }
  }, [fetchError]);

  useEffect(() => {
    const fallbackSprintId = selectedSprint?.id || sprints[0]?.id || "";
    setLaunchSprintId((current) => {
      if (current && sprints.some((sprint) => sprint.id === current)) {
        return current;
      }
      return fallbackSprintId;
    });
  }, [selectedSprint?.id, sprints]);

  const removingSessionIdSet = useMemo(() => new Set(removingSessionIds), [removingSessionIds]);
  const previewEnabled = effectiveSettings?.settings.sprintPreview.enabled ?? true;
  const showInAppBrowser = effectiveSettings?.settings.sprintPreview.showInAppBrowser ?? true;
  const launchEnabled = previewEnabled && showInAppBrowser;
  const visibleSelectedSession = selectedSession && !removingSessionIdSet.has(selectedSession.id)
    ? selectedSession
    : null;
  const sessionReady = isPreviewSessionReady(visibleSelectedSession);
  const activeTabs = useMemo(() => {
    if (!visibleSelectedSession) {
      return [];
    }
    return (sessionTabs[visibleSelectedSession.id] || [normalizePath(currentPath)]).map((path) => ({
      path,
      label: buildPathTabLabel(path, visibleSelectedSession.sprintName),
    }));
  }, [currentPath, sessionTabs, visibleSelectedSession]);

  const scriptTargetSprint = useMemo(() => {
    if (visibleSelectedSession) {
      return sprints.find((sprint) => sprint.id === visibleSelectedSession.sprintId) || null;
    }
    return selectedSprint || null;
  }, [visibleSelectedSession, selectedSprint, sprints]);

  useEffect(() => {
    if (visibleSelectedSession) {
      setActiveSessionId(visibleSelectedSession.id);
      const nextPath = normalizePath(visibleSelectedSession.lastKnownPath || "/");
      currentPathRef.current = nextPath;
      setCurrentPath(nextPath);
      setAddressValue(nextPath);
      setSessionTabs((current) => (
        current[visibleSelectedSession.id]
          ? current
          : { ...current, [visibleSelectedSession.id]: [nextPath] }
      ));
    }
  }, [visibleSelectedSession?.id]);

  useEffect(() => {
    currentPathRef.current = currentPath;
    if (!visibleSelectedSession) {
      return;
    }
    setSessionTabs((current) => {
      const existing = current[visibleSelectedSession.id] || [];
      if (existing.includes(currentPath)) {
        return current;
      }
      return {
        ...current,
        [visibleSelectedSession.id]: [...existing, currentPath].slice(-8),
      };
    });
  }, [currentPath, visibleSelectedSession?.id]);

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
    if (!visibleSelectedSession) {
      setLogs("");
      return;
    }
    void fetchPreviewLogs(visibleSelectedSession.id, 160)
      .then((result) => setLogs(result.logs))
      .catch(() => setLogs(""));
  }, [visibleSelectedSession?.id]);

  useEffect(() => {
    if (!visibleSelectedSession) {
      return;
    }
    const timer = window.setInterval(() => {
      void fetchPreviewLogs(visibleSelectedSession.id, 160)
        .then((result) => setLogs(result.logs))
        .catch(() => undefined);
    }, 8000);
    return () => window.clearInterval(timer);
  }, [visibleSelectedSession?.id]);

  useEffect(() => {
    const handlePreviewMessage = (event: MessageEvent) => {
      if (!visibleSelectedSession) {
        return;
      }
      if (event.origin !== buildPreviewOrigin(visibleSelectedSession.id)) {
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
  }, [visibleSelectedSession?.id]);

  useEffect(() => {
    const sessionId = visibleSelectedSession?.id || null;
    const ready = sessionReady;
    const becameReady = Boolean(sessionId && ready && (previousReadyRef.current.sessionId !== sessionId || !previousReadyRef.current.ready));

    if (becameReady && visibleSelectedSession) {
      setFrameSrc(`${buildPreviewOrigin(visibleSelectedSession.id)}${normalizePath(currentPathRef.current)}`);
      setFrameKey((current) => current + 1);
    }

    if (!sessionId) {
      setFrameSrc("");
    }

    previousReadyRef.current = { sessionId, ready };
  }, [sessionReady, visibleSelectedSession?.id]);

  const postNavigationCommand = (action: "back" | "forward" | "reload" | "push", path?: string) => {
    if (!visibleSelectedSession || !frameRef.current?.contentWindow) {
      return;
    }
    frameRef.current.contentWindow.postMessage({
      type: PREVIEW_NAVIGATION_TYPE,
      action,
      path,
    }, buildPreviewOrigin(visibleSelectedSession.id));
  };

  const reloadFrame = (path = currentPathRef.current) => {
    if (!visibleSelectedSession || !isPreviewSessionReady(visibleSelectedSession)) {
      return;
    }
    setFrameSrc(`${buildPreviewOrigin(visibleSelectedSession.id)}${normalizePath(path)}`);
    setFrameKey((current) => current + 1);
  };

  const handleStart = async (sprintId = launchSprintId) => {
    if (!selectedProject || !sprintId) return;
    if (!previewEnabled) {
      setError("Browser Preview is disabled for this project.");
      return;
    }
    setLaunching(true);
    try {
      const session = await startPreviewSession(selectedProject.id, sprintId);
      setActiveSessionId(session.id);
      await refreshSessions(true);
      if (session.id === visibleSelectedSession?.id) {
        reloadFrame();
      }
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : String(actionError));
    } finally {
      setLaunching(false);
    }
  };

  const handleRebuild = async () => {
    if (!visibleSelectedSession) return;
    if (!previewEnabled) {
      setError("Browser Preview is disabled for this project.");
      return;
    }
    setSessionActionPending(true);
    try {
      await rebuildPreviewSession(visibleSelectedSession.id);
      await refreshSessions(true);
      reloadFrame();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : String(actionError));
    } finally {
      setSessionActionPending(false);
    }
  };

  const handleStop = async () => {
    if (!visibleSelectedSession) return;
    setSessionActionPending(true);
    try {
      await stopPreviewSession(visibleSelectedSession.id);
      await refreshSessions(true);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : String(actionError));
    } finally {
      setSessionActionPending(false);
    }
  };

  const handleRemove = async (sessionId: string) => {
    if (removingSessionIdSet.has(sessionId)) {
      return;
    }
    setRemovingSessionIds((current) => [...current, sessionId]);
    if (activeSessionId === sessionId) {
      setActiveSessionId(null);
      setLogs("");
      setCurrentPath("/");
      setAddressValue("/");
    }
    try {
      await removePreviewSession(sessionId);
      await refreshSessions(true);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : String(actionError));
    } finally {
      setRemovingSessionIds((current) => current.filter((id) => id !== sessionId));
    }
  };

  const handleSaveScript = async () => {
    if (!selectedProject || !scriptTargetSprint) return;
    setSavingScript(true);
    try {
      const nextScript = await savePreviewScript(selectedProject.id, scriptTargetSprint.id, scriptDraft);
      setScript(nextScript);
      setShowScriptEditor(false);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : String(actionError));
    } finally {
      setSavingScript(false);
    }
  };

  const navigate = () => {
    const nextPath = normalizePath(addressValue);
    setCurrentPath(nextPath);
    setAddressValue(nextPath);
    if (sessionReady) {
      postNavigationCommand("push", nextPath);
    }
  };

  const sessionCards = sessions.filter((session) =>
    (!selectedProject || session.projectId === selectedProject.id) && !removingSessionIdSet.has(session.id)
  );

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
          sprints={sprints}
          selectedSessionId={activeSessionId}
          launchSprintId={launchSprintId}
          onSelectSession={setActiveSessionId}
          onLaunchSprintChange={setLaunchSprintId}
          onLaunchContainer={() => void handleStart()}
          onRemoveSession={(sessionId) => void handleRemove(sessionId)}
          launchEnabled={launchEnabled}
          launchBusy={launching}
          removingSessionIds={removingSessionIds}
        />
      </div>

      {(!showInAppBrowser || !previewEnabled) && (
        <div className="rounded-[2rem] border border-black/[0.06] bg-white/70 p-8 text-sm text-slate-500 shadow-[0_20px_60px_rgba(15,23,42,0.06)] dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-slate-300 dark:shadow-[0_20px_60px_rgba(0,0,0,0.24)]">
          <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Browser Preview</div>
          <div className="mt-3 text-lg font-semibold text-slate-900 dark:text-white">
            {!previewEnabled ? "Preview runtime is disabled." : "In-app browser workspace is hidden."}
          </div>
          <p className="mt-2 max-w-2xl leading-6">
            {!previewEnabled
              ? "Enable `Preview runtime enabled` in Browser Preview settings to launch and rebuild preview containers again."
              : "Enable `Show in-app browser workspace` in Browser Preview settings to restore the embedded browser surface in the dashboard."}
          </p>
        </div>
      )}

      {showInAppBrowser && previewEnabled && (
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <PreviewWindowChrome
          session={visibleSelectedSession}
          onNavigateBack={() => postNavigationCommand("back")}
          onNavigateForward={() => postNavigationCommand("forward")}
          onReload={() => postNavigationCommand("reload")}
          addressValue={addressValue}
          onAddressChange={setAddressValue}
          onAddressSubmit={(_value) => navigate()}
          tabs={activeTabs}
          activeTabPath={currentPath}
          onSelectTab={(path) => {
            const nextPath = normalizePath(path);
            setCurrentPath(nextPath);
            setAddressValue(nextPath);
            if (sessionReady) {
              postNavigationCommand("push", nextPath);
            }
          }}
          navigationEnabled={sessionReady}
        >
          {visibleSelectedSession && sessionReady && (
            <iframe
              key={`${visibleSelectedSession.id}:${frameKey}`}
              ref={frameRef}
              title={`Sprint preview ${visibleSelectedSession.sprintName}`}
              src={frameSrc}
              className="h-full w-full border-0 bg-white"
            />
          )}
          {(!visibleSelectedSession || !sessionReady) && (
            <div className="flex h-full flex-col items-center justify-center px-8 text-center">
              <Compass className="h-12 w-12 text-slate-300 dark:text-slate-600" strokeWidth={1.5} />
              <h2 className="mt-4 text-xl font-semibold text-slate-800 dark:text-slate-100">
                {getStandbyCopy(visibleSelectedSession).title}
              </h2>
              <p className="mt-2 max-w-xl text-sm leading-6 text-slate-500 dark:text-slate-400">
                {getStandbyCopy(visibleSelectedSession).description}
              </p>
              {visibleSelectedSession && (
                <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                  <button
                    type="button"
                    onClick={() => void handleStart(visibleSelectedSession.sprintId)}
                    disabled={launching}
                    className="inline-flex h-11 items-center justify-center rounded-2xl bg-signal-500 px-5 text-sm font-semibold text-void-900 transition hover:bg-signal-400 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Start Container
                  </button>
                  <button
                    type="button"
                    onClick={handleRebuild}
                    disabled={sessionActionPending || launching}
                    className="inline-flex h-11 items-center justify-center rounded-2xl border border-black/[0.08] px-5 text-sm font-semibold text-slate-700 transition hover:border-black/[0.16] hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.08] dark:text-slate-200 dark:hover:border-white/[0.16] dark:hover:text-white"
                  >
                    Rebuild Container
                  </button>
                </div>
              )}
            </div>
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
              {visibleSelectedSession && (
                <div className="rounded-2xl border border-black/[0.06] bg-black/[0.02] px-4 py-3 dark:border-white/[0.06] dark:bg-white/[0.03]">
                  <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Port routing</div>
                  <div className="mt-1 font-mono text-[12px] text-slate-700 dark:text-slate-300">{formatPortMapping(visibleSelectedSession)}</div>
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
                  disabled={!visibleSelectedSession || sessionActionPending}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-2xl border border-black/[0.08] text-xs font-semibold text-slate-700 transition hover:border-black/[0.16] hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.08] dark:text-slate-200 dark:hover:border-white/[0.16] dark:hover:text-white"
                >
                  <RotateCcw className="h-4 w-4" strokeWidth={2} />
                  Rebuild
                </button>
                <button
                  type="button"
                  onClick={handleStop}
                  disabled={!visibleSelectedSession || sessionActionPending}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-2xl border border-black/[0.08] text-xs font-semibold text-slate-700 transition hover:border-black/[0.16] hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.08] dark:text-slate-200 dark:hover:border-white/[0.16] dark:hover:text-white"
                >
                  <Square className="h-4 w-4" strokeWidth={2} />
                  Stop
                </button>
                <a
                  href={sessionReady && visibleSelectedSession ? `${buildPreviewOrigin(visibleSelectedSession.id)}${normalizePath(currentPath)}` : undefined}
                  target="_blank"
                  rel="noreferrer"
                  className={`inline-flex h-10 items-center justify-center gap-2 rounded-2xl border border-black/[0.08] text-xs font-semibold text-slate-700 transition hover:border-black/[0.16] hover:text-slate-900 dark:border-white/[0.08] dark:text-slate-200 dark:hover:border-white/[0.16] dark:hover:text-white ${!sessionReady ? "pointer-events-none opacity-50" : ""}`}
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
                  disabled={savingScript || !scriptTargetSprint}
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
      )}
    </div>
  );
};
