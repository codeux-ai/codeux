/* istanbul ignore file */
import type { FunctionComponent } from "preact";
import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import gsap from "gsap";
import {
  Activity,
  ArrowRight,
  CheckCircle2,
  CheckSquare,
  Download,
  Eye,
  EyeOff,
  FolderOpen,
  Heart,
  Layers,
  Pencil,
  Plus,
  Radio,
  Sparkles,
  Target,
  X,
  XCircle,
  Zap,
} from "lucide-preact";
import { SprintBubble } from "../../components/ui/SprintBubble.js";
import { SprintLedger } from "../../components/sprints/SprintLedger.js";
import { QuicksprintPanel } from "../../components/quicksprint/QuicksprintPanel.js";
import { AddTaskModal } from "../../components/ui/AddTaskModal.js";
import { SprintComposer } from "../../components/ui/SprintComposer.js";
import { AddProjectModal } from "../../components/ui/AddProjectModal.js";
import { SprintMarkdownModal } from "../../components/ui/SprintMarkdownModal.js";
import { SprintSettingsOverrideModal } from "../../components/ui/SprintSettingsOverrideModal.js";
import { SprintImportMenu } from "../../components/sprints/SprintImportMenu.js";
import { SprintIssueImportModal } from "../../components/sprints/SprintIssueImportModal.js";
import { SprintJiraImportModal } from "../../components/sprints/SprintJiraImportModal.js";
import { ActionFeedbackRegion } from "../../components/ui/ActionFeedbackRegion.js";
import { useSprintsPageData } from "./use-sprints-page-data.js";
import { useProgressiveList } from "../../hooks/use-progressive-list.js";
import { DEFAULT_LIST_WINDOW, type ListWindowOption } from "../../lib/list-window.js";
import { ExecutionTimelineProvider } from "../../../hooks/ExecutionTimelineContext.js";
import { useReducedMotion } from "../../hooks/use-reduced-motion.js";
import { PageContainer } from "../../components/ui/PageContainer.js";
import type { SprintLinkedIssueInput } from "../../types.js";

const ACCENT_CYCLE = ["text-signal-500", "text-ember-500", "text-status-green"] as const;
const SPRINT_GALLERY_VISIBILITY_STORAGE_KEY = "code_ux_sprints_show_gallery";

