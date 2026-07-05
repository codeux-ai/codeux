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
import { PageHeader } from "./components/layout/PageHeader.js";
import { getSafeUrl } from "./lib/safe-url.js";

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
  const [logsSessionId, setLogsSessionId] = useState<string | null>(null);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsError, setLogsError] = useState<string | null>(null);
  const [logsStale, setLogsStale] = useState(false);

  const [launching, setLaunching] = useState(false);
  const [pendingSessionAction, setPendingSessionAction] = useState<"rebuild" | "stop" | null>(null);
  const [savingScript, setSavingScript] = useState(false);
  const [navigationPending, setNavigationPending] = useState(false);
  const [removingSessionIds, setRemovingSessionIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [addressValue, setAddressValue] = useState("/");
  const [currentPath, setCurrentPath] = useState("/");
  const [showScriptEditor, setShowScriptEditor] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [launchSprintId, setLaunchSprintId] = useState("");
  const [frameSrc, setFrameSrc] = useState("");

  const browserFeedback = useActionFeedback();
  const navigationPendingTimerRef = useRef<number | null>(null);
  const navigationPendingRef = useRef(false);
  const launchingRef = useRef(false);
  const pendingSessionActionRef = useRef<"rebuild" | "stop" | null>(null);
  const savingScriptRef = useRef(false);
  const removingSessionIdsRef = useRef<Set<string>>(new Set());
  const logsCacheRef = useRef<Map<string, string>>(new Map());

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
  const sessionActionPending = pendingSessionAction !== null;
  const previewEnabled = effectiveSettings?.settings.sprintPreview.enabled ?? true;
  const showInAppBrowser = effectiveSettings?.settings.sprintPreview.showInAppBrowser ?? true;
  const launchEnabled = previewEnabled && showInAppBrowser;
  const visibleSelectedSession = selectedSession && !removingSessionIdSet.has(selectedSession.id)
    ? selectedSession
    : null;
  const navigationEnabled = Boolean(visibleSelectedSession && visibleSelectedSession.status === "running" && visibleSelectedSession.hostPort);
  const sessionCards = sessions.filter((session) =>
    (!selectedProject || session.projectId === selectedProject.id) && !removingSessionIdSet.has(session.id)
  );
  const navigationDisabledReason = navigationPending
    ? "Preview navigation is sending the previous command. Wait for the control to become available before submitting another navigation command."
    : !visibleSelectedSession
      ? "Select or launch a preview session before using browser navigation."
      : visibleSelectedSession.status === "starting"
        ? "Preview navigation is disabled while the selected container is starting and waiting for a routed host port."
        : visibleSelectedSession.status === "error"
          ? `Preview navigation is disabled because the selected container is in an error state${visibleSelectedSession.lastError ? `: ${visibleSelectedSession.lastError}` : "."}`
          : visibleSelectedSession.status !== "running"
            ? "Preview navigation is disabled because the selected container is stopped. Start or rebuild the container to navigate."
            : !visibleSelectedSession.hostPort
              ? "Preview navigation is disabled until the running container receives a routed host port."
              : "";
  const previewStatusMessage = visibleSelectedSession
    ? visibleSelectedSession.status === "running"
      ? "Preview container is running."
      : visibleSelectedSession.status === "starting"
        ? "Preview container is starting."
        : visibleSelectedSession.status === "error"
          ? `Preview container has an error${visibleSelectedSession.lastError ? `: ${visibleSelectedSession.lastError}` : "."}`
          : "Preview container is stopped."
    : sessionCards.length === 0
      ? "No preview sessions are available. Launch a container to begin."
      : "No preview session is selected.";
  const logsStatusMessage = visibleSelectedSession
    ? logsLoading
      ? logs
        ? logsSessionId === visibleSelectedSession.id
          ? "Refreshing preview logs. Existing logs remain visible."
          : `Loading preview logs for ${visibleSelectedSession.sprintName}. Previous logs remain visible until new logs arrive.`
        : "Loading preview logs."
      : logsError
        ? logs
          ? `Preview logs could not be refreshed: ${logsError}. Showing last available logs.`
          : `Preview logs could not be loaded: ${logsError}`
      : logs
        ? logsStale
          ? "Showing last available preview logs. New logs are pending."
          : "Preview logs loaded. Logs refresh automatically and may be slightly stale."
        : "No preview logs are available yet."
    : "No preview session selected for logs.";

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

  const refreshLogsForSession = async (session: SprintPreviewSession, announce = false) => {
    if (announce) {
      browserFeedback.setPending(`Refreshing logs for ${session.sprintName}...`);
    }
    setLogsLoading(true);
    setLogsError(null);
    try {
      const result = await fetchPreviewLogs(session.id, 160);
      const nextLogs = result.logs;
      if (nextLogs) {
        logsCacheRef.current.set(session.id, nextLogs);
        setLogs(nextLogs);
        setLogsSessionId(session.id);
        setLogsStale(false);
      } else {
        const cachedLogs = logsCacheRef.current.get(session.id);
        if (cachedLogs) {
          setLogs(cachedLogs);
          setLogsSessionId(session.id);
          setLogsStale(true);
        } else {
          setLogs((current) => current || "");
          setLogsSessionId((current) => current || session.id);
          setLogsStale(Boolean(logs));
        }
      }
      setLogsError(null);
      if (announce) {
        browserFeedback.setSuccess(nextLogs ? "Preview logs refreshed" : "No new log output. Showing last available logs.");
      }
    } catch (fetchLogsError) {
      const message = fetchLogsError instanceof Error ? fetchLogsError.message : "Unknown log error";
      setLogsError(message);
      setLogsStale(Boolean(logs || logsCacheRef.current.get(session.id)));
      if (announce) {
        browserFeedback.setError(`Failed to refresh logs: ${message}`);
      }
    } finally {
      setLogsLoading(false);
    }
  };

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
      setLogsLoading(false);
      setLogsError(null);
      return;
    }
    const cachedLogs = logsCacheRef.current.get(visibleSelectedSession.id);
    if (cachedLogs !== undefined) {
      setLogs(cachedLogs);
      setLogsSessionId(visibleSelectedSession.id);
      setLogsStale(false);
    } else if (logs) {
      setLogsStale(true);
    }
    setLogsLoading(true);
    setLogsError(null);
    let cancelled = false;
    const deferredFetch = window.setTimeout(() => {
      void fetchPreviewLogs(visibleSelectedSession.id, 160)
        .then((result) => {
          if (cancelled) {
            return;
          }
          const nextLogs = result.logs;
          if (nextLogs) {
            logsCacheRef.current.set(visibleSelectedSession.id, nextLogs);
            setLogs(nextLogs);
            setLogsSessionId(visibleSelectedSession.id);
            setLogsStale(false);
          } else if (!logsCacheRef.current.has(visibleSelectedSession.id)) {
            setLogs((current) => current || "");
            setLogsSessionId((current) => current || visibleSelectedSession.id);
            setLogsStale(Boolean(logs));
          } else {
            setLogs(logsCacheRef.current.get(visibleSelectedSession.id) || "");
            setLogsSessionId(visibleSelectedSession.id);
            setLogsStale(true);
          }
          setLogsError(null);
        })
        .catch((fetchLogsError) => {
          if (!cancelled) {
            setLogsError(fetchLogsError instanceof Error ? fetchLogsError.message : "Unknown log error");
            setLogsStale(Boolean(logs || logsCacheRef.current.get(visibleSelectedSession.id)));
          }
        })
        .finally(() => {
          if (!cancelled) {
            setLogsLoading(false);
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
      void refreshLogsForSession(visibleSelectedSession);
    }, 8000);
    return () => window.clearInterval(timer);
  }, [visibleSelectedSession?.id]);

  useEffect(() => () => {
    if (navigationPendingTimerRef.current !== null) {
      window.clearTimeout(navigationPendingTimerRef.current);
    }
    navigationPendingRef.current = false;
  }, []);

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

  const markNavigationPending = () => {
    if (navigationPendingTimerRef.current !== null) {
      window.clearTimeout(navigationPendingTimerRef.current);
    }
    setNavigationPending(true);
    navigationPendingRef.current = true;
    navigationPendingTimerRef.current = window.setTimeout(() => {
      navigationPendingRef.current = false;
      setNavigationPending(false);
      navigationPendingTimerRef.current = null;
    }, 350);
  };

  const runNavigationAction = (action: () => void, pendingMessage: string, successMessage: string) => {
    if (!navigationEnabled || navigationPendingRef.current) {
      return;
    }
    browserFeedback.setPending(pendingMessage);
    markNavigationPending();
    action();
    window.setTimeout(() => {
      browserFeedback.setSuccess(successMessage);
    }, 360);
  };

  const handleStart = async (sprintId = launchSprintId) => {
    if (!selectedProject || !sprintId) return;
    if (launchingRef.current) return;
    if (!previewEnabled) {
      setError("Browser Preview is disabled for this project.");
      return;
    }
    launchingRef.current = true;
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
      launchingRef.current = false;
      setLaunching(false);
    }
  };

  const handleRebuild = async () => {
    if (!visibleSelectedSession) return;
    if (pendingSessionActionRef.current) return;
    if (!previewEnabled) {
      setError("Browser Preview is disabled for this project.");
      return;
    }
    pendingSessionActionRef.current = "rebuild";
    setPendingSessionAction("rebuild");
    browserFeedback.setPending("Rebuilding container...");
    try {
      await rebuildPreviewSession(visibleSelectedSession.id);
      await refreshSessions(true);
      reloadFrame();
      browserFeedback.setSuccess("Container rebuilt successfully");
    } catch (actionError) {
      browserFeedback.setError(`Failed to rebuild container: ${actionError instanceof Error ? actionError.message : String(actionError)}`);
    } finally {
      pendingSessionActionRef.current = null;
      setPendingSessionAction(null);
    }
  };

  const handleStop = async () => {
    if (!visibleSelectedSession) return;
    if (pendingSessionActionRef.current) return;
    pendingSessionActionRef.current = "stop";
    setPendingSessionAction("stop");
    browserFeedback.setPending("Stopping container...");
    try {
      await stopPreviewSession(visibleSelectedSession.id);
      await refreshSessions(true);
      browserFeedback.setSuccess("Container stopped successfully");
    } catch (actionError) {
      browserFeedback.setError(`Failed to stop container: ${actionError instanceof Error ? actionError.message : String(actionError)}`);
    } finally {
      pendingSessionActionRef.current = null;
      setPendingSessionAction(null);
    }
  };

  const handleRemove = async (sessionId: string) => {
    if (removingSessionIdsRef.current.has(sessionId)) {
      return;
    }
    removingSessionIdsRef.current = new Set([...removingSessionIdsRef.current, sessionId]);
    setRemovingSessionIds((current) => [...current, sessionId]);
    if (activeSessionId === sessionId) {
      setActiveSessionId(null);
      setCurrentPath("/");
      setAddressValue("/");
    }
    browserFeedback.setPending("Removing preview session...");
    try {
      await removePreviewSession(sessionId);
      await refreshSessions(true);
      browserFeedback.setSuccess("Preview session removed successfully");
    } catch (actionError) {
      browserFeedback.setError(`Failed to remove session: ${actionError instanceof Error ? actionError.message : String(actionError)}`);
    } finally {
      const nextRemovingIds = new Set(removingSessionIdsRef.current);
      nextRemovingIds.delete(sessionId);
      removingSessionIdsRef.current = nextRemovingIds;
      setRemovingSessionIds((current) => current.filter((id) => id !== sessionId));
    }
  };

  const handleSaveScript = async () => {
    if (!selectedProject || !scriptTargetSprint) return;
    if (savingScriptRef.current) return;
    savingScriptRef.current = true;
    setSavingScript(true);
    browserFeedback.setPending("Saving script...");
    try {
      const nextScript = await savePreviewScript(selectedProject.id, scriptTargetSprint.id, scriptDraft);
      setScript(nextScript);
      setShowScriptEditor(false);
      browserFeedback.setSuccess("Script saved successfully");
    } catch (actionError) {
      browserFeedback.setError(`Failed to save script: ${actionError instanceof Error ? actionError.message : String(actionError)}`);
    } finally {
      savingScriptRef.current = false;
      setSavingScript(false);
    }
  };

  const navigate = () => {
    if (!navigationEnabled || navigationPendingRef.current) {
      return;
    }
    const nextPath = normalizePath(addressValue);
    browserFeedback.setPending(`Navigating preview to ${nextPath}...`);
    markNavigationPending();
    setCurrentPath(nextPath);
    setAddressValue(nextPath);
    postNavigationCommand("push", nextPath);
    window.setTimeout(() => {
      browserFeedback.setSuccess(`Navigation sent for ${nextPath}`);
    }, 360);
  };

  if (!selectedProject) {
    return (
      <PageContainer aria-label="Browser" padding="workbench">
        <div className="rounded-[2rem] border border-black/[0.06] bg-white/60 p-8 text-sm text-slate-500 backdrop-blur-md dark:border-white/[0.06] dark:bg-white/[0.04] dark:text-slate-300">
          Select a project first. The in-app browser launches one isolated preview container per sprint.
        </div>
      </PageContainer>
    );
  }

  return (
    <PageContainer aria-label="Browser" padding="workbench" className="min-h-full" data-testid="browser-page-root">
      <PageHeader
        data-testid="browser-page-header"
        className="mb-8"
        icon={Compass}
        eyebrow="Sprint Browser"
        title="Build previews per sprint, isolated by container"
        subtitle="Each sprint preview runs from its own exported sprint snapshot and container, bound to a private host port and surfaced through the in-app browser."
        actions={
          <button
            type="button"
            onClick={() => {
              if (!loading) {
                browserFeedback.setPending("Refreshing preview sessions...");
                void refreshSessions()
                  .then(() => browserFeedback.setSuccess("Preview sessions refreshed"))
                  .catch((refreshError) => browserFeedback.setError(`Failed to refresh preview sessions: ${refreshError instanceof Error ? refreshError.message : String(refreshError)}`));
              }
            }}
          disabled={loading}
          aria-disabled={loading}
          aria-busy={loading}
          aria-label="Refresh preview sessions"
          className="inline-flex min-h-[44px] items-center gap-2.5 rounded-full border border-black/[0.06] bg-white/75 px-5 py-2.5 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-600 transition-all hover:-translate-y-px hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:ring-2 focus-visible:ring-signal-500/40 motion-reduce:transition-none dark:border-white/[0.06] dark:bg-white/[0.04] dark:text-slate-300 dark:hover:text-white"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin motion-reduce:animate-none" : ""}`} strokeWidth={2} />
            {loading ? "Refreshing" : "Refresh"}
          </button>
        }
      />

      {error && (
        <div className="mb-5 rounded-2xl border border-status-red/20 bg-status-red/10 px-4 py-3 text-sm text-status-red" role="alert">
          {error}
        </div>
      )}

      {browserFeedback.feedback.status !== "idle" && (
        <div className="mb-5">
          <ActionFeedbackRegion
            status={browserFeedback.feedback.status}
            message={browserFeedback.feedback.message}
            onDismiss={() => browserFeedback.clearFeedback()}
            clearError={browserFeedback.clearError}
            retryAction={
              browserFeedback.feedback.status === "error" && browserFeedback.feedback.message?.includes("launch") ? () => handleStart() :
              browserFeedback.feedback.status === "error" && browserFeedback.feedback.message?.includes("rebuild") ? () => handleRebuild() :
              browserFeedback.feedback.status === "error" && browserFeedback.feedback.message?.includes("stop") ? () => handleStop() :
              browserFeedback.feedback.status === "error" && browserFeedback.feedback.message?.includes("script") ? () => handleSaveScript() :
              undefined
            }
          />
        </div>
      )}

      <div className="mb-5">
        <PreviewSessionSlider
          sessions={sessionCards}
          selectedSessionId={activeSessionId}
          onSelectSession={(sessionId) => {
            if (sessionId === activeSessionId) {
              return;
            }
            const nextSession = sessionCards.find((session) => session.id === sessionId);
            setActiveSessionId(sessionId);
            if (nextSession) {
              browserFeedback.setSuccess(`Selected preview session ${nextSession.sprintName}`);
            }
          }}
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
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_340px]" data-testid="browser-main-tool-panel">
        <PreviewWindowChrome
          session={visibleSelectedSession}
          onNavigateBack={() => runNavigationAction(
            () => postNavigationCommand("back"),
            `Going back in ${visibleSelectedSession?.sprintName || "selected preview"}...`,
            `Back navigation sent for ${visibleSelectedSession?.sprintName || "selected preview"}`
          )}
          onNavigateForward={() => runNavigationAction(
            () => postNavigationCommand("forward"),
            `Going forward in ${visibleSelectedSession?.sprintName || "selected preview"}...`,
            `Forward navigation sent for ${visibleSelectedSession?.sprintName || "selected preview"}`
          )}
          onReload={() => runNavigationAction(
            () => postNavigationCommand("reload"),
            `Reloading ${normalizePath(currentPath)} in ${visibleSelectedSession?.sprintName || "selected preview"}...`,
            `Reload sent for ${normalizePath(currentPath)}`
          )}
          addressValue={addressValue}
          onAddressChange={setAddressValue}
          onAddressSubmit={(_value) => navigate()}
          navigationEnabled={navigationEnabled}
          navigationBusy={navigationPending}
          navigationDisabledReason={navigationDisabledReason}
        >
          <div aria-live="polite" role="status" className="sr-only">
            {previewStatusMessage}
            {pendingSessionAction === "rebuild" ? " Rebuilding preview container." : ""}
            {pendingSessionAction === "stop" ? " Stopping preview container." : ""}
            {savingScript ? " Saving preview script." : ""}
            {launching ? " Launching preview container." : ""}
            {navigationPending ? " Preview navigation command is being sent." : ""}
            {!navigationEnabled && navigationDisabledReason ? ` ${navigationDisabledReason}` : ""}
          </div>
          {visibleSelectedSession && frameSrc ? (
            <div className="relative h-full w-full">
              {!navigationEnabled && (
                <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center justify-center p-4">
                  <div className="flex items-center gap-3 rounded-full border border-black/[0.08] bg-white/90 px-4 py-2.5 shadow-[0_8px_32px_rgba(0,0,0,0.08)] backdrop-blur-md dark:border-white/[0.08] dark:bg-void-900/90 dark:shadow-[0_8px_32px_rgba(0,0,0,0.24)]">
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-signal-500 border-t-transparent motion-reduce:animate-none" />
                    <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                      {visibleSelectedSession.status === "starting" ? "Container starting..." : visibleSelectedSession.status === "error" ? "Container failed" : "Waiting for connection..."}
                    </span>
                  </div>
                </div>
              )}
              <iframe
                key={visibleSelectedSession.id}
                ref={frameRef}
                title={`Preview: ${selectedProject?.name || 'Unknown Project'} - ${visibleSelectedSession.sprintName}`}
                src={frameSrc}
                className="h-full w-full border-0 bg-white"
              />
            </div>
          ) : null}
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
                  <span className="break-words">{scriptTargetSprint?.name || "All sprints"}</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowScriptEditor((value) => !value)}
                aria-expanded={showScriptEditor}
                aria-controls="preview-script-editor"
                aria-label={showScriptEditor ? "Hide startup script editor" : "Show startup script editor"}
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
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={handleRebuild}
                  disabled={!visibleSelectedSession || sessionActionPending}
                  aria-disabled={!visibleSelectedSession || sessionActionPending}
                  aria-label={pendingSessionAction === "rebuild" ? "Rebuilding preview container" : "Rebuild preview container"}
                  aria-busy={pendingSessionAction === "rebuild"}
                  aria-describedby="preview-session-action-status"
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-2xl border border-black/[0.08] text-xs font-semibold text-slate-700 transition hover:border-black/[0.16] hover:text-slate-900 disabled:cursor-not-allowed disabled:border-slate-300/50 disabled:bg-slate-200/60 disabled:text-slate-500 disabled:opacity-100 dark:border-white/[0.08] dark:text-slate-200 dark:hover:border-white/[0.16] dark:hover:text-white dark:disabled:border-slate-700 dark:disabled:bg-slate-800/60 dark:disabled:text-slate-500"
                >
                  <RotateCcw className={`h-4 w-4 ${pendingSessionAction === "rebuild" ? 'animate-spin motion-reduce:animate-none' : ''}`} strokeWidth={2} />
                  {pendingSessionAction === "rebuild" ? "Rebuilding..." : "Rebuild"}
                </button>
                <button
                  type="button"
                  onClick={handleStop}
                  disabled={!visibleSelectedSession || sessionActionPending}
                  aria-disabled={!visibleSelectedSession || sessionActionPending}
                  aria-label={pendingSessionAction === "stop" ? "Stopping preview container" : "Stop preview container"}
                  aria-busy={pendingSessionAction === "stop"}
                  aria-describedby="preview-session-action-status"
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-2xl border border-black/[0.08] text-xs font-semibold text-slate-700 transition hover:border-black/[0.16] hover:text-slate-900 disabled:cursor-not-allowed disabled:border-slate-300/50 disabled:bg-slate-200/60 disabled:text-slate-500 disabled:opacity-100 dark:border-white/[0.08] dark:text-slate-200 dark:hover:border-white/[0.16] dark:hover:text-white dark:disabled:border-slate-700 dark:disabled:bg-slate-800/60 dark:disabled:text-slate-500"
                >
                  <Square className="h-4 w-4" strokeWidth={2} />
                  {pendingSessionAction === "stop" ? "Stopping..." : "Stop"}
                </button>
                <a
                  href={visibleSelectedSession ? getSafeUrl(`${buildPreviewOrigin(visibleSelectedSession.id)}${normalizePath(currentPath)}`) : undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-disabled={!visibleSelectedSession}
                  aria-label="Open selected preview in a new tab"
                  title={visibleSelectedSession ? "Open preview in new tab" : "Start container to open"}
                  className={`inline-flex h-10 items-center justify-center gap-2 rounded-2xl border border-black/[0.08] text-xs font-semibold text-slate-700 transition hover:border-black/[0.16] hover:text-slate-900 dark:border-white/[0.08] dark:text-slate-200 dark:hover:border-white/[0.16] dark:hover:text-white ${!visibleSelectedSession ? "pointer-events-none opacity-50 cursor-not-allowed" : ""}`}
                >
                  <ExternalLink className="h-4 w-4" strokeWidth={2} />
                  Open
                </a>
              </div>
              <div id="preview-session-action-status" role="status" aria-live="polite" className="mt-3 min-h-4 text-xs text-slate-500 dark:text-slate-400">
                {pendingSessionAction === "rebuild"
                  ? "Rebuild in progress. Rebuild and stop controls are temporarily unavailable."
                  : pendingSessionAction === "stop"
                    ? "Stop in progress. Rebuild and stop controls are temporarily unavailable."
                    : !visibleSelectedSession
                      ? "Select or launch a preview session to enable container actions."
                      : "Container actions are available."}
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
            <div id="preview-script-editor" className="rounded-[1.75rem] border border-black/[0.06] bg-white/72 p-5 shadow-[0_18px_48px_rgba(15,23,42,0.06)] backdrop-blur-xl dark:border-white/[0.06] dark:bg-void-900/45 dark:shadow-[0_20px_60px_rgba(0,0,0,0.24)]">
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
                  aria-disabled={savingScript || !scriptTargetSprint}
                  aria-busy={savingScript}
                  aria-label={savingScript ? "Saving startup script" : "Save startup script"}
                  aria-describedby="preview-script-save-status"
                  className="inline-flex h-10 items-center gap-2 rounded-2xl bg-slate-900 px-4 text-xs font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100"
                >
                  <Save className="h-4 w-4" strokeWidth={2} />
                  {savingScript ? "Saving..." : "Save"}
                </button>
              </div>
              <textarea
                aria-label="Startup script contents"
                value={scriptDraft}
                disabled={savingScript}
                aria-busy={savingScript}
                aria-describedby="preview-script-save-status"
                onInput={(event) => setScriptDraft((event.currentTarget as HTMLTextAreaElement).value)}
                className="min-h-[12rem] md:min-h-[18rem] w-full rounded-[1.5rem] whitespace-pre-wrap break-words border border-black/[0.08] bg-slate-100/80 p-4 font-mono text-[12px] leading-6 text-slate-800 outline-none transition focus:border-signal-500/40 disabled:cursor-wait disabled:opacity-80 dark:border-white/[0.08] dark:bg-void-950 dark:text-slate-100"
              />
              <div id="preview-script-save-status" role="status" aria-live="polite" className="mt-3 min-h-4 text-xs text-slate-500 dark:text-slate-400">
                {savingScript
                  ? "Saving startup script. Editing is paused until the save completes."
                  : scriptTargetSprint
                    ? "Startup script changes can be saved for the selected sprint."
                    : "Select a sprint before saving startup script changes."}
              </div>
            </div>
          )}

          <div className="rounded-[1.75rem] border border-black/[0.06] bg-white/72 p-5 shadow-[0_18px_48px_rgba(15,23,42,0.06)] backdrop-blur-xl dark:border-white/[0.06] dark:bg-void-900/45 dark:shadow-[0_20px_60px_rgba(0,0,0,0.24)]">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Container logs</div>
              <div className="flex items-center gap-2">
                <div className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] ${
                  logsError
                    ? "border-status-red/30 bg-status-red/10 text-status-red"
                    : logsLoading
                      ? "border-ember-500/30 bg-ember-500/10 text-ember-600 dark:text-ember-400"
                      : logsStale
                        ? "border-slate-400/30 bg-slate-500/10 text-slate-600 dark:text-slate-300"
                        : "border-signal-500/30 bg-signal-500/10 text-signal-600 dark:text-signal-400"
                }`}>
                  {logsError ? "Error" : logsLoading ? "Refreshing" : logsStale ? "Stale" : "Ready"}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (visibleSelectedSession && !logsLoading) {
                      void refreshLogsForSession(visibleSelectedSession, true);
                    }
                  }}
                  disabled={!visibleSelectedSession || logsLoading}
                  aria-disabled={!visibleSelectedSession || logsLoading}
                  aria-busy={logsLoading}
                  aria-label={logsLoading ? "Refreshing preview logs" : "Refresh preview logs"}
                  className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-black/[0.08] px-2.5 text-[11px] font-semibold text-slate-600 transition hover:border-black/[0.16] hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none dark:border-white/[0.08] dark:text-slate-300 dark:hover:border-white/[0.16] dark:hover:text-white"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${logsLoading ? "animate-spin motion-reduce:animate-none" : ""}`} strokeWidth={2.2} />
                  Refresh
                </button>
              </div>
            </div>
            <div className="sr-only" role="status" aria-live="polite">{logsStatusMessage}</div>
            <pre
              aria-label="Preview container logs"
              aria-busy={logsLoading}
              aria-describedby="preview-logs-status"
              className="min-h-[12rem] md:min-h-[18rem] max-h-[360px] overflow-auto rounded-[1.5rem] whitespace-pre-wrap break-words bg-slate-100/80 p-4 font-mono text-[11px] leading-6 text-slate-700 dark:bg-void-950 dark:text-slate-300"
            >
              {logs || (logsLoading ? "Loading logs..." : "No logs yet.")}
            </pre>
            <div id="preview-logs-status" className="mt-3 min-h-4 text-xs text-slate-500 dark:text-slate-400">
              {logsStatusMessage}
            </div>
          </div>
        </div>
      </div>
      )}
    </PageContainer>
  );
};
