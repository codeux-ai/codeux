import type { FunctionComponent } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { useNavigate } from "@tanstack/react-router";
import { BookOpen, Bot, FolderOpen, Loader2, Plus, Sparkles } from "lucide-preact";
import type { ProjectSetupOptions } from "./types.js";
import {
  AddProjectModal,
  type AddProjectModalSubmission,
  type SourceType as AddProjectModalSourceType,
} from "./components/ui/AddProjectModal.js";
import { AddProjectCard } from "./components/projects/AddProjectCard.js";
import { ProjectCard } from "./components/projects/ProjectCard.js";
import { PageContainer } from "./components/layout/PageContainer.js";
import { PageHeader } from "./components/layout/PageHeader.js";
import { SkeletonLoader, SkeletonPanel } from "./components/layout/SkeletonLoader.js";
import { useToast } from "./components/feedback/ToastProvider.js";
import { ConfirmDialog } from "./components/ui/ConfirmDialog.js";
import { Modal } from "./components/ui/Modal.js";
import { useConfirmDialog } from "./hooks/use-confirm-dialog.js";
import { useRouteProjectSelection } from "./hooks/use-route-project-selection.js";
import { useProjectData } from "./context/project-data.js";
import { buildProjectCreationSettingsOverride } from "../lib/settings-updaters.js";
import { DEFAULT_DASHBOARD_SETTINGS } from "../lib/settings.js";
import { fetchProjectInvocations } from "./lib/invocation-api.js";
import { startProjectSetup } from "./lib/project-api.js";
import { useDashboardI18n } from "./i18n/context.js";
import { projectMessages } from "./i18n/messages/projects.js";
import {
  buildProjectsPageViewModel,
  PROJECT_FILTER_DEFINITIONS,
  type ProjectFilter,
} from "./lib/projects-page-view-model.js";

const createDefaultSetupOptions = (): ProjectSetupOptions => ({
  agents: true,
  quicksprints: true,
  previewScript: true,
  ci: true,
  techstack: true,
  docs: false,
});

const SETUP_OPTIONS = [
  { key: "agents", labelKey: "setupAgents", descriptionKey: "setupAgentsDescription" },
  { key: "quicksprints", labelKey: "setupQuicksprints", descriptionKey: "setupQuicksprintsDescription" },
  { key: "previewScript", labelKey: "setupPreviewScript", descriptionKey: "setupPreviewScriptDescription" },
  { key: "ci", labelKey: "setupCi", descriptionKey: "setupCiDescription" },
  { key: "techstack", labelKey: "setupTechstack", descriptionKey: "setupTechstackDescription" },
  { key: "docs", labelKey: "setupDocs", descriptionKey: "setupDocsDescription", icon: BookOpen },
] as const;

type SetupErrorKind = "start" | "poll" | "invocation";
type SetupStatus = "starting" | "running" | "success" | "error";

interface ProjectSetupState {
  status: SetupStatus;
  options: ProjectSetupOptions;
  invocationId?: string;
  error?: string;
  errorKind?: SetupErrorKind;
}

interface PageFeedback {
  tone: "success" | "error";
  message: string;
}

interface SetupPollingRun {
  generation: number;
  timerId: number | null;
}

