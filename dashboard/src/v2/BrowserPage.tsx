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
import { LaunchContainerPanel } from "./components/browser/LaunchContainerPanel.js";
import { useActionFeedback } from "./hooks/use-action-feedback.js";
import { ActionFeedbackRegion } from "./components/ui/ActionFeedbackRegion.js";
import { PageContainer } from "./components/layout/PageContainer.js";

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
  const [actionFeedback, setActionFeedback] = useState<{status: 'idle' | 'pending' | 'success' | 'error', message: string | null}>({status: 'idle', message: null});

  const browserFeedback = useActionFeedback();

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
    browserFeedback.setPending("Loading script...");
    void fetchPreviewScript(selectedProject.id, scriptTargetSprint.id)
      .then((data) => {
        if (cancelled) {
          return;
        }
        setScript(data);
        setScriptDraft(data.content);
        browserFeedback.setSuccess("Script loaded successfully");
      })
      .catch((fetchError) => {
        if (cancelled) {
          return;
        }
        browserFeedback.setError(`Failed to load script: ${fetchError instanceof Error ? fetchError.message : String(fetchError)}`);
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

  };

  const handleStart = async (sprintId = launchSprintId) => {
    if (!selectedProject || !sprintId) return;
    if (!previewEnabled) {
      setError("Browser Preview is disabled for this project.");
      return;
    }
    setLaunching(true);
    browserFeedback.setPending("Launching container...");
    try {
      const session = await startPreviewSession(selectedProject.id, sprintId);
      setActiveSessionId(session.id);
      await refreshSessions(true);
      setFrameSrc(`${buildPreviewOrigin(session.id)}${normalizePath(currentPathRef.current)}`);

      browserFeedback.setSuccess("Container launched successfully");
    } catch (actionError) {
      browserFeedback.setError(`Failed to launch container: ${actionError instanceof Error ? actionError.message : String(actionError)}`);
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
    browserFeedback.setPending("Rebuilding container...");
    try {
      await rebuildPreviewSession(visibleSelectedSession.id);
      await refreshSessions(true);
      reloadFrame();
      browserFeedback.setSuccess("Container rebuilt successfully");
    } catch (actionError) {
      browserFeedback.setError(`Failed to rebuild container: ${actionError instanceof Error ? actionError.message : String(actionError)}`);
    } finally {
      setSessionActionPending(false);
    }
  };

  const handleStop = async () => {
    if (!visibleSelectedSession) return;
    setSessionActionPending(true);
    browserFeedback.setPending("Stopping container...");
    try {
      await stopPreviewSession(visibleSelectedSession.id);
      await refreshSessions(true);
      browserFeedback.setSuccess("Container stopped successfully");
    } catch (actionError) {
      browserFeedback.setError(`Failed to stop container: ${actionError instanceof Error ? actionError.message : String(actionError)}`);
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
      browserFeedback.setError(`Failed to save script: ${actionError instanceof Error ? actionError.message : String(actionError)}`);
    } finally {
      setRemovingSessionIds((current) => current.filter((id) => id !== sessionId));
    }
  };

  const handleSaveScript = async () => {
    if (!selectedProject || !scriptTargetSprint) return;
    setSavingScript(true);
    browserFeedback.setPending("Saving script...");
    try {
      const nextScript = await savePreviewScript(selectedProject.id, scriptTargetSprint.id, scriptDraft);
      setScript(nextScript);
      setShowScriptEditor(false);
      browserFeedback.setSuccess("Script saved successfully");
    } catch (actionError) {
      setActionFeedback({status: 'error', message: `Failed to launch container: ${actionError instanceof Error ? actionError.message : String(actionError)}`});
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

    }
  };

  const sessionCards = sessions.filter((session) =>
    (!selectedProject || session.projectId === selectedProject.id) && !removingSessionIdSet.has(session.id)
  );

  if (!selectedProject) {
    return (
      <PageContainer padding="workbench">
        <div className="rounded-[2rem] border border-black/[0.06] bg-white/60 p-8 text-sm text-slate-500 backdrop-blur-md dark:border-white/[0.06] dark:bg-white/[0.04] dark:text-slate-300">
          Select a project first. The in-app browser launches one isolated preview container per sprint.
        </div>
      </PageContainer>
    );
  }

  return (
    <PageContainer padding="workbench" className="min-h-full" data-testid="browser-page-root">
      <div className="mb-8 flex flex-col justify-between gap-8 lg:flex-row lg:items-end" data-testid="browser-page-header">
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2.5 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-signal-500">
            <Compass className="h-3.5 w-3.5" strokeWidth={2} />
            Sprint Browser
          </div>
          <h1 className="font-display text-5xl font-black leading-[0.92] tracking-tighter text-slate-900 dark:text-white md:text-7xl">
            Build previews per sprint, isolated by container.
          </h1>
          <p className="max-w-3xl text-base leading-relaxed text-slate-500 dark:text-slate-400">
            Each sprint preview runs from its own exported sprint snapshot and container, bound to a private host port and surfaced through the in-app browser.
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => void refreshSessions()}
          className="inline-flex min-h-[44px] items-center gap-2.5 rounded-full border border-black/[0.06] bg-white/75 px-5 py-2.5 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-600 transition-all hover:-translate-y-px hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-signal-500/40 dark:border-white/[0.06] dark:bg-white/[0.04] dark:text-slate-300 dark:hover:text-white"
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

      {actionFeedback.status !== "idle" && actionFeedback.message && (
        <div className="mb-5 flex items-start gap-3 p-3 rounded-xl border bg-black/[0.02] dark:bg-white/[0.03] border-black/[0.06] dark:border-white/[0.06]">
          <div className={`flex-1 text-sm font-medium mt-0.5 ${actionFeedback.status === 'error' ? 'text-status-red' : actionFeedback.status === 'success' ? 'text-status-green' : 'text-signal-700 dark:text-signal-400'}`}>
            {actionFeedback.status === 'pending' && <span className="mr-2 inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />}
            {actionFeedback.message}
          </div>
          <button
            type="button"
            onClick={() => setActionFeedback({status: 'idle', message: null})}
            className="shrink-0 p-1 rounded-md opacity-70 hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
          >
            <span className="sr-only">Dismiss</span>
            ✕
          </button>
        </div>
      )}


      {browserFeedback.feedback.status !== "idle" && (
        <div className="mb-5">
          <ActionFeedbackRegion
            status={browserFeedback.feedback.status}
            message={browserFeedback.feedback.message}
            onDismiss={() => browserFeedback.clearFeedback()}
          />
        </div>
      )}

      <div className="mb-5">
        <PreviewSessionSlider
          sessions={sessionCards}
          selectedSessionId={activeSessionId}
          onSelectSession={setActiveSessionId}
          onRemoveSession={(sessionId) => void handleRemove(sessionId)}
          removingSessionIds={removingSessionIds}
        />
      </div>

      {(!showInAppBrowser || !previewEnabled) && (
        <div className="rounded-[2rem] border border-black/[0.06] bg-white/70 p-8 text-sm text-slate-500 shadow-[0_20px_60px_rgba(15,23,42,0.06)] backdrop-blur-md dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-slate-300 dark:shadow-[0_20px_60px_rgba(0,0,0,0.24)]">
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
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]" data-testid="browser-main-tool-panel">
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
              key={visibleSelectedSession.id}
              ref={frameRef}
              title={`Sprint preview ${visibleSelectedSession.sprintName}`}
              src={frameSrc}
              className="h-full w-full border-0 bg-white"
            />
          )}
        </PreviewWindowChrome>

        <div className="space-y-5">
          <LaunchContainerPanel
            sprints={sprints}
            launchSprintId={launchSprintId}
            onLaunchSprintChange={setLaunchSprintId}
            onLaunchContainer={() => void handleStart()}
            launchEnabled={launchEnabled}
            launchBusy={launching}
          />
          <div className="rounded-[1.75rem] border border-black/[0.06] bg-white/72 p-5 shadow-[0_18px_48px_rgba(15,23,42,0.06)] backdrop-blur-xl dark:border-white/[0.06] dark:bg-void-900/45 dark:shadow-[0_20px_60px_rgba(0,0,0,0.24)]">
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
                <div className="rounded-2xl border border-sky-500/20 bg-sky-500/10 px-4 py-3 dark:border-sky-500/25 dark:bg-sky-500/12">
                  <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Port routing</div>
                  <div className="mt-1 font-mono text-[12px] text-slate-700 dark:text-slate-300">{formatPortMapping(visibleSelectedSession)}</div>
                </div>
              )}
              <div className="rounded-2xl border border-ember-500/20 bg-ember-500/10 px-4 py-3 dark:border-ember-500/25 dark:bg-ember-500/12">
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
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-2xl border border-black/[0.08] text-xs font-semibold text-slate-700 transition hover:border-black/[0.16] hover:text-slate-900 disabled:cursor-not-allowed disabled:border-slate-300/50 disabled:bg-slate-200/60 disabled:text-slate-500 disabled:opacity-100 dark:border-white/[0.08] dark:text-slate-200 dark:hover:border-white/[0.16] dark:hover:text-white dark:disabled:border-slate-700 dark:disabled:bg-slate-800/60 dark:disabled:text-slate-500"
                >
                  <RotateCcw className={`h-4 w-4 ${sessionActionPending ? 'animate-spin' : ''}`} strokeWidth={2} />
                  {sessionActionPending ? "Rebuilding..." : "Rebuild"}
                </button>
                <button
                  type="button"
                  onClick={handleStop}
                  disabled={!visibleSelectedSession || sessionActionPending}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-2xl border border-black/[0.08] text-xs font-semibold text-slate-700 transition hover:border-black/[0.16] hover:text-slate-900 disabled:cursor-not-allowed disabled:border-slate-300/50 disabled:bg-slate-200/60 disabled:text-slate-500 disabled:opacity-100 dark:border-white/[0.08] dark:text-slate-200 dark:hover:border-white/[0.16] dark:hover:text-white dark:disabled:border-slate-700 dark:disabled:bg-slate-800/60 dark:disabled:text-slate-500"
                >
                  <Square className="h-4 w-4" strokeWidth={2} />
                  {sessionActionPending ? "Stopping..." : "Stop"}
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

          <div className="rounded-[1.75rem] border border-black/[0.06] bg-white/72 p-5 shadow-[0_18px_48px_rgba(15,23,42,0.06)] backdrop-blur-xl dark:border-white/[0.06] dark:bg-void-900/45 dark:shadow-[0_20px_60px_rgba(0,0,0,0.24)]">
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Runtime notes</div>
            <div className="mt-4 space-y-3 text-sm text-slate-600 dark:text-slate-300">
              <p>Ports are assigned from the sprint preview range and bound to `127.0.0.1` to avoid conflicts with the main dashboard.</p>
              <p>Each preview container runs from a dedicated sprint snapshot directory, so multiple active sprints from the same project stay isolated without registering git worktrees.</p>
            </div>
          </div>

          {showScriptEditor && (
            <div className="rounded-[1.75rem] border border-black/[0.06] bg-white/72 p-5 shadow-[0_18px_48px_rgba(15,23,42,0.06)] backdrop-blur-xl dark:border-white/[0.06] dark:bg-void-900/45 dark:shadow-[0_20px_60px_rgba(0,0,0,0.24)]">
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
                  {savingScript ? "Saving..." : "Save"}
                </button>
              </div>
              <textarea
                value={scriptDraft}
                onInput={(event) => setScriptDraft((event.currentTarget as HTMLTextAreaElement).value)}
                className="h-72 w-full rounded-[1.5rem] border border-black/[0.08] bg-slate-100/80 p-4 font-mono text-[12px] leading-6 text-slate-800 outline-none transition focus:border-signal-500/40 dark:border-white/[0.08] dark:bg-void-950 dark:text-slate-100"
              />
            </div>
          )}

          <div className="rounded-[1.75rem] border border-black/[0.06] bg-white/72 p-5 shadow-[0_18px_48px_rgba(15,23,42,0.06)] backdrop-blur-xl dark:border-white/[0.06] dark:bg-void-900/45 dark:shadow-[0_20px_60px_rgba(0,0,0,0.24)]">
            <div className="mb-3 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Container logs</div>
            <pre className="max-h-[360px] overflow-auto rounded-[1.5rem] bg-slate-100/80 p-4 font-mono text-[11px] leading-6 text-slate-700 dark:bg-void-950 dark:text-slate-300">
              {logs || "No logs yet."}
            </pre>
          </div>
        </div>
      </div>
      )}
    </PageContainer>
  );
};
