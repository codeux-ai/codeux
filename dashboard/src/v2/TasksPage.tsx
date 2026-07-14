
import type { FunctionComponent } from "preact";
import { useLayoutEffect, useMemo, useRef } from "preact/hooks";
import gsap from "gsap";
import { Link } from "@tanstack/react-router";
import {
  ListChecks,
  FolderGit2,
  Plus,
  X,
  ArrowRight,
  AlertTriangle,
} from "lucide-preact";
import { TaskComposer } from "./components/ui/TaskComposer.js";
import { AddProjectModal } from "./components/ui/AddProjectModal.js";
import { PageContainer } from "./components/layout/PageContainer.js";
import { PageHeader } from "./components/layout/PageHeader.js";
import { Button } from "./components/ui/Button.js";
import { TaskBoardFilters } from "./components/tasks/TaskBoardFilters.js";
import { TaskBoardColumns } from "./components/tasks/TaskBoardColumns.js";
import { TaskBoardOverview } from "./components/tasks/TaskBoardOverview.js";
import { useInteractionTokens } from "./lib/motion/tokens.js";
import { useTaskBoardController } from "./hooks/use-task-board-controller.js";
import { useDashboardI18n } from "./i18n/context.js";
import { taskMessages } from "./i18n/messages/tasks.js";

type TaskScopePlaceholderMode = "project" | "sprint";

export const TaskBoardFeedback: FunctionComponent<{
  error: string | null;
  filterTransitionPending: boolean;
}> = ({ error, filterTransitionPending }) => {
  const { translate } = useDashboardI18n();
  return <>
    {error && (
      <div role="alert" aria-live="assertive" className="flex min-w-0 items-start gap-3 rounded-2xl border border-status-red/20 bg-status-red/[0.06] px-4 py-3.5 text-status-red sm:px-5">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2.2} aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-[0.12em]">{translate(taskMessages, "taskBoardUpdateFailed")}</p>
          <p className="mt-1 break-words text-sm text-slate-600 dark:text-slate-300">{error}</p>
        </div>
      </div>
    )}
    {filterTransitionPending && (
      <div role="status" aria-live="polite" className="rounded-2xl border border-signal-500/15 bg-signal-500/[0.06] px-4 py-3 text-xs font-bold uppercase tracking-[0.14em] text-signal-600 dark:text-signal-400">
        {translate(taskMessages, "updatingFilters")}
      </div>
    )}
  </>;
};