export const ProjectsPage: FunctionComponent = () => {
  const navigate = useNavigate();
  const { formatNumber, translate, translatePlural } = useDashboardI18n();
  const [showModal, setShowModal] = useState(false);
  const [modalSourceType, setModalSourceType] = useState<AddProjectModalSourceType>("local");
  const [setupProjectId, setSetupProjectId] = useState<string | null>(null);
  const [setupStateByProjectId, setSetupStateByProjectId] = useState<Record<string, ProjectSetupState>>({});
  const [deleteProjectId, setDeleteProjectId] = useState<string | null>(null);
  const [deletingProjectIds, setDeletingProjectIds] = useState<Set<string>>(() => new Set());
  const [deleteErrorByProjectId, setDeleteErrorByProjectId] = useState<Record<string, string>>({});
  const [setupOptions, setSetupOptions] = useState<ProjectSetupOptions>(() => createDefaultSetupOptions());
  const [activeFilter, setActiveFilter] = useState<ProjectFilter>("All");
  const [announcement, setAnnouncement] = useState("");
  const [pageFeedback, setPageFeedback] = useState<PageFeedback | null>(null);
  const [focusAfterDeleteProjectId, setFocusAfterDeleteProjectId] = useState<string | null>(null);
  const setupInitialFocusRef = useRef<HTMLButtonElement>(null);
  const setupOperationSequenceRef = useRef(0);
  const setupOperationTokensRef = useRef<Map<string, number>>(new Map());
  const setupPollingRunsRef = useRef<Map<string, SetupPollingRun>>(new Map());
  const setupPollingGenerationRef = useRef<Map<string, number>>(new Map());
  const deletingProjectIdsRef = useRef<Set<string>>(new Set());
  const deleteTriggerRef = useRef<HTMLElement | null>(null);
  const mountedRef = useRef(true);
  const previousSelectedProjectIdRef = useRef<string | null>(null);
  const deleteConfirm = useConfirmDialog();
  const {
    projects: sources,
    selectedProjectId,
    loading,
    error,
    createProject,
    deleteProject,
    selectProject,
  } = useProjectData();
  const { addToast } = useToast();
  const viewModel = useMemo(
    () => buildProjectsPageViewModel(sources, activeFilter),
    [activeFilter, sources],
  );
  const activeSetupProject = sources.find((source) => source.id === setupProjectId) ?? null;
  const activeDeleteProject = sources.find((source) => source.id === deleteProjectId) ?? null;
  const activeSetupState = activeSetupProject ? setupStateByProjectId[activeSetupProject.id] : undefined;
  const isActiveSetupPending = activeSetupState?.status === "starting" || activeSetupState?.status === "running";
  const routeSearch = typeof window === "undefined" ? "" : window.location.search;
  const routeProjectId = useMemo(() => {
    const params = new URLSearchParams(routeSearch);
    return params.get("projectId")?.trim() || null;
  }, [routeSearch]);
  useRouteProjectSelection(routeProjectId, selectedProjectId, selectProject);

  const openAddProject = (sourceType: AddProjectModalSourceType) => {
    setModalSourceType(sourceType);
    setShowModal(true);
  };

  const openInvocation = (invocationId: string) => {
    window.location.href = `/chat?mode=invocations&invocation=${encodeURIComponent(invocationId)}`;
  };

  const openProjectSettings = (projectId: string) => {
    void selectProject(projectId);
    navigate({ to: "/config" });
  };

  const nextSetupPollingGeneration = (projectId: string): number => {
    const generation = (setupPollingGenerationRef.current.get(projectId) ?? 0) + 1;
    setupPollingGenerationRef.current.set(projectId, generation);
    return generation;
  };

  const stopSetupPolling = (projectId: string) => {
    const activeRun = setupPollingRunsRef.current.get(projectId);
    if (activeRun?.timerId !== null && activeRun?.timerId !== undefined) {
      window.clearTimeout(activeRun.timerId);
    }
    setupPollingRunsRef.current.delete(projectId);
    nextSetupPollingGeneration(projectId);
  };

  const startSetupPolling = (
    projectId: string,
    projectName: string,
    invocationId: string,
    operationToken: number,
    generation = nextSetupPollingGeneration(projectId),
  ) => {
    const previousRun = setupPollingRunsRef.current.get(projectId);
    if (previousRun?.timerId !== null && previousRun?.timerId !== undefined) {
      window.clearTimeout(previousRun.timerId);
    }
    setupPollingGenerationRef.current.set(projectId, generation);

    const isCurrent = () => mountedRef.current
      && setupOperationTokensRef.current.get(projectId) === operationToken
      && setupPollingGenerationRef.current.get(projectId) === generation;

    const finishOperation = () => {
      if (setupOperationTokensRef.current.get(projectId) === operationToken) {
        setupOperationTokensRef.current.delete(projectId);
      }
      setupPollingRunsRef.current.delete(projectId);
    };

    const schedulePoll = () => {
      if (!isCurrent()) return;
      const timerId = window.setTimeout(() => {
        void (async () => {
          if (!isCurrent()) return;
          try {
            const invocations = await fetchProjectInvocations(projectId);
            if (!isCurrent()) return;
            const invocation = invocations.find((candidate) => candidate.id === invocationId);
            if (!invocation || invocation.status === "running") {
              schedulePoll();
              return;
            }

            if (invocation.status === "failed" || invocation.status === "cancelled" || invocation.status === "paused") {
              const message = invocation.lastErrorMessage
                || invocation.errorMessage
                || translate(projectMessages, "setupInvocationFailed");
              setSetupStateByProjectId((previous) => ({
                ...previous,
                [projectId]: {
                  ...previous[projectId],
                  status: "error",
                  invocationId,
                  error: message,
                  errorKind: "invocation",
                },
              }));
              addToast({
                type: "error",
                message: translate(projectMessages, "setupFailed", { name: projectName, message }),
                autoDismissMs: 0,
                action: {
                  label: translate(projectMessages, "openInvocation"),
                  onClick: () => openInvocation(invocationId),
                },
              });
              finishOperation();
              return;
            }

            setSetupStateByProjectId((previous) => ({
              ...previous,
              [projectId]: {
                ...previous[projectId],
                status: "success",
                invocationId,
                error: undefined,
                errorKind: undefined,
              },
            }));
            addToast({
              type: "success",
              message: translate(projectMessages, "setupFinished", { name: projectName }),
              autoDismissMs: 9000,
              action: {
                label: translate(projectMessages, "openInvocation"),
                onClick: () => openInvocation(invocationId),
              },
            });
            finishOperation();
          } catch (pollFailure) {
            if (!isCurrent()) return;
            const message = pollFailure instanceof Error ? pollFailure.message : String(pollFailure);
            setSetupStateByProjectId((previous) => ({
              ...previous,
              [projectId]: {
                ...previous[projectId],
                status: "error",
                invocationId,
                error: message,
                errorKind: "poll",
              },
            }));
            setupPollingRunsRef.current.delete(projectId);
          }
        })();
      }, 3000);
      setupPollingRunsRef.current.set(projectId, { generation, timerId });
    };

    schedulePoll();
  };

  const launchProjectSetup = (
    projectId: string,
    projectName: string,
    options: ProjectSetupOptions,
  ) => {
    if (setupOperationTokensRef.current.has(projectId)) return;
    const operationToken = ++setupOperationSequenceRef.current;
    setupOperationTokensRef.current.set(projectId, operationToken);
    const pollingGeneration = nextSetupPollingGeneration(projectId);
    setSetupStateByProjectId((previous) => ({
      ...previous,
      [projectId]: { status: "starting", options },
    }));
    addToast({
      type: "info",
      message: translate(projectMessages, "setupStarting", { name: projectName }),
      autoDismissMs: 7000,
    });

    void startProjectSetup(projectId, { enabled: true, options })
      .then((started) => {
        if (!mountedRef.current || setupOperationTokensRef.current.get(projectId) !== operationToken) return;
        setSetupStateByProjectId((previous) => ({
          ...previous,
          [projectId]: {
            status: "running",
            options,
            invocationId: started.invocationId,
          },
        }));
        addToast({
          type: "info",
          message: translate(projectMessages, "setupRunning", {
            name: projectName,
            invocation: started.invocationId.slice(0, 8),
          }),
          autoDismissMs: 0,
          action: {
            label: translate(projectMessages, "openInvocation"),
            onClick: () => openInvocation(started.invocationId),
          },
        });
        if (setupPollingGenerationRef.current.get(projectId) === pollingGeneration) {
          startSetupPolling(projectId, projectName, started.invocationId, operationToken, pollingGeneration);
        }
      })
      .catch((setupFailure) => {
        if (!mountedRef.current || setupOperationTokensRef.current.get(projectId) !== operationToken) return;
        const message = setupFailure instanceof Error ? setupFailure.message : String(setupFailure);
        setupOperationTokensRef.current.delete(projectId);
        setSetupStateByProjectId((previous) => ({
          ...previous,
          [projectId]: {
            status: "error",
            options,
            error: message,
            errorKind: "start",
          },
        }));
        addToast({
          type: "error",
          message: translate(projectMessages, "setupFailed", { name: projectName, message }),
          autoDismissMs: 0,
        });
      });
  };

  const handleAddProject = async (project: AddProjectModalSubmission) => {
    if (project.type === "new_project") {
      const isLocalProject = project.initMode === "new-local";
      const sourceRef = isLocalProject
        ? project.path || project.name
        : project.repoSlug || project.name;

      await createProject({
        name: project.name,
        sourceType: isLocalProject ? "local" : "git",
        sourceRef,
        initMode: project.initMode,
        remoteProvider: project.remoteProvider,
        isPrivate: project.isPrivate,
        settingsOverrides: buildProjectCreationSettingsOverride({
          ...(isLocalProject ? { githubMode: "LOCAL" as const } : {}),
          selectedTechstackId:
            project.selectedTechstackId ?? DEFAULT_DASHBOARD_SETTINGS.techstackCatalog.defaultTechstackId,
          applicationKind: project.applicationKind ?? null,
        }),
      });
      return;
    }

    const createdProject = await createProject({
      name: project.name,
      sourceType: project.type,
      sourceRef: project.path,
      cloneDir: project.cloneDir,
      ...(project.type === "local"
        ? { settingsOverrides: buildProjectCreationSettingsOverride({ githubMode: "LOCAL" }) }
        : {}),
    });
    if (project.setup?.enabled) {
      launchProjectSetup(createdProject.id, createdProject.name, project.setup.options);
    }
  };

  const handleRunSetup = () => {
    if (!setupProjectId || setupOperationTokensRef.current.has(setupProjectId)) return;
    const project = activeSetupProject;
    if (project) launchProjectSetup(project.id, project.name, setupOptions);
  };

  const openSetupDialog = (projectId: string) => {
    if (setupProjectId && setupProjectId !== projectId) stopSetupPolling(setupProjectId);
    const previousSetupState = setupStateByProjectId[projectId];
    if (previousSetupState?.status === "success") {
      setSetupStateByProjectId((previous) => {
        const next = { ...previous };
        delete next[projectId];
        return next;
      });
    }
    setSetupProjectId(projectId);
    setSetupOptions(previousSetupState?.status === "error" ? previousSetupState.options : createDefaultSetupOptions());
  };

  const closeSetupDialog = () => {
    if (setupProjectId) stopSetupPolling(setupProjectId);
    setSetupProjectId(null);
  };

  const retryProjectSetup = (projectId: string) => {
    const project = sources.find((candidate) => candidate.id === projectId);
    const setupState = setupStateByProjectId[projectId];
    if (!project || !setupState) return;
    if (setupState.errorKind === "poll" && setupState.invocationId) {
      const operationToken = setupOperationTokensRef.current.get(projectId);
      if (operationToken !== undefined) {
        setSetupStateByProjectId((previous) => ({
          ...previous,
          [projectId]: { ...setupState, status: "running", error: undefined, errorKind: undefined },
        }));
        startSetupPolling(project.id, project.name, setupState.invocationId, operationToken);
      }
      return;
    }
    launchProjectSetup(project.id, project.name, setupState.options);
  };

  const openDeleteDialog = (projectId: string) => {
    if (deletingProjectIdsRef.current.has(projectId)) return;
    const project = sources.find((candidate) => candidate.id === projectId);
    if (!project) return;
    deleteTriggerRef.current = document.activeElement as HTMLElement | null;
    setDeleteProjectId(projectId);
    void deleteConfirm.requestConfirm({
      title: translate(projectMessages, "confirmDeleteTitle", { name: project.name }),
      body: translate(projectMessages, "confirmDeleteDescription"),
      confirmLabel: translate(projectMessages, "confirmDelete"),
      cancelLabel: translate(projectMessages, "cancel"),
      tone: "danger",
    });
  };

  const closeDeleteDialog = () => {
    deleteConfirm.handleCancel();
    setDeleteProjectId(null);
    const trigger = deleteTriggerRef.current;
    window.setTimeout(() => {
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    }, 0);
  };

  const handleDeleteProject = async () => {
    if (!activeDeleteProject || deletingProjectIdsRef.current.has(activeDeleteProject.id)) return;
    const project = activeDeleteProject;
    const visibleIndex = viewModel.visibleProjects.findIndex((candidate) => candidate.id === project.id);
    const focusProject = viewModel.visibleProjects[visibleIndex + 1] ?? viewModel.visibleProjects[visibleIndex - 1];
    deletingProjectIdsRef.current.add(project.id);
    setDeletingProjectIds((previous) => new Set(previous).add(project.id));
    setDeleteErrorByProjectId((previous) => {
      const next = { ...previous };
      delete next[project.id];
      return next;
    });
    setPageFeedback(null);
    try {
      await deleteProject(project.id);
      stopSetupPolling(project.id);
      setupOperationTokensRef.current.delete(project.id);
      setPageFeedback({
        tone: "success",
        message: translate(projectMessages, "deleteSucceeded", { name: project.name }),
      });
      setAnnouncement(translate(projectMessages, "deleteSucceeded", { name: project.name }));
      setFocusAfterDeleteProjectId(focusProject?.id ?? "add-project");
    } catch (deleteFailure) {
      const message = deleteFailure instanceof Error ? deleteFailure.message : String(deleteFailure);
      const localizedError = translate(projectMessages, "deleteFailed", { message });
      setDeleteErrorByProjectId((previous) => ({ ...previous, [project.id]: localizedError }));
      setPageFeedback({ tone: "error", message: localizedError });
      const trigger = deleteTriggerRef.current;
      window.setTimeout(() => {
        if (trigger?.isConnected) trigger.focus({ preventScroll: true });
      }, 0);
    } finally {
      deletingProjectIdsRef.current.delete(project.id);
      setDeletingProjectIds((previous) => {
        const next = new Set(previous);
        next.delete(project.id);
        return next;
      });
      deleteConfirm.handleConfirm();
      setDeleteProjectId(null);
    }
  };

  const handleProjectSelection = (projectId: string, projectName: string) => {
    void selectProject(projectId);
    if (selectedProjectId !== projectId) {
      setAnnouncement(translate(projectMessages, "selectionChanged", { name: projectName }));
    }
  };

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      for (const run of setupPollingRunsRef.current.values()) {
        if (run.timerId !== null) window.clearTimeout(run.timerId);
      }
      setupPollingRunsRef.current.clear();
      setupPollingGenerationRef.current.clear();
    };
  }, []);

  useEffect(() => {
    for (const projectId of setupOperationTokensRef.current.keys()) {
      if (!sources.some((source) => source.id === projectId)) {
        stopSetupPolling(projectId);
        setupOperationTokensRef.current.delete(projectId);
      }
    }
  }, [sources]);

  useEffect(() => {
    setAnnouncement(translatePlural(projectMessages, "filterResultCount", viewModel.visibleProjects.length, {
      filter: translate(
        projectMessages,
        PROJECT_FILTER_DEFINITIONS.find(({ filter }) => filter === activeFilter)?.labelKey ?? "filterAll",
      ),
    }));
  }, [activeFilter, translate, translatePlural, viewModel.visibleProjects.length]);

  useEffect(() => {
    const previousSelectedProjectId = previousSelectedProjectIdRef.current;
    previousSelectedProjectIdRef.current = selectedProjectId;
    if (!previousSelectedProjectId || !selectedProjectId || previousSelectedProjectId === selectedProjectId) return;
    const selectedProject = sources.find((source) => source.id === selectedProjectId);
    if (selectedProject) {
      setAnnouncement(translate(projectMessages, "selectionChanged", { name: selectedProject.name }));
    }
  }, [selectedProjectId, sources, translate]);

  useEffect(() => {
    if (!focusAfterDeleteProjectId) return;
    const timerId = window.setTimeout(() => {
      const focusTarget = document.querySelector<HTMLElement>(
        focusAfterDeleteProjectId === "add-project"
          ? '[data-project-focus-id="add-project"]'
          : `[data-project-focus-id="${CSS.escape(focusAfterDeleteProjectId)}"]`,
      );
      if (focusTarget) {
        focusTarget.focus({ preventScroll: true });
        setFocusAfterDeleteProjectId(null);
      }
    }, 0);
    return () => window.clearTimeout(timerId);
  }, [focusAfterDeleteProjectId, sources, viewModel.visibleProjects]);

  return (
    <>
      <PageContainer aria-label={translate(projectMessages, "projects")} className="min-w-0 gap-7 overflow-x-clip">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-72 bg-[radial-gradient(ellipse_at_top_left,rgba(0,171,132,0.07),transparent_58%)] dark:bg-[radial-gradient(ellipse_at_top_left,rgba(0,171,132,0.09),transparent_58%)]"
        />

        <PageHeader
          icon={FolderOpen}
          eyebrow={translate(projectMessages, "sourceRepositories")}
          title={translate(projectMessages, "manageProjects")}
          subtitle={translate(projectMessages, "projectsSubtitle")}
          actions={(
            <>
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                {viewModel.runningCount > 0 ? (
                  <span className="inline-flex items-center gap-2 rounded-full border border-status-green/20 bg-status-green/[0.07] px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-status-green">
                    <span className="h-1.5 w-1.5 rounded-full bg-status-green" aria-hidden="true" />
                    {translatePlural(projectMessages, "runningCount", viewModel.runningCount)}
                  </span>
                ) : null}
                <span className="inline-flex items-center gap-2 rounded-full border border-black/[0.07] bg-white/55 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-300">
                  <FolderOpen className="h-3 w-3" aria-hidden="true" />
                  {translatePlural(projectMessages, "totalCount", viewModel.totalCount)}
                </span>
              </div>
              <button
                type="button"
                onClick={() => openAddProject("new_project")}
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-signal-500 px-4 text-sm font-semibold text-white shadow-sm motion-safe:transition-colors motion-safe:duration-150 hover:bg-signal-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-void-900"
              >
                <Sparkles className="h-4 w-4" aria-hidden="true" />
                {translate(projectMessages, "newProject")}
              </button>
            </>
          )}
        />

        <div
          role="tablist"
          aria-label={translate(projectMessages, "filterProjects")}
          className="flex w-full min-w-0 flex-wrap gap-1.5 rounded-2xl border border-black/[0.06] bg-white/50 p-1.5 shadow-sm backdrop-blur-xl dark:border-white/[0.07] dark:bg-void-800/45 sm:w-fit"
        >
          {PROJECT_FILTER_DEFINITIONS.map(({ filter, labelKey }) => {
            const isActive = activeFilter === filter;
            return (
              <button
                key={filter}
                type="button"
                role="tab"
                aria-selected={isActive}
                aria-controls="project-card-region"
                onClick={() => setActiveFilter(filter)}
                className={`inline-flex min-h-9 min-w-0 flex-1 items-center justify-center gap-2 rounded-xl px-3 text-xs font-semibold motion-safe:transition-colors motion-safe:duration-150 sm:flex-none ${
                  isActive
                    ? "bg-slate-900 text-white shadow-sm dark:bg-white dark:text-void-900"
                    : "text-slate-500 hover:bg-black/[0.04] hover:text-slate-800 dark:text-slate-400 dark:hover:bg-white/[0.05] dark:hover:text-white"
                }`}
              >
                <span className="truncate">{translate(projectMessages, labelKey)}</span>
                <span
                  className={`shrink-0 rounded-md px-1.5 py-0.5 font-mono text-[9px] ${
                    isActive
                      ? "bg-white/[0.14] text-white dark:bg-black/[0.09] dark:text-void-900"
                      : "bg-black/[0.05] text-slate-400 dark:bg-white/[0.06]"
                  }`}
                >
                  {formatNumber(viewModel.counts[filter])}
                </span>
              </button>
            );
          })}
        </div>

        <div className="sr-only" aria-live="polite" aria-atomic="true">
          {announcement}
        </div>

        <div
          id="project-card-region"
          role="region"
          aria-label={translate(projectMessages, "projectCards")}
          aria-busy={loading ? "true" : undefined}
          className="min-w-0"
        >
          {pageFeedback ? (
            <div
              role={pageFeedback.tone === "error" ? "alert" : "status"}
              aria-live={pageFeedback.tone === "error" ? "assertive" : "polite"}
              className={`mb-4 flex min-w-0 items-center justify-between gap-3 rounded-2xl border p-4 text-sm font-semibold ${
                pageFeedback.tone === "error"
                  ? "border-status-red/20 bg-status-red/[0.07] text-status-red"
                  : "border-status-green/20 bg-status-green/[0.07] text-status-green"
              }`}
            >
              <span>{pageFeedback.message}</span>
              <button
                type="button"
                onClick={() => setPageFeedback(null)}
                className="shrink-0 rounded-lg px-2 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current"
              >
                {translate(projectMessages, "dismiss")}
              </button>
            </div>
          ) : null}
          {loading ? (
            <div role="status" aria-live="polite" aria-busy="true" className="min-w-0">
              <span className="sr-only">{translate(projectMessages, "loadingProjects")}</span>
              <SkeletonLoader
                show
                loadingLabel=""
                skeleton={(
                  <div className="grid min-w-0 grid-cols-[repeat(auto-fill,minmax(min(100%,320px),1fr))] gap-5">
                    <SkeletonPanel />
                    <SkeletonPanel />
                    <SkeletonPanel />
                  </div>
                )}
              />
            </div>
          ) : error ? (
            <div role="alert" aria-live="assertive" className="flex min-w-0 flex-col items-start gap-4 rounded-2xl border border-status-red/20 bg-status-red/[0.06] p-5 text-status-red sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="font-display text-base font-semibold">{translate(projectMessages, "projectsLoadFailed")}</p>
                <p className="mt-1 break-words text-sm">{error}</p>
              </div>
              <button
                type="button"
                onClick={() => openAddProject("local")}
                className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-xl border border-status-red/25 bg-white/60 px-4 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-status-red dark:bg-white/[0.06]"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                {translate(projectMessages, "addProject")}
              </button>
            </div>
          ) : (
            <div
              role="list"
              aria-label={translate(projectMessages, "projectList")}
              className="grid min-w-0 grid-cols-[repeat(auto-fill,minmax(min(100%,320px),1fr))] gap-5 motion-reduce:transition-none"
            >
              {viewModel.isEmpty ? (
                <div role="listitem">
                  <div role="status" aria-live="polite" className="flex min-h-[390px] min-w-0 flex-col items-center justify-center rounded-[1.5rem] border border-black/[0.07] bg-white/55 p-6 text-center shadow-sm backdrop-blur-xl dark:border-white/[0.08] dark:bg-void-800/50">
                    <FolderOpen className="h-8 w-8 text-signal-500" aria-hidden="true" />
                    <p className="mt-4 font-display text-lg font-semibold text-slate-900 dark:text-white">{translate(projectMessages, "noProjects")}</p>
                    <p className="mt-2 max-w-xs text-sm leading-relaxed text-slate-500 dark:text-slate-400">{translate(projectMessages, "noProjectsDescription")}</p>
                  </div>
                </div>
              ) : null}

              {viewModel.isFilteredEmpty ? (
                <div role="listitem">
                  <div role="status" aria-live="polite" className="flex min-h-[390px] min-w-0 flex-col items-center justify-center rounded-[1.5rem] border border-black/[0.07] bg-white/55 p-6 text-center shadow-sm backdrop-blur-xl dark:border-white/[0.08] dark:bg-void-800/50">
                    <p className="font-display text-lg font-semibold text-slate-900 dark:text-white">{
                      translate(
                        projectMessages,
                        PROJECT_FILTER_DEFINITIONS.find(({ filter }) => filter === activeFilter)?.emptyMessageKey ?? "noProjects",
                      )
                    }</p>
                    <p className="mt-2 max-w-xs text-sm leading-relaxed text-slate-500 dark:text-slate-400">{translate(projectMessages, "filteredEmptyDescription")}</p>
                    <button
                      type="button"
                      onClick={() => setActiveFilter("All")}
                      className="mt-5 rounded-xl border border-black/[0.09] bg-white/60 px-4 py-2 text-sm font-semibold text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 dark:border-white/[0.1] dark:bg-white/[0.05] dark:text-slate-200"
                    >
                      {translate(projectMessages, "showAllProjects")}
                    </button>
                  </div>
                </div>
              ) : null}

              {viewModel.visibleProjects.map((source) => (
                <div key={source.id} role="listitem" className="h-full min-w-0 motion-reduce:transition-none">
                  <ProjectCard
                    source={source}
                    isSelected={selectedProjectId === source.id}
                    isSettingUp={setupStateByProjectId[source.id]?.status === "starting" || setupStateByProjectId[source.id]?.status === "running"}
                    setupInvocationId={setupStateByProjectId[source.id]?.invocationId ?? null}
                    setupFeedback={setupStateByProjectId[source.id]?.status === "success"
                      ? { tone: "success", message: translate(projectMessages, "setupCardSucceeded") }
                      : setupStateByProjectId[source.id]?.status === "error"
                        ? {
                            tone: "error",
                            message: translate(projectMessages, "setupCardFailed", {
                              message: setupStateByProjectId[source.id]?.error ?? translate(projectMessages, "setupInvocationFailed"),
                            }),
                          }
                        : undefined}
                    isDeleting={deletingProjectIds.has(source.id)}
                    deleteError={deleteErrorByProjectId[source.id]}
                    onSelect={() => handleProjectSelection(source.id, source.name)}
                    onDelete={() => openDeleteDialog(source.id)}
                    onSetup={() => openSetupDialog(source.id)}
                    onRetrySetup={() => retryProjectSetup(source.id)}
                    onRetryDelete={() => openDeleteDialog(source.id)}
                    onOpenInvocation={() => {
                      const invocationId = setupStateByProjectId[source.id]?.invocationId;
                      if (invocationId) openInvocation(invocationId);
                    }}
                    onSettings={() => openProjectSettings(source.id)}
                  />
                </div>
              ))}

              <div role="listitem" className="h-full min-w-0 motion-reduce:transition-none">
                <AddProjectCard onClick={() => openAddProject("local")} />
              </div>
            </div>
          )}
        </div>
      </PageContainer>

      {showModal ? (
        <AddProjectModal
          onClose={() => setShowModal(false)}
          onAdd={handleAddProject}
          initialSourceType={modalSourceType}
        />
      ) : null}

      {activeSetupProject ? (
        <Modal
          isOpen
          onClose={closeSetupDialog}
          ariaLabelledBy="setup-project-title"
          ariaDescribedBy="setup-project-description"
          initialFocusRef={setupInitialFocusRef}
          className="flex w-full min-w-0 max-w-xl flex-col overflow-hidden !rounded-[1.75rem]"
        >
          <div className="shrink-0 border-b border-black/[0.06] p-5 dark:border-white/[0.08] sm:p-6">
            <div className="flex min-w-0 items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-signal-600 dark:text-signal-300">
                  <Bot className="h-4 w-4 shrink-0" aria-hidden="true" />
                  {translate(projectMessages, "setupAgent")}
                </div>
                <h2 id="setup-project-title" title={activeSetupProject.name} className="mt-3 truncate font-display text-xl font-semibold tracking-tight text-slate-900 dark:text-white sm:text-2xl">
                  {translate(projectMessages, "setupProjectTitle", { name: activeSetupProject.name })}
                </h2>
                <p id="setup-project-description" className="mt-2 text-sm leading-relaxed text-slate-500 dark:text-slate-400">
                  {translate(projectMessages, "setupDescription")}
                </p>
              </div>
              <button
                type="button"
                aria-label={translate(projectMessages, "closeProjectSetup")}
                onClick={closeSetupDialog}
                className="shrink-0 rounded-xl border border-black/[0.07] px-3 py-2 text-xs font-semibold text-slate-500 motion-safe:transition-colors motion-safe:duration-150 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 dark:border-white/[0.08] dark:text-slate-300 dark:hover:text-white"
              >
                {translate(projectMessages, "close")}
              </button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-6">
            <div className="grid min-w-0 gap-2 sm:grid-cols-2">
              {SETUP_OPTIONS.map((option, optionIndex) => (
                <button
                  ref={optionIndex === 0 ? setupInitialFocusRef : undefined}
                  key={option.key}
                  type="button"
                  onClick={() => setSetupOptions((previous) => ({
                    ...previous,
                    [option.key]: !previous[option.key],
                  }))}
                  disabled={isActiveSetupPending}
                  aria-pressed={setupOptions[option.key]}
                  className={`flex min-w-0 items-start gap-3 rounded-2xl border p-4 text-left motion-safe:transition-colors motion-safe:duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 disabled:cursor-not-allowed disabled:opacity-60 ${
                    setupOptions[option.key]
                      ? "border-signal-500/35 bg-signal-500/[0.07] text-slate-900 dark:text-white"
                      : "border-black/[0.07] bg-black/[0.025] text-slate-500 dark:border-white/[0.08] dark:bg-white/[0.035] dark:text-slate-400"
                  }`}
                >
                  {"icon" in option ? (
                    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${setupOptions[option.key] ? "bg-signal-500 text-white" : "bg-black/[0.04] text-slate-400 dark:bg-white/[0.06]"}`}>
                      <option.icon className="h-4 w-4" aria-hidden="true" />
                    </span>
                  ) : null}
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-semibold uppercase tracking-[0.12em]">{translate(projectMessages, option.labelKey)}</span>
                    <span className="mt-1 block text-xs font-medium leading-relaxed opacity-75">{translate(projectMessages, option.descriptionKey)}</span>
                  </span>
                </button>
              ))}
            </div>
            {activeSetupState?.status === "error" ? (
              <div className="mt-4 rounded-2xl bg-status-red/[0.08] p-3 text-sm font-semibold text-status-red" role="alert" aria-live="assertive">
                {translate(projectMessages, "setupCardFailed", { message: activeSetupState.error ?? translate(projectMessages, "setupInvocationFailed") })}
              </div>
            ) : null}
            {activeSetupState?.invocationId ? (
              <button
                type="button"
                onClick={() => openInvocation(activeSetupState.invocationId!)}
                className="mt-4 min-h-10 rounded-xl border border-signal-500/25 px-4 text-sm font-semibold text-signal-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 dark:text-signal-300"
              >
                {translate(projectMessages, "openInvocation")}
              </button>
            ) : null}
          </div>

          <div className="flex shrink-0 flex-col-reverse items-stretch justify-end gap-3 border-t border-black/[0.06] p-5 dark:border-white/[0.08] sm:flex-row sm:items-center sm:p-6">
            <button
              type="button"
              onClick={closeSetupDialog}
              className="min-h-11 rounded-xl px-4 text-sm font-semibold text-slate-500 motion-safe:transition-colors motion-safe:duration-150 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 dark:hover:text-white"
            >
              {translate(projectMessages, isActiveSetupPending ? "close" : "cancel")}
            </button>
            <button
              type="button"
              onClick={activeSetupState?.status === "error" ? () => retryProjectSetup(activeSetupProject.id) : handleRunSetup}
              disabled={isActiveSetupPending || activeSetupState?.status === "success"}
              aria-busy={isActiveSetupPending || undefined}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-signal-500 px-5 text-sm font-semibold text-white shadow-sm motion-safe:transition-colors motion-safe:duration-150 hover:bg-signal-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500 dark:focus-visible:ring-offset-void-800"
            >
              {isActiveSetupPending ? (
                <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />
              ) : (
                <Bot className="h-4 w-4" aria-hidden="true" />
              )}
              {translate(projectMessages, isActiveSetupPending ? "settingUp" : activeSetupState?.status === "error" ? "retry" : activeSetupState?.status === "success" ? "setupComplete" : "runSetupProject")}
            </button>
          </div>
        </Modal>
      ) : null}

      <ConfirmDialog
        isOpen={deleteConfirm.isOpen}
        options={deleteConfirm.options}
        onConfirm={handleDeleteProject}
        onCancel={closeDeleteDialog}
        restoreFocus={false}
      />
    </>
  );
};