const readStoredSprintGalleryVisibility = (): boolean => {
  try {
    return window.localStorage.getItem(SPRINT_GALLERY_VISIBILITY_STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
};

const storeSprintGalleryVisibility = (visible: boolean): void => {
  try {
    window.localStorage.setItem(SPRINT_GALLERY_VISIBILITY_STORAGE_KEY, String(visible));
  } catch {
    // Ignore unavailable browser storage.
  }
};

const SprintsProjectPlaceholder: FunctionComponent<{
  hasProjects: boolean;
  onAddProject: () => void;
}> = ({ hasProjects, onAddProject }) => (
  <div className="relative overflow-hidden rounded-[2.2rem] border border-black/[0.06] bg-white/72 p-8 shadow-[0_18px_48px_rgba(15,23,42,0.07)] backdrop-blur-2xl dark:border-white/[0.06] dark:bg-void-800/62 dark:shadow-[0_18px_48px_rgba(0,0,0,0.28)] md:p-10">
    <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_70%_55%_at_50%_30%,rgba(0,224,160,0.09),transparent_62%)] dark:bg-[radial-gradient(ellipse_70%_55%_at_50%_30%,rgba(0,224,160,0.13),transparent_62%)]" />
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <div className="h-56 w-56 rounded-full border border-signal-500/14 animate-[ping_5.2s_cubic-bezier(0.1,0.5,0.8,1)_infinite]" />
      <div className="absolute h-80 w-80 rounded-full border border-ember-500/10 animate-[ping_8s_cubic-bezier(0.1,0.5,0.8,1)_infinite]" />
      <div className="absolute h-[30rem] w-[30rem] rounded-full border border-black/[0.035] animate-[ping_10.5s_cubic-bezier(0.1,0.5,0.8,1)_infinite] dark:border-white/[0.04]" />
    </div>

    <div className="relative z-10 grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-center">
      <div>
        <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-[1.35rem] border border-signal-500/20 bg-signal-500/10 text-signal-500 shadow-[0_0_32px_rgba(0,224,160,0.16)]">
          <Layers className="h-7 w-7" strokeWidth={1.7} />
        </div>
        <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-signal-500">
          Sprint Workspace Standby
        </div>
        <h2 className="mt-3 max-w-3xl font-display text-4xl font-black leading-[0.98] tracking-tight text-slate-900 dark:text-white md:text-5xl">
          Project scope comes first.
        </h2>
        <p className="mt-5 max-w-2xl text-sm font-medium leading-relaxed text-slate-500 dark:text-slate-400 md:text-base">
          Projects scope the sprint gallery. Select a project from the top navigation before creating or planning sprints.
        </p>

        <div className="mt-8 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={onAddProject}
            className="inline-flex min-h-[44px] items-center gap-2.5 rounded-full bg-signal-500 px-5 py-2.5 text-[10px] font-bold uppercase tracking-[0.14em] text-void-900 shadow-[0_10px_30px_rgba(0,224,160,0.22)] transition-all hover:-translate-y-px hover:bg-signal-400 focus-visible:ring-2 focus-visible:ring-signal-500/40"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2.3} />
            {hasProjects ? "Add Project" : "Add First Project"}
          </button>
          <Link
            to="/projects"
            className="inline-flex min-h-[44px] items-center gap-2.5 rounded-full border border-black/[0.06] bg-white/75 px-5 py-2.5 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-600 transition-all hover:-translate-y-px hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-signal-500/40 dark:border-white/[0.06] dark:bg-white/[0.04] dark:text-slate-300 dark:hover:text-white"
          >
            <FolderOpen className="h-3.5 w-3.5 text-ember-500" strokeWidth={2.1} />
            Manage Projects
            <ArrowRight className="h-3.5 w-3.5" strokeWidth={2.1} />
          </Link>
        </div>
      </div>

      <div className="relative overflow-hidden rounded-[1.7rem] border border-black/[0.06] bg-black/[0.025] p-5 dark:border-white/[0.06] dark:bg-white/[0.035]">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_85%_65%_at_50%_0%,rgba(255,184,0,0.12),transparent_68%)]" />
        <div className="relative z-10 space-y-3">
          {[
            { label: "Project", value: hasProjects ? "selectable" : "required", tone: "text-ember-500" },
            { label: "Gallery", value: "waiting", tone: "text-signal-500" },
            { label: "Planning", value: "locked", tone: "text-slate-500 dark:text-slate-400" },
          ].map((item, index) => (
            <div
              key={item.label}
              className="rounded-[1.15rem] border border-white/60 bg-white/72 p-4 shadow-sm dark:border-white/[0.06] dark:bg-white/[0.04]"
            >
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-[9px] font-bold uppercase tracking-[0.16em] text-slate-400">{item.label}</div>
                  <div className={`mt-1 text-xs font-bold uppercase tracking-[0.12em] ${item.tone}`}>{item.value}</div>
                </div>
                <div className={`h-2.5 w-2.5 rounded-full ${index === 0 ? "bg-ember-500" : index === 1 ? "bg-signal-500" : "bg-slate-300 dark:bg-slate-600"}`}>
                  <span className="block h-full w-full rounded-full animate-ping bg-current opacity-40" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  </div>
);

export const SprintsPage: FunctionComponent = () => {
  const headerRef = useRef<HTMLDivElement>(null);
  const bubblesRef = useRef<HTMLDivElement>(null);
  const createStageRef = useRef<HTMLDivElement>(null);
  const prefersReducedMotion = useReducedMotion();
  const [showAddProjectModal, setShowAddProjectModal] = useState(false);
  const [showSprintGallery, setShowSprintGallery] = useState(readStoredSprintGalleryVisibility);
  const [showIssueImportModal, setShowIssueImportModal] = useState(false);
  const [isJiraModalOpen, setIsJiraModalOpen] = useState(false);
  const [linkedIssues, setLinkedIssues] = useState<SprintLinkedIssueInput[]>([]);

  const {
    projects = [],
    selectedProject,
    sortedSprints,
    loading,
    showcaseSprints,
    execution,
    nextId,
    planningRoute,
    completedCount,
    inWorkCount,
    pendingActionIds,
    activeRunsBySprintId,
    interventionBySprintId,
    rowMenu, setRowMenu,
    showCreateComposer, setShowCreateComposer,
    editingSprint, setEditingSprint,
    showImportModal, setShowImportModal,
    exportState, setExportState,
    overrideSprint, setOverrideSprint,
    addTaskForSprint, setAddTaskForSprint,
    addTaskSprintTasks,
    virtualProviders,
    planningEta,
    planningPresets,
    showQuicksprint, setShowQuicksprint,
    quicksprintTemplates,
    quicksprintLoading,
    agentPresets,
    handleQuicksprintExecute,
    handleCreateQuicksprintTemplate,
    handleUpdateQuicksprintTemplate,
    handleDeleteQuicksprintTemplate,
    feedback,
    clearFeedback,
    refreshSprints,
    refreshExecution,
    handleSprintToggle,
    handleMarkCompleted,
    handleSubmitSprint,
    handleImprovePrompt,
    handleCancelPlanningRequest,
    handleOpenAppendTasks,
    handleAppendTask,
    handleDeleteSprint,
    handleToggleShowcase,
    handleBulkToggleShowcase,
    handleOpenExport,
    handleImportSprint,
    handleAddProject = async () => undefined,
  } = useSprintsPageData();

  const progressiveSprints = useProgressiveList(sortedSprints);
  const [listWindow, setListWindow] = useState<ListWindowOption>(DEFAULT_LIST_WINDOW);

  useLayoutEffect(() => {
    const ctx = gsap.context(() => {
      if (!headerRef.current) {
        return;
      }
      if (prefersReducedMotion) {
        gsap.set(Array.from(headerRef.current.children), { opacity: 1, y: 0 });
      } else {
        gsap.fromTo(
          Array.from(headerRef.current.children),
          { opacity: 0, y: 28 },
          { opacity: 1, y: 0, stagger: 0.08, duration: 0.75, ease: "power3.out" },
        );
      }
    });
    return () => ctx.revert();
  }, [prefersReducedMotion]);

  // No auto-scroll when opening the sprint composer — keep viewport stable.

  useEffect(() => {
    storeSprintGalleryVisibility(showSprintGallery);
  }, [showSprintGallery]);

  useEffect(() => {
    if (!rowMenu) {
      return;
    }
    const closeMenu = () => setRowMenu(null);
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeMenu();
      }
    };

    document.addEventListener("click", closeMenu);
    document.addEventListener("keydown", handleEscape);
    window.addEventListener("resize", closeMenu);
    window.addEventListener("scroll", closeMenu, true);


  return () => {
      document.removeEventListener("click", closeMenu);
      document.removeEventListener("keydown", handleEscape);
      window.removeEventListener("resize", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
    };
  }, [rowMenu, setRowMenu]);

  const animateLatestCell = useCallback(() => {
    requestAnimationFrame(() => {
      if (!bubblesRef.current) {
        return;
      }
      const ctx = gsap.context(() => {
        const newCell = bubblesRef.current?.firstElementChild;
        if (!newCell) {
          return;
        }
        if (prefersReducedMotion) {
          gsap.set(newCell, { scale: 1, opacity: 1, y: 0 });
        } else {
          gsap.fromTo(
            newCell,
            { scale: 0.88, opacity: 0, y: 18 },
            { scale: 1, opacity: 1, y: 0, duration: 0.8, ease: "elastic.out(1, 0.65)" },
          );
        }
      });
      // Do not revert this one immediately as it runs on demand,
      // but typically we'd let it run or clean it up if component unmounts.
    });
  }, [prefersReducedMotion]);

  const onSprintSubmit = useCallback(async (payload: any) => {
    await handleSubmitSprint(payload);
    if (!editingSprint) {
        animateLatestCell();
    }
    setLinkedIssues([]);
  }, [handleSubmitSprint, editingSprint, animateLatestCell]);

  useEffect(() => {
    setLinkedIssues(editingSprint?.linkedIssues || []);
  }, [editingSprint?.id]);

  const mergeLinkedIssues = useCallback((issues: SprintLinkedIssueInput[]) => {
    setLinkedIssues((current) => {
      const next = new Map<string, SprintLinkedIssueInput>();
      for (const issue of current) {
        next.set(`${issue.provider}:${issue.hostDomain}:${issue.repository}:${issue.issueNumber}`, issue);
      }
      for (const issue of issues) {
        next.set(`${issue.provider}:${issue.hostDomain}:${issue.repository}:${issue.issueNumber}`, issue);
      }
      return Array.from(next.values());
    });
  }, []);

  const openRowActionsMenu = useCallback((event: MouseEvent, sprintId: string) => {
    event.stopPropagation();
    const trigger = event.currentTarget as HTMLElement;
    const rect = trigger.getBoundingClientRect();
    const estimatedMenuHeight = 228;
    const openUp = rect.bottom + estimatedMenuHeight > window.innerHeight - 16;

    setRowMenu((current) => (
      current?.sprintId === sprintId
        ? null
        : {
          sprintId,
          top: openUp ? rect.top - 8 : rect.bottom + 8,
          left: rect.right,
          openUp,
        }
    ));
  }, [setRowMenu]);

  const activeRowMenuSprint = useMemo(() => rowMenu
    ? sortedSprints.find((sprint) => sprint.id === rowMenu.sprintId) || null
    : null, [rowMenu, sortedSprints]);

  const handleToggleShowcaseWithSprint = useCallback((sprint: any) => {
    void handleToggleShowcase(sprint);
  }, [handleToggleShowcase]);

  const handleBulkStart = useCallback((ids: string[]) => {
    for (const id of ids) handleSprintToggle(id);
  }, [handleSprintToggle]);

  const handleBulkDelete = useCallback((ids: string[]) => {
    for (const id of ids) void handleDeleteSprint(id);
  }, [handleDeleteSprint]);

  const handleBulkShowcaseEnable = useCallback((ids: string[]) => {
    void handleBulkToggleShowcase(ids, true);
  }, [handleBulkToggleShowcase]);

  const handleBulkShowcaseDisable = useCallback((ids: string[]) => {
    void handleBulkToggleShowcase(ids, false);
  }, [handleBulkToggleShowcase]);

  return (
    <ExecutionTimelineProvider
      execution={execution}
      pendingActionIds={pendingActionIds}
    >
      <PageContainer padding={selectedProject ? "standard" : "sprintsEmpty"} className={selectedProject ? "gap-20" : "gap-4"}>
        <div ref={headerRef} className="flex flex-wrap items-end justify-between gap-8">
          <div className="flex flex-col gap-5">
            <div className="flex items-center gap-2.5 font-mono text-xs font-bold uppercase tracking-[0.14em] text-signal-500">
              <Target className="h-4 w-4" strokeWidth={2.5} />
              Iteration Cycles
            </div>
            <h1 className="font-display text-5xl font-black leading-[0.92] tracking-tighter text-slate-900 dark:text-white md:text-7xl">
              Active <br />
              <span className="text-signal-500">Sprints.</span>
            </h1>
            <p className="mt-2 max-w-2xl text-lg font-medium leading-relaxed text-slate-500 dark:text-slate-500">
              {selectedProject
                ? `Define the sprint once for ${selectedProject.name}. The Planning agent can improve the prompt, plan subtasks, and launch the sprint without manual task entry.`
                : "Select a project to manage sprint structure."}
            </p>
            <ActionFeedbackRegion
              status={feedback.status}
              message={feedback.message}
              onDismiss={clearFeedback}
              className="mt-2"
            />
            {selectedProject && (
              <div className={`inline-flex w-fit items-center gap-2 rounded-full border px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] ${
                planningRoute.available
                  ? "border-signal-500/20 bg-signal-500/[0.08] text-signal-600 dark:text-signal-300"
                  : "border-status-red/20 bg-status-red/10 text-status-red"
              }`}>
                <Radio className="h-3.5 w-3.5" strokeWidth={2.1} />
                {planningRoute.available ? `Planning via ${planningRoute.label}` : "No planning worker available"}
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {[
              { label: "Total", value: sortedSprints.length, icon: Target },
              { label: "Completed", value: completedCount, icon: CheckCircle2 },
              { label: "In Work", value: inWorkCount, icon: Activity },
            ].map(({ label, value, icon: Icon }) => (
              <div
                key={label}
                className="inline-flex items-center gap-3 rounded-full border border-black/[0.06] bg-white/72 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-slate-300"
              >
                <Icon className="h-3.5 w-3.5 text-signal-500" strokeWidth={2} />
                {label} <span className="font-mono text-slate-700 dark:text-white">{value}</span>
              </div>
            ))}
            <button
              type="button"
              onClick={() => setShowSprintGallery((current) => !current)}
              disabled={!selectedProject}
              aria-pressed={showSprintGallery}
              className="inline-flex items-center gap-2 rounded-full border border-black/[0.06] bg-white/72 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-600 transition-all hover:-translate-y-px hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-signal-500/40 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-slate-300 dark:hover:text-white"
            >
              {showSprintGallery ? (
                <EyeOff className="h-3.5 w-3.5 text-ember-500" strokeWidth={2.2} />
              ) : (
                <Eye className="h-3.5 w-3.5 text-signal-500" strokeWidth={2.2} />
              )}
              {showSprintGallery ? "Hide Gallery" : "Show Gallery"}
            </button>
            <SprintImportMenu
              disabled={!selectedProject}
              onImportMarkdown={() => setShowImportModal(true)}
              onImportIssues={() => setShowIssueImportModal(true)}
              onImportJira={() => setIsJiraModalOpen(true)}
            />
            <button
              type="button"
              onClick={() => {
                if (showCreateComposer || editingSprint) {
                  setShowCreateComposer(false);
                  setEditingSprint(null);
                }
                setShowQuicksprint(!showQuicksprint);
              }}
              disabled={!selectedProject}
              className={`inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-[10px] font-bold uppercase tracking-[0.14em] transition-all disabled:cursor-not-allowed disabled:opacity-50 ${
                showQuicksprint
                  ? "border border-black/[0.06] bg-white/72 text-slate-600 hover:text-slate-900 dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-slate-300 dark:hover:text-white"
                  : "bg-ember-500 text-void-900 hover:-translate-y-px hover:bg-ember-400"
              }`}
            >
              {showQuicksprint ? <X className="h-3.5 w-3.5" strokeWidth={2.3} /> : <Zap className="h-3.5 w-3.5" strokeWidth={2.3} />}
              {showQuicksprint ? "Close Quicksprint" : "Quicksprint"}
            </button>
            <button
              type="button"
              onClick={() => {
                if (showQuicksprint) {
                  setShowQuicksprint(false);
                }
                if (editingSprint || showCreateComposer) {
                  setEditingSprint(null);
                  setShowCreateComposer(false);
                  setLinkedIssues([]);
                  return;
                }
                setLinkedIssues([]);
                setShowCreateComposer(true);
              }}
              disabled={!selectedProject}
              className={`inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-[10px] font-bold uppercase tracking-[0.14em] transition-all disabled:cursor-not-allowed disabled:opacity-50 ${
                showCreateComposer
                  ? "border border-black/[0.06] bg-white/72 text-slate-600 hover:text-slate-900 dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-slate-300 dark:hover:text-white"
                  : "bg-signal-500 text-void-900 hover:-translate-y-px hover:bg-signal-400"
              }`}
            >
              {(showCreateComposer || editingSprint) ? <X className="h-3.5 w-3.5" strokeWidth={2.3} /> : <Plus className="h-3.5 w-3.5" strokeWidth={2.3} />}
              {(showCreateComposer || editingSprint) ? "Close Composer" : "New Sprint"}
            </button>
          </div>
        </div>

        {selectedProject ? (
          <>
            <div ref={createStageRef} className="relative">
              <div
                className={`transition-all duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                  showCreateComposer || editingSprint || showQuicksprint || !showSprintGallery
                    ? "pointer-events-none max-h-0 overflow-hidden -translate-y-8 scale-[0.985] opacity-0 blur-[10px]"
                    : "max-h-[240rem] overflow-visible translate-y-0 scale-100 opacity-100 blur-0"
                }`}
              >
                <div ref={bubblesRef} className="flex flex-wrap justify-center gap-10 py-6 xl:gap-12">
                  {showcaseSprints.map((sprint, index) => {
                    const activeRun = activeRunsBySprintId.get(sprint.id);
                    const pendingActionId = activeRun ? `sprint-stop:${activeRun.id}` : `sprint-start:${sprint.id}`;
                    const pinActionId = `sprint-showcase:${sprint.id}`;

  return (
                      <SprintBubble
                        key={sprint.id}
                        sprint={sprint}
                        isEven={index % 2 === 0}
                        accentColor={ACCENT_CYCLE[index % ACCENT_CYCLE.length]}
                        primaryBusy={pendingActionIds.has(pendingActionId)}
                        showcaseBusy={pendingActionIds.has(pinActionId)}
                        humanIntervention={interventionBySprintId.get(sprint.id) || null}
                        onPrimaryAction={() => { handleSprintToggle(sprint.id); }}
                        onMarkCompleted={() => { void handleMarkCompleted(sprint.id); }}
                        onEdit={() => {
                          setEditingSprint(sprint);
                          setShowCreateComposer(false);
                          setLinkedIssues(sprint.linkedIssues || []);
                        }}
                        onDelete={() => { void handleDeleteSprint(sprint.id); }}
                        onExport={() => { void handleOpenExport(sprint.id, sprint.name); }}
                        onOverrides={() => { setOverrideSprint(sprint); }}
                        onToggleShowcase={() => { void handleToggleShowcase(sprint); }}
                      />
                    );
                  })}

                  <button
                    type="button"
                    onClick={() => {
                      setEditingSprint(null);
                      setLinkedIssues([]);
                      setShowCreateComposer(true);
                    }}
                    disabled={!selectedProject}
                    className="group relative flex h-72 w-72 shrink-0 cursor-pointer items-center justify-center perspective-1000 lg:h-80 lg:w-80"
                  >
                    <div
                      className="absolute inset-0 animate-organic border-2 border-dashed border-signal-500/25 transition-all duration-500 group-hover:border-signal-500/60"
                      style={{ borderRadius: "40% 60% 70% 30% / 40% 50% 60% 50%" }}
                    />
                    <div
                      className="absolute inset-0 animate-organic-reverse bg-signal-500/0 transition-all duration-500 group-hover:bg-signal-500/[0.04]"
                      style={{ borderRadius: "40% 60% 70% 30% / 40% 50% 60% 50%" }}
                    />
                    <div className="relative z-10 flex flex-col items-center gap-4">
                      <div className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-dashed border-signal-500/30 transition-all duration-400 group-hover:border-signal-500 group-hover:bg-signal-500/10">
                        <Plus className="h-6 w-6 text-signal-500/40 transition-all duration-400 group-hover:rotate-90 group-hover:scale-110 group-hover:text-signal-500" />
                      </div>
                      <div className="flex flex-col items-center gap-1">
                        <span className="text-xs font-bold uppercase tracking-[0.2em] text-slate-300 transition-colors duration-300 group-hover:text-signal-500 dark:text-slate-600">
                          New Sprint
                        </span>
                        <span className="font-mono text-[9px] text-slate-200 transition-colors duration-300 group-hover:text-slate-400 dark:text-slate-700">
                          {nextId.toUpperCase()}
                        </span>
                      </div>
                    </div>
                  </button>
                </div>
              </div>

              <div
                className={`transition-all duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                  showCreateComposer || editingSprint
                    ? "mt-0 max-h-[220rem] overflow-visible translate-y-0 scale-100 opacity-100 blur-0"
                    : "pointer-events-none max-h-0 overflow-hidden translate-y-10 scale-[0.985] opacity-0 blur-[10px]"
                }`}
              >
                <div className="relative">
                  <div className="pointer-events-none absolute inset-0 -z-10 rounded-[2.2rem] bg-[radial-gradient(circle_at_top,rgba(0,224,160,0.08),transparent_46%)] dark:bg-[radial-gradient(circle_at_top,rgba(0,224,160,0.12),transparent_46%)]" />
                  <SprintComposer
                    nextId={nextId}
                    initialSprint={editingSprint}
                    linkedIssues={linkedIssues}
                    virtualProviders={virtualProviders}
                    planningPresets={planningPresets}
                    planningEta={planningEta}
                    onClose={() => {
                      setShowCreateComposer(false);
                      setEditingSprint(null);
                      setLinkedIssues([]);
                    }}
                    onImprovePrompt={handleImprovePrompt}
                    onSubmit={onSprintSubmit}
                    onCancelPlanningRequest={handleCancelPlanningRequest}
                    onStartNewSprint={() => {
                      setEditingSprint(null);
                      setShowCreateComposer(true);
                      setLinkedIssues([]);
                    }}
                    onAppendTasks={editingSprint ? () => { void handleOpenAppendTasks(editingSprint); } : undefined}
                    onRemoveLinkedIssue={(issue) => {
                      setLinkedIssues((current) => current.filter((candidate) => (
                        candidate.provider !== issue.provider
                        || candidate.hostDomain !== issue.hostDomain
                        || candidate.repository !== issue.repository
                        || candidate.issueNumber !== issue.issueNumber
                      )));
                    }}
                  />
                </div>
              </div>

              <div
                className={`transition-all duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                  showQuicksprint
                    ? "mt-0 max-h-[220rem] overflow-visible translate-y-0 scale-100 opacity-100 blur-0"
                    : "pointer-events-none max-h-0 overflow-hidden translate-y-10 scale-[0.985] opacity-0 blur-[10px]"
                }`}
              >
                <div className="relative">
                  <QuicksprintPanel
                    projectId={selectedProject.id}
                    onClose={() => setShowQuicksprint(false)}
                    templates={quicksprintTemplates}
                    loading={quicksprintLoading}
                    agentPresets={agentPresets}

                    virtualProviders={virtualProviders}
                    planningEta={planningEta}
                    onExecute={async (templateId, taskCount, submitMode, additionalPrompt, routeOverride, modelOverride) => {
                      await handleQuicksprintExecute(templateId, taskCount, submitMode, additionalPrompt, routeOverride, modelOverride);
                      animateLatestCell();
                    }}
                    onCreateTemplate={handleCreateQuicksprintTemplate}
                    onUpdateTemplate={handleUpdateQuicksprintTemplate}
                    onDeleteTemplate={handleDeleteQuicksprintTemplate}
                  />
                </div>
              </div>
            </div>

            <div className="rounded-[2.2rem] border border-black/[0.06] bg-white/70 shadow-[0_12px_36px_rgba(15,23,42,0.05)] backdrop-blur-2xl dark:border-white/[0.06] dark:bg-void-800/62 dark:shadow-[0_14px_40px_rgba(0,0,0,0.22)]">
              <SprintLedger
                sprints={progressiveSprints}
                isLoading={loading}
                listWindow={listWindow}
                onListWindowChange={setListWindow}
                activeRunsBySprintId={activeRunsBySprintId}
                interventionBySprintId={interventionBySprintId}
                pendingActionIds={pendingActionIds}
                onToggleShowcase={handleToggleShowcaseWithSprint}
                onSprintToggle={handleSprintToggle}
                onOpenRowMenu={openRowActionsMenu}
                onBulkStart={handleBulkStart}
                onBulkDelete={handleBulkDelete}
                onBulkShowcaseEnable={handleBulkShowcaseEnable}
                onBulkShowcaseDisable={handleBulkShowcaseDisable}
              />
            </div>
          </>
        ) : (
          <SprintsProjectPlaceholder
            hasProjects={projects.length > 0}
            onAddProject={() => setShowAddProjectModal(true)}
          />
        )}
      </PageContainer>

      {showAddProjectModal && (
        <AddProjectModal
          onClose={() => setShowAddProjectModal(false)}
          onAdd={handleAddProject}
        />
      )}

      {rowMenu && activeRowMenuSprint && (
        <div
          className="fixed z-[220]"
          style={{
            top: `${rowMenu.top}px`,
            left: `${rowMenu.left}px`,
            transform: rowMenu.openUp ? "translate(-100%, -100%)" : "translateX(-100%)",
          }}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="min-w-[11.5rem] rounded-[1.2rem] border border-black/[0.08] bg-white p-2 shadow-[0_18px_38px_rgba(15,23,42,0.18)] ring-1 ring-black/[0.03] dark:border-white/[0.08] dark:bg-void-800 dark:ring-white/[0.03]">
            <button
              type="button"
              onClick={() => {
                setRowMenu(null);
                setEditingSprint(activeRowMenuSprint);
                setLinkedIssues(activeRowMenuSprint.linkedIssues || []);
                setShowCreateComposer(false);
              }}
              className="flex w-full items-center gap-2 rounded-[0.9rem] px-3 py-2 text-left text-xs font-medium text-slate-600 transition-colors hover:bg-black/[0.04] hover:text-slate-900 dark:text-slate-300 dark:hover:bg-white/[0.05] dark:hover:text-white"
            >
              <Pencil className="h-3.5 w-3.5" strokeWidth={2.1} />
              Edit
            </button>
            <button
              type="button"
              onClick={() => {
                setRowMenu(null);
                void handleOpenExport(activeRowMenuSprint.id, activeRowMenuSprint.name);
              }}
              className="flex w-full items-center gap-2 rounded-[0.9rem] px-3 py-2 text-left text-xs font-medium text-slate-600 transition-colors hover:bg-black/[0.04] hover:text-slate-900 dark:text-slate-300 dark:hover:bg-white/[0.05] dark:hover:text-white"
            >
              <Download className="h-3.5 w-3.5" strokeWidth={2.1} />
              Export
            </button>
            <button
              type="button"
              onClick={() => {
                setRowMenu(null);
                void handleToggleShowcase(activeRowMenuSprint);
              }}
              disabled={pendingActionIds.has(`sprint-showcase:${activeRowMenuSprint.id}`)}
              className="flex w-full items-center gap-2 rounded-[0.9rem] px-3 py-2 text-left text-xs font-medium text-slate-600 transition-colors hover:bg-black/[0.04] hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-300 dark:hover:bg-white/[0.05] dark:hover:text-white"
            >
              <Heart className="h-3.5 w-3.5" fill={activeRowMenuSprint.showcasePinned ? "currentColor" : "none"} strokeWidth={2.1} />
              {activeRowMenuSprint.showcasePinned ? "Remove" : "Add"}
            </button>
            <button
              type="button"
              onClick={() => {
                setRowMenu(null);
                setOverrideSprint(activeRowMenuSprint);
              }}
              className="flex w-full items-center gap-2 rounded-[0.9rem] px-3 py-2 text-left text-xs font-medium text-slate-600 transition-colors hover:bg-black/[0.04] hover:text-slate-900 dark:text-slate-300 dark:hover:bg-white/[0.05] dark:hover:text-white"
            >
              <Sparkles className="h-3.5 w-3.5" strokeWidth={2.1} />
              Overrides
            </button>
            {activeRowMenuSprint.status !== "completed" && (
              <button
                type="button"
                onClick={() => {
                  setRowMenu(null);
                  void handleMarkCompleted(activeRowMenuSprint.id);
                }}
                disabled={pendingActionIds.has(`sprint-mark-completed:${activeRowMenuSprint.id}`)}
                className="flex w-full items-center gap-2 rounded-[0.9rem] px-3 py-2 text-left text-xs font-medium text-slate-600 transition-colors hover:bg-black/[0.04] hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-300 dark:hover:bg-white/[0.05] dark:hover:text-white"
              >
                <CheckSquare className="h-3.5 w-3.5" strokeWidth={2.1} />
                Mark Completed
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setRowMenu(null);
                void handleDeleteSprint(activeRowMenuSprint.id);
              }}
              className="flex w-full items-center gap-2 rounded-[0.9rem] px-3 py-2 text-left text-xs font-medium text-status-red transition-colors hover:bg-status-red/10"
            >
              <XCircle className="h-3.5 w-3.5" strokeWidth={2.1} />
              Delete
            </button>
          </div>
        </div>
      )}

      {showImportModal && (
        <SprintMarkdownModal
          mode="import"
          onClose={() => setShowImportModal(false)}
          onImport={handleImportSprint}
        />
      )}

      {showIssueImportModal && selectedProject && (
        <SprintIssueImportModal
          project={selectedProject}
          onClose={() => setShowIssueImportModal(false)}
          onImport={(issues) => {
            mergeLinkedIssues(issues);
            setShowIssueImportModal(false);
            setShowQuicksprint(false);
            if (!editingSprint) {
              setShowCreateComposer(true);
            }
          }}
        />
      )}

      {isJiraModalOpen && selectedProject && editingSprint && (
        <SprintJiraImportModal
          sprintId={editingSprint.id}
          projectId={selectedProject.id}
          onClose={() => setIsJiraModalOpen(false)}
        />
      )}

      {exportState && (
        <SprintMarkdownModal
          mode="export"
          sprintLabel={exportState.sprintLabel}
          sprintMarkdown={exportState.sprintMarkdown}
          tasksMarkdown={exportState.tasksMarkdown}
          onClose={() => setExportState(null)}
        />
      )}

      {overrideSprint && selectedProject && (
        <SprintSettingsOverrideModal
          projectId={selectedProject.id}
          sprint={overrideSprint}
          onClose={() => setOverrideSprint(null)}
          onSaved={async () => {
            await Promise.all([refreshSprints(), refreshExecution()]);
          }}
        />
      )}

      {addTaskForSprint && (
        <AddTaskModal
          sprints={[addTaskForSprint]}
          availableTasks={addTaskSprintTasks}
          initialSprintId={addTaskForSprint.id}
          onClose={() => {
            setAddTaskForSprint(null);
          }}
          onSubmit={handleAppendTask}
        />
      )}
    </ExecutionTimelineProvider>
  );
};
