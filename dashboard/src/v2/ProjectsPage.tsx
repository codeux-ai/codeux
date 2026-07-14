import type { FunctionComponent } from "preact";
import { useMemo, useState } from "preact/hooks";
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

export const ProjectsPage: FunctionComponent = () => {
  const navigate = useNavigate();
  const { formatNumber, translate, translatePlural } = useDashboardI18n();
  const [showModal, setShowModal] = useState(false);
  const [modalSourceType, setModalSourceType] = useState<AddProjectModalSourceType>("local");
  const [setupProjectId, setSetupProjectId] = useState<string | null>(null);
  const [runningSetupProjectIds, setRunningSetupProjectIds] = useState<Set<string>>(() => new Set());
  const [setupInvocationByProjectId, setSetupInvocationByProjectId] = useState<Record<string, string>>({});
  const [setupError, setSetupError] = useState<string | null>(null);
  const [deleteProjectId, setDeleteProjectId] = useState<string | null>(null);
  const [isDeletingProject, setIsDeletingProject] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [setupOptions, setSetupOptions] = useState<ProjectSetupOptions>(() => createDefaultSetupOptions());
  const [activeFilter, setActiveFilter] = useState<ProjectFilter>("All");
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

  const waitForSetupInvocation = async (projectId: string, invocationId: string) => {
    for (;;) {
      await new Promise((resolve) => window.setTimeout(resolve, 3000));
      const invocations = await fetchProjectInvocations(projectId);
      const invocation = invocations.find((candidate) => candidate.id === invocationId);
      if (!invocation || invocation.status === "running") continue;
      return invocation;
    }
  };

  const launchProjectSetup = (
    projectId: string,
    projectName: string,
    options: ProjectSetupOptions,
  ) => {
    setRunningSetupProjectIds((previous) => new Set(previous).add(projectId));
    addToast({
      type: "info",
      message: translate(projectMessages, "setupStarting", { name: projectName }),
      autoDismissMs: 7000,
    });

    void startProjectSetup(projectId, { enabled: true, options })
      .then((started) => {
        setSetupInvocationByProjectId((previous) => ({
          ...previous,
          [projectId]: started.invocationId,
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
        return waitForSetupInvocation(projectId, started.invocationId).then((invocation) => ({
          started,
          invocation,
        }));
      })
      .then(({ started, invocation }) => {
        if (invocation.status === "failed") {
          throw new Error(invocation.lastErrorMessage || translate(projectMessages, "setupInvocationFailed"));
        }
        addToast({
          type: "success",
          message: translate(projectMessages, "setupFinished", { name: projectName }),
          autoDismissMs: 9000,
          action: {
            label: translate(projectMessages, "openInvocation"),
            onClick: () => openInvocation(started.invocationId),
          },
        });
      })
      .catch((setupFailure) => {
        const message = setupFailure instanceof Error ? setupFailure.message : String(setupFailure);
        addToast({
          type: "error",
          message: translate(projectMessages, "setupFailed", { name: projectName, message }),
          autoDismissMs: 0,
        });
      })
      .finally(() => {
        setRunningSetupProjectIds((previous) => {
          const next = new Set(previous);
          next.delete(projectId);
          return next;
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

  const activeSetupProject = sources.find((source) => source.id === setupProjectId) ?? null;
  const activeDeleteProject = sources.find((source) => source.id === deleteProjectId) ?? null;
  const isActiveSetupRunning = activeSetupProject
    ? runningSetupProjectIds.has(activeSetupProject.id)
    : false;

  const handleRunSetup = () => {
    if (!setupProjectId) return;
    setSetupError(null);
    const project = activeSetupProject;
    setSetupProjectId(null);
    if (project) launchProjectSetup(project.id, project.name, setupOptions);
  };

  const openSetupDialog = (projectId: string) => {
    setSetupProjectId(projectId);
    setSetupOptions(createDefaultSetupOptions());
    setSetupError(null);
  };

  const openDeleteDialog = (projectId: string) => {
    setDeleteProjectId(projectId);
    setDeleteError(null);
  };

  const closeDeleteDialog = () => {
    if (isDeletingProject) return;
    setDeleteProjectId(null);
    setDeleteError(null);
  };

  const handleDeleteProject = async () => {
    if (!activeDeleteProject || isDeletingProject) return;
    setIsDeletingProject(true);
    setDeleteError(null);
    try {
      await deleteProject(activeDeleteProject.id);
      setDeleteProjectId(null);
    } catch (deleteFailure) {
      const message = deleteFailure instanceof Error ? deleteFailure.message : String(deleteFailure);
      setDeleteError(translate(projectMessages, "deleteFailed", { message }));
    } finally {
      setIsDeletingProject(false);
    }
  };

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
                    {translatePlural(projectMessages, "runningCount", viewModel.runningCount, {
                      count: formatNumber(viewModel.runningCount),
                    })}
                  </span>
                ) : null}
                <span className="inline-flex items-center gap-2 rounded-full border border-black/[0.07] bg-white/55 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-300">
                  <FolderOpen className="h-3 w-3" aria-hidden="true" />
                  {translatePlural(projectMessages, "totalCount", viewModel.totalCount, {
                    count: formatNumber(viewModel.totalCount),
                  })}
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

        <div
          id="project-card-region"
          role="region"
          aria-label={translate(projectMessages, "projectCards")}
          aria-busy={loading ? "true" : undefined}
          className="min-w-0"
        >
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
            <div className="grid min-w-0 grid-cols-[repeat(auto-fill,minmax(min(100%,320px),1fr))] gap-5">
              {viewModel.isEmpty ? (
                <div role="status" aria-live="polite" className="flex min-h-[390px] min-w-0 flex-col items-center justify-center rounded-[1.5rem] border border-black/[0.07] bg-white/55 p-6 text-center shadow-sm backdrop-blur-xl dark:border-white/[0.08] dark:bg-void-800/50">
                  <FolderOpen className="h-8 w-8 text-signal-500" aria-hidden="true" />
                  <p className="mt-4 font-display text-lg font-semibold text-slate-900 dark:text-white">{translate(projectMessages, "noProjects")}</p>
                  <p className="mt-2 max-w-xs text-sm leading-relaxed text-slate-500 dark:text-slate-400">{translate(projectMessages, "noProjectsDescription")}</p>
                </div>
              ) : null}

              {viewModel.isFilteredEmpty ? (
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
              ) : null}

              {viewModel.visibleProjects.map((source) => (
                <div key={source.id} className="h-full min-w-0">
                  <ProjectCard
                    source={source}
                    isSelected={selectedProjectId === source.id}
                    isSettingUp={runningSetupProjectIds.has(source.id)}
                    setupInvocationId={setupInvocationByProjectId[source.id] ?? null}
                    onSelect={() => { void selectProject(source.id); }}
                    onDelete={() => openDeleteDialog(source.id)}
                    onSetup={() => openSetupDialog(source.id)}
                    onOpenInvocation={() => {
                      const invocationId = setupInvocationByProjectId[source.id];
                      if (invocationId) openInvocation(invocationId);
                    }}
                    onSettings={() => openProjectSettings(source.id)}
                  />
                </div>
              ))}

              <div className="h-full min-w-0">
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
        <div
          className="fixed inset-0 z-[210] flex items-center justify-center overflow-hidden bg-black/55 p-4 backdrop-blur-xl sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-labelledby="setup-project-title"
          aria-describedby="setup-project-description"
          aria-busy={isActiveSetupRunning || undefined}
        >
          <div className="flex max-h-[calc(100vh-2rem)] w-full min-w-0 max-w-xl flex-col overflow-hidden rounded-[1.75rem] border border-black/[0.06] bg-white shadow-[0_32px_80px_rgba(0,0,0,0.28)] dark:border-white/[0.08] dark:bg-void-800">
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
                  onClick={() => setSetupProjectId(null)}
                  disabled={isActiveSetupRunning}
                  className="shrink-0 rounded-xl border border-black/[0.07] px-3 py-2 text-xs font-semibold text-slate-500 motion-safe:transition-colors motion-safe:duration-150 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.08] dark:text-slate-300 dark:hover:text-white"
                >
                  {translate(projectMessages, "close")}
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-6">
              <div className="grid min-w-0 gap-2 sm:grid-cols-2">
                {SETUP_OPTIONS.map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() => setSetupOptions((previous) => ({
                      ...previous,
                      [option.key]: !previous[option.key],
                    }))}
                    disabled={isActiveSetupRunning}
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
              {setupError ? (
                <div className="mt-4 rounded-2xl bg-status-red/[0.08] p-3 text-sm font-semibold text-status-red" role="alert" aria-live="assertive">
                  {setupError}
                </div>
              ) : null}
            </div>

            <div className="flex shrink-0 flex-col-reverse items-stretch justify-end gap-3 border-t border-black/[0.06] p-5 dark:border-white/[0.08] sm:flex-row sm:items-center sm:p-6">
              <button
                type="button"
                onClick={() => setSetupProjectId(null)}
                disabled={isActiveSetupRunning}
                className="min-h-11 rounded-xl px-4 text-sm font-semibold text-slate-500 motion-safe:transition-colors motion-safe:duration-150 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:text-white"
              >
                {translate(projectMessages, "cancel")}
              </button>
              <button
                type="button"
                onClick={handleRunSetup}
                disabled={isActiveSetupRunning}
                aria-busy={isActiveSetupRunning || undefined}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-signal-500 px-5 text-sm font-semibold text-white shadow-sm motion-safe:transition-colors motion-safe:duration-150 hover:bg-signal-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500 dark:focus-visible:ring-offset-void-800"
              >
                {isActiveSetupRunning ? (
                  <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />
                ) : (
                  <Bot className="h-4 w-4" aria-hidden="true" />
                )}
                {translate(projectMessages, isActiveSetupRunning ? "settingUp" : "runSetupProject")}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {activeDeleteProject ? (
        <div
          className="fixed inset-0 z-[220] flex items-center justify-center bg-black/55 p-4 backdrop-blur-xl"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-project-title"
          aria-describedby="delete-project-description"
          aria-busy={isDeletingProject || undefined}
        >
          <div className="w-full max-w-md rounded-[1.75rem] border border-black/[0.06] bg-white p-6 shadow-[0_32px_80px_rgba(0,0,0,0.28)] dark:border-white/[0.08] dark:bg-void-800 sm:p-7">
            <h2 id="delete-project-title" className="font-display text-xl font-semibold text-slate-900 dark:text-white">
              {translate(projectMessages, "confirmDeleteTitle", { name: activeDeleteProject.name })}
            </h2>
            <p id="delete-project-description" className="mt-3 text-sm leading-relaxed text-slate-500 dark:text-slate-400">
              {translate(projectMessages, "confirmDeleteDescription")}
            </p>
            {deleteError ? (
              <p role="alert" aria-live="assertive" className="mt-4 rounded-xl bg-status-red/[0.08] p-3 text-sm font-semibold text-status-red">
                {deleteError}
              </p>
            ) : null}
            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={closeDeleteDialog}
                disabled={isDeletingProject}
                className="min-h-11 rounded-xl px-4 text-sm font-semibold text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-300"
              >
                {translate(projectMessages, "cancel")}
              </button>
              <button
                type="button"
                onClick={() => { void handleDeleteProject(); }}
                disabled={isDeletingProject}
                aria-busy={isDeletingProject || undefined}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-status-red px-5 text-sm font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-status-red focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:focus-visible:ring-offset-void-800"
              >
                {isDeletingProject ? <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" /> : null}
                {translate(projectMessages, isDeletingProject ? "deletingProject" : "confirmDelete")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
};
