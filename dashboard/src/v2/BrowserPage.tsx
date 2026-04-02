import type { FunctionComponent } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
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

export const BrowserPage: FunctionComponent = () => {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const currentPathRef = useRef("/");
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
  const navigationEnabled = Boolean(visibleSelectedSession && visibleSelectedSession.status === "running" && visibleSelectedSession.hostPort);

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
      setFrameSrc(`${buildPreviewOrigin(visibleSelectedSession.id)}${nextPath}`);
      setFrameKey((current) => current + 1);
      return;
    }
    setFrameSrc("");
  }, [visibleSelectedSession?.id]);

  useEffect(() => {
    currentPathRef.current = currentPath;
  }, [currentPath]);

  useEffect(() => {
    if (!visibleSelectedSession || !frameSrc) {
      return;
    }
    setFrameSrc(`${buildPreviewOrigin(visibleSelectedSession.id)}${normalizePath(currentPathRef.current)}`);
    setFrameKey((current) => current + 1);
  }, [visibleSelectedSession?.status, visibleSelectedSession?.hostPort]);

  useEffect(() => {
    if (!selectedProject || !scriptTargetSprint) {
      setScript(null);
      setScriptDraft("");
      return;
    }
    if (!showScriptEditor) {
      return;
    }
    if (script?.projectId === selectedProject.id && script.sprintId === scriptTargetSprint.id) {
      if (!scriptDraft) {
        setScriptDraft(script.content);
      }
      return;
    }
    let cancelled = false;
    void fetchPreviewScript(selectedProject.id, scriptTargetSprint.id)
      .then((data) => {
        if (cancelled) {
          return;
        }
        setScript(data);
        setScriptDraft(data.content);
      })
      .catch((fetchError) => {
        if (cancelled) {
          return;
        }
        setError(fetchError instanceof Error ? fetchError.message : String(fetchError));
      });
    return () => {
      cancelled = true;
    };
  }, [script?.content, script?.projectId, script?.sprintId, scriptDraft, selectedProject?.id, scriptTargetSprint?.id, showScriptEditor]);

  useEffect(() => {
    if (!visibleSelectedSession) {
      setLogs("");
      return;
    }
    let cancelled = false;
    const deferredFetch = window.setTimeout(() => {
      void fetchPreviewLogs(visibleSelectedSession.id, 160)
        .then((result) => {
          if (!cancelled) {
            setLogs(result.logs);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setLogs("");
          }
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(deferredFetch);
    };
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
    if (!visibleSelectedSession) {
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
      setFrameSrc(`${buildPreviewOrigin(session.id)}${normalizePath(currentPathRef.current)}`);
      setFrameKey((current) => current + 1);
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
    if (navigationEnabled) {
      postNavigationCommand("push", nextPath);
    } else if (visibleSelectedSession) {
      setFrameSrc(`${buildPreviewOrigin(visibleSelectedSession.id)}${nextPath}`);
      setFrameKey((current) => current + 1);
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
    <div className="min-h-full px-6 py-6 md:px-8">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-signal-500/20 bg-signal-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-signal-500">
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
          <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Browser Preview</div>
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
          onReload={() => {
            if (navigationEnabled) {
              postNavigationCommand("reload");
            } else {
              reloadFrame();
            }
          }}
          addressValue={addressValue}
          onAddressChange={setAddressValue}
          onAddressSubmit={(_value) => navigate()}
          navigationEnabled={navigationEnabled}
        >
          {visibleSelectedSession && frameSrc && (
            <iframe
              key={`${visibleSelectedSession.id}:${frameKey}`}
              ref={frameRef}
              title={`Sprint preview ${visibleSelectedSession.sprintName}`}
              src={frameSrc}
              className="h-full w-full border-0 bg-white"
            />
          )}
        </PreviewWindowChrome>

        <div className="space-y-5">
          <div className="rounded-[2rem] border border-black/[0.06] bg-white/70 p-5 shadow-[0_20px_60px_rgba(15,23,42,0.06)] dark:border-white/[0.06] dark:bg-white/[0.03] dark:shadow-[0_20px_60px_rgba(0,0,0,0.24)]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Selected Sprint</div>
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
                <div className="mt-1 break-all font-mono text-[12px] text-slate-700 dark:text-slate-300">
                  {script?.path || visibleSelectedSession?.startupScriptPath || "Open editor to load script"}
                </div>
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
                  href={visibleSelectedSession ? `${buildPreviewOrigin(visibleSelectedSession.id)}${normalizePath(currentPath)}` : undefined}
                  target="_blank"
                  rel="noreferrer"
                  className={`inline-flex h-10 items-center justify-center gap-2 rounded-2xl border border-black/[0.08] text-xs font-semibold text-slate-700 transition hover:border-black/[0.16] hover:text-slate-900 dark:border-white/[0.08] dark:text-slate-200 dark:hover:border-white/[0.16] dark:hover:text-white ${!visibleSelectedSession ? "pointer-events-none opacity-50" : ""}`}
                >
                  <ExternalLink className="h-4 w-4" strokeWidth={2} />
                  Open
                </a>
              </div>
            </div>
          </div>

          <div className="rounded-[2rem] border border-black/[0.06] bg-white/70 p-5 shadow-[0_20px_60px_rgba(15,23,42,0.06)] dark:border-white/[0.06] dark:bg-white/[0.03] dark:shadow-[0_20px_60px_rgba(0,0,0,0.24)]">
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Runtime notes</div>
            <div className="mt-4 space-y-3 text-sm text-slate-600 dark:text-slate-300">
              <p>Ports are assigned from the sprint preview range and bound to `127.0.0.1` to avoid conflicts with the main dashboard.</p>
              <p>Each preview container runs from a dedicated sprint snapshot directory, so multiple active sprints from the same project stay isolated without registering git worktrees.</p>
            </div>
          </div>

          {showScriptEditor && (
            <div className="rounded-[2rem] border border-black/[0.06] bg-white/70 p-5 shadow-[0_20px_60px_rgba(15,23,42,0.06)] dark:border-white/[0.06] dark:bg-white/[0.03] dark:shadow-[0_20px_60px_rgba(0,0,0,0.24)]">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Startup script</div>
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
            <div className="mb-3 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Container logs</div>
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