const TaskScopePlaceholder: FunctionComponent<{
  mode: TaskScopePlaceholderMode;
  hasProjects: boolean;
  onAddProject: () => void;
}> = ({ mode, hasProjects, onAddProject }) => {
  const { translate } = useDashboardI18n();
  const isProjectMode = mode === "project";
  const title = translate(taskMessages, isProjectMode ? "taskNeedsProject" : "taskNeedsSprint");
  const eyebrow = translate(taskMessages, isProjectMode ? "taskProjectStandby" : "taskSprintRequired");
  const body = isProjectMode
    ? translate(taskMessages, "taskNeedsProjectBody")
    : translate(taskMessages, "taskNeedsSprintBody");

  return (
    <section className="overflow-hidden rounded-[1.75rem] border border-black/[0.06] bg-white/70 p-6 shadow-[0_8px_32px_rgba(15,23,42,0.06)] backdrop-blur-2xl dark:border-white/[0.06] dark:bg-void-800/60 dark:shadow-[0_12px_36px_rgba(0,0,0,0.24)] sm:p-8">
      <div className="grid min-w-0 gap-8 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-center">
        <div>
          <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl border border-signal-500/15 bg-signal-500/[0.08] text-signal-600 dark:text-signal-400">
            <ListChecks className="h-5 w-5" strokeWidth={2} aria-hidden="true" />
          </div>
          <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-signal-500">
            {eyebrow}
          </div>
          <h2 className="mt-3 max-w-3xl text-balance font-display text-2xl font-bold leading-tight tracking-tight text-slate-900 dark:text-white sm:text-3xl">
            {title}
          </h2>
          <p className="mt-4 max-w-2xl text-sm font-medium leading-relaxed text-slate-500 dark:text-slate-400">
            {body}
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            {isProjectMode ? (
              <Button
                type="button"
                onClick={onAddProject}
                variant="signal"
                icon={Plus}
                className="!inline-flex !min-h-[44px] !items-center !gap-2.5 !rounded-xl !px-5 !py-2.5 !text-[10px] !font-bold !uppercase !tracking-[0.14em] focus-visible:!ring-2 focus-visible:!ring-signal-500/40"
              >
                {translate(taskMessages, hasProjects ? "addProject" : "addFirstProject")}
              </Button>
            ) : (
              <Link
                to="/sprints"
                className="inline-flex min-h-[44px] items-center gap-2.5 rounded-xl bg-signal-500 px-5 py-2.5 text-[10px] font-bold uppercase tracking-[0.14em] text-white transition-colors hover:bg-signal-400 focus-visible:ring-2 focus-visible:ring-signal-500/40 motion-reduce:transition-none dark:text-void-900"
              >
                <Plus className="h-3.5 w-3.5" strokeWidth={2.3} />
                {translate(taskMessages, "planSprint")}
              </Link>
            )}
            <Link
              to={isProjectMode ? "/projects" : "/sprints"}
              className="inline-flex min-h-[44px] items-center gap-2.5 rounded-xl border border-black/[0.06] bg-white/75 px-5 py-2.5 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-600 transition-colors hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-signal-500/40 motion-reduce:transition-none dark:border-white/[0.06] dark:bg-white/[0.04] dark:text-slate-300 dark:hover:text-white"
            >
              <FolderGit2 className="h-3.5 w-3.5 text-ember-500" strokeWidth={2.1} />
              {translate(taskMessages, isProjectMode ? "manageProjects" : "openSprints")}
              <ArrowRight className="h-3.5 w-3.5" strokeWidth={2.1} />
            </Link>
          </div>
        </div>

        <div className="overflow-hidden rounded-[1.4rem] border border-black/[0.06] bg-black/[0.025] p-3 dark:border-white/[0.06] dark:bg-white/[0.035]">
          <div className="space-y-2">
            {[
              { label: translate(taskMessages, "project"), value: translate(taskMessages, isProjectMode ? "required" : "ready"), tone: isProjectMode ? "text-ember-500" : "text-status-green" },
              { label: translate(taskMessages, "sprint"), value: translate(taskMessages, isProjectMode ? "waiting" : "required"), tone: isProjectMode ? "text-signal-500" : "text-ember-500" },
              { label: translate(taskMessages, "tasks"), value: translate(taskMessages, "locked"), tone: "text-slate-500 dark:text-slate-400" },
            ].map((item, index) => (
              <div
                key={item.label}
                className="rounded-xl border border-white/60 bg-white/72 p-4 dark:border-white/[0.06] dark:bg-white/[0.04]"
              >
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="text-[9px] font-bold uppercase tracking-[0.16em] text-slate-400">{item.label}</div>
                    <div className={`mt-1 text-xs font-bold uppercase tracking-[0.12em] ${item.tone}`}>{item.value}</div>
                  </div>
                  <div aria-hidden="true" className={`h-2.5 w-2.5 rounded-full ${index === 0 ? "bg-ember-500" : index === 1 ? "bg-signal-500" : "bg-slate-300 dark:bg-slate-600"}`} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};

export const TasksPage: FunctionComponent = () => {
  const { translate } = useDashboardI18n();
  const boardRef = useRef<HTMLDivElement>(null);
  const interactionTokens = useInteractionTokens();
  const controller = useTaskBoardController();
  const {
    projects,
    selectedProject,
    sprints,
    sprintsLoading,
    selectedSprintId,
    taskScopeSprintId,
    selectedSprintModel,
    sprintKeyPrefix,
    isTaskScopeReady,
    tasks,
    loading,
    error,
    statusFilter,
    setStatusFilter,
    priorityFilter,
    setPriorityFilter,
    listWindow,
    setListWindow,
    showComposer,
    editingTask,
    composerRef,
    showAddProjectModal,
    setShowAddProjectModal,
    reducedMotion,
    showSkeletons,
    filterTransitionPending,
    boardCountAnnouncement,
    boardViewModel,
    draggedTaskId,
    dropTargetContext,
    agentPresets,
    agentPresetsMap,
    resolvedTaskId,
    clearResolvedTaskId,
    handleSprintScopeSelect,
    handleComposerToggle,
    handleComposerClose,
    handleTaskSubmit,
    handleDragStart,
    handleDragEnd,
    handleDragOver,
    handleDrop,
    handleDeleteTask,
    handleEditClick,
    handleAddProject,
  } = controller;
  const { boardState, taskViewModels } = boardViewModel;
  const { filteredTasks, stats, columns } = boardState;
  const listTransitionStyle = useMemo(() => ({
    transitionDuration: interactionTokens.listReorder.duration,
    transitionTimingFunction: interactionTokens.listReorder.ease,
  }), [interactionTokens.listReorder.duration, interactionTokens.listReorder.ease]);

  useLayoutEffect(() => {
    if (!boardRef.current || loading || showSkeletons) return;
    const taskCards = Array.from(boardRef.current.querySelectorAll(".task-card-entry"));
    if (taskCards.length === 0) return;
    const ctx = gsap.context(() => {
      if (reducedMotion) {
        gsap.set(taskCards, { opacity: 1, y: 0, scale: 1 });
      } else {
        gsap.fromTo(taskCards, { opacity: 0, y: 15, scale: 0.98 }, {
          opacity: 1,
          y: 0,
          scale: 1,
          stagger: 0.05,
          duration: 0.6,
          ease: "power2.out",
          delay: 0.05,
        });
      }
    });
    return () => ctx.revert();
  }, [selectedProject?.id, statusFilter, priorityFilter, taskScopeSprintId, listWindow, loading, showSkeletons, reducedMotion]);

  useLayoutEffect(() => {
    if (!resolvedTaskId || !boardRef.current) return;
    const el = boardRef.current.querySelector(`[data-task-id="${resolvedTaskId}"] .kanban-card`) as HTMLDivElement;
    if (!el) return;

    el.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "nearest" });

    if (reducedMotion) {
      clearResolvedTaskId();
      return;
    }

    const flashEl = document.createElement("div");
    flashEl.style.position = "absolute";
    flashEl.style.inset = "0";
    flashEl.style.backgroundColor = "rgba(0, 224, 160, 0.2)";
    flashEl.style.borderRadius = "1.75rem";
    flashEl.style.pointerEvents = "none";
    flashEl.style.zIndex = "50";
    el.appendChild(flashEl);

    const ctx = gsap.context(() => {
      gsap.to(flashEl, {
        opacity: 0,
        duration: 0.4,
        ease: "power2.out",
        onComplete: () => flashEl.remove()
      });

      gsap.fromTo(el,
        {
          opacity: 0.6,
          borderWidth: "2px",
          borderColor: "rgba(148, 163, 184, 0.5)",
          borderStyle: "dashed"
        },
        {
          opacity: 1,
          borderWidth: "1px",
          borderColor: "rgba(0,0,0,0.06)",
          borderStyle: "solid",
          duration: 0.4,
          ease: "power2.out",
          clearProps: "opacity,borderWidth,borderStyle,borderColor"
        }
      );
    });

    clearResolvedTaskId();
    return () => ctx.revert();
  }, [clearResolvedTaskId, reducedMotion, resolvedTaskId, tasks]);

  return (
    <PageContainer
      aria-label={translate(taskMessages, "taskBoard")}
      className={isTaskScopeReady ? "gap-10" : "gap-8"}
      padding={isTaskScopeReady ? "standard" : "sprintsEmpty"}
    >
      <PageHeader
        icon={ListChecks}
        eyebrow={translate(taskMessages, "deliveryWorkspace")}
        title={translate(taskMessages, "tasks")}
        subtitle={
          <>
            {selectedProject
              ? taskScopeSprintId
                ? translate(taskMessages, "selectedProjectSprintSubtitle", { project: selectedProject.name, sprint: sprints.find((sprint) => sprint.id === taskScopeSprintId)?.number ?? "..." })
                : translate(taskMessages, "selectedProjectSubtitle", { project: selectedProject.name })
              : translate(taskMessages, "noProjectSubtitle")}
            {selectedProject && (statusFilter !== "all" || priorityFilter !== "all") && (
              <span className="block text-sm text-signal-600 dark:text-signal-500 mt-1">
                {translate(taskMessages, "filteredSubtitle", {
                  status: translate(taskMessages, statusFilter === "all" ? "all" : statusFilter === "pending" ? "queued" : statusFilter === "completed" ? "completed" : "inProgressLower"),
                  priority: translate(taskMessages, priorityFilter === "all" ? "anyPriority" : priorityFilter),
                })}
              </span>
            )}
          </>
        }
        actions={
          <Button
            onClick={handleComposerToggle}
            variant="signal"
            icon={(showComposer || editingTask) ? X : Plus}
            disabled={!selectedProject || sprints.length === 0}
            className="!flex !min-h-[44px] !w-full !shrink-0 !items-center !justify-center !gap-2.5 !rounded-xl !px-5 !py-2.5 !text-sm !font-bold sm:!w-auto"
          >
            {translate(taskMessages, (showComposer || editingTask) ? "closeComposer" : "newTask")}
          </Button>
        }
      />

      {!selectedProject && (
        <TaskScopePlaceholder
          mode="project"
          hasProjects={projects.length > 0}
          onAddProject={() => setShowAddProjectModal(true)}
        />
      )}

      {selectedProject && !sprintsLoading && sprints.length === 0 && (
        <TaskScopePlaceholder
          mode="sprint"
          hasProjects={projects.length > 0}
          onAddProject={() => setShowAddProjectModal(true)}
        />
      )}

      {isTaskScopeReady && (
        <section
          aria-labelledby="task-workspace-heading"
          className={`grid min-w-0 items-start gap-6 ${showComposer || editingTask ? "xl:grid-cols-[minmax(0,1fr)_minmax(28rem,40rem)]" : "grid-cols-1"}`}
        >
          <h2 id="task-workspace-heading" className="sr-only">{translate(taskMessages, "taskWorkspace")}</h2>

          <section
            aria-labelledby="task-board-heading"
            className={`${showComposer || editingTask ? "order-2 xl:order-1" : ""} min-w-0 space-y-6`}
          >
            <h3 id="task-board-heading" className="sr-only">{translate(taskMessages, "taskBoardRegion")}</h3>
            <TaskBoardFilters
              sprints={sprints}
              selectedSprintId={taskScopeSprintId}
              onSelectSprint={handleSprintScopeSelect}
              sprintKeyPrefix={sprintKeyPrefix}
              sprintsLoading={sprintsLoading}
              statusFilter={statusFilter}
              onStatusFilterChange={setStatusFilter}
              priorityFilter={priorityFilter}
              onPriorityFilterChange={setPriorityFilter}
              listWindow={listWindow}
              onListWindowChange={setListWindow}
            />

            <TaskBoardOverview sprint={selectedSprintModel} tasks={filteredTasks} stats={stats} />

            <TaskBoardFeedback error={error} filterTransitionPending={filterTransitionPending} />

            <div className="sr-only" aria-live="polite" aria-atomic="true">
              {boardCountAnnouncement}
            </div>
            <TaskBoardColumns
              boardRef={boardRef}
              columns={columns}
              taskViewModels={taskViewModels}
              allTasks={tasks}
              agentPresetsMap={agentPresetsMap}
              loading={loading}
              showSkeletons={showSkeletons}
              filterTransitionPending={filterTransitionPending}
              statusFilter={statusFilter}
              priorityFilter={priorityFilter}
              taskScopeSprintId={taskScopeSprintId}
              reducedMotion={reducedMotion}
              draggedTaskId={draggedTaskId}
              dropTargetContext={dropTargetContext}
              listTransitionStyle={listTransitionStyle}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              onEditTask={handleEditClick}
              onDeleteTask={handleDeleteTask}
            />
          </section>

          {(showComposer || editingTask) && (
            <aside
              ref={composerRef}
              role="region"
              aria-labelledby="task-editor-heading"
              className="order-1 min-w-0 scroll-mt-8 xl:sticky xl:top-6 xl:order-2"
            >
              <h3 id="task-editor-heading" className="sr-only">
                {editingTask ? "Edit task editor" : "New task editor"}
              </h3>
              <TaskComposer
                key={editingTask?.recordId || "new"}
                sprints={sprints}
                availableTasks={tasks}
                agentPresets={agentPresets}
                initialTask={editingTask}
                initialSprintId={taskScopeSprintId}
                onClose={handleComposerClose}
                onSubmit={handleTaskSubmit}
              />
            </aside>
          )}
        </section>
      )}

      {showAddProjectModal && (
        <AddProjectModal
          onClose={() => setShowAddProjectModal(false)}
          onAdd={handleAddProject}
        />
      )}

    </PageContainer>
  );
};
