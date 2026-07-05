
import type { FunctionComponent } from "preact";
import { memo } from "preact/compat";
import { useLayoutEffect, useMemo, useRef } from "preact/hooks";
import gsap from "gsap";
import { Link } from "@tanstack/react-router";
import {
  ListChecks,
  FolderGit2,
  Flame,
  Target,
  Plus,
  X,
  ArrowUpRight,
  ArrowRight,
} from "lucide-preact";
import { TaskComposer } from "./components/ui/TaskComposer.js";
import { AddProjectModal } from "./components/ui/AddProjectModal.js";
import type { Task } from "./types.js";
import { PageContainer } from "./components/layout/PageContainer.js";
import { PageHeader } from "./components/layout/PageHeader.js";
import { Button } from "./components/ui/Button.js";
import { TaskBoardFilters } from "./components/tasks/TaskBoardFilters.js";
import { TaskBoardColumns } from "./components/tasks/TaskBoardColumns.js";
import { useInteractionTokens } from "./lib/motion/tokens.js";
import { useTaskBoardController } from "./hooks/use-task-board-controller.js";

type TaskScopePlaceholderMode = "project" | "sprint";

const TaskScopePlaceholder: FunctionComponent<{
  mode: TaskScopePlaceholderMode;
  hasProjects: boolean;
  onAddProject: () => void;
}> = ({ mode, hasProjects, onAddProject }) => {
  const isProjectMode = mode === "project";
  const title = isProjectMode ? "Task work starts with a project." : "Create a sprint to unlock tasks.";
  const eyebrow = isProjectMode ? "Task Board Standby" : "Sprint Scope Required";
  const body = isProjectMode
    ? "Connect a project before the task board starts tracking queued work, active implementation, QA review, and completed delivery."
    : "Tasks are organized inside sprint scope. Create or select a sprint before adding implementation work to the board.";

  return (
    <section className="relative overflow-hidden rounded-[2.2rem] border border-black/[0.06] bg-white/72 p-8 shadow-[0_18px_48px_rgba(15,23,42,0.07)] backdrop-blur-2xl dark:border-white/[0.06] dark:bg-void-800/62 dark:shadow-[0_18px_48px_rgba(0,0,0,0.28)] md:p-10">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_72%_58%_at_48%_25%,rgba(0,224,160,0.09),transparent_64%)] dark:bg-[radial-gradient(ellipse_72%_58%_at_48%_25%,rgba(0,224,160,0.13),transparent_64%)]" />
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="h-52 w-52 rounded-full border border-signal-500/14 animate-[ping_5.8s_cubic-bezier(0.1,0.5,0.8,1)_infinite]" />
        <div className="absolute h-80 w-80 rounded-full border border-ember-500/10 animate-[ping_8.4s_cubic-bezier(0.1,0.5,0.8,1)_infinite]" />
        <div className="absolute h-[28rem] w-[28rem] rounded-full border border-black/[0.035] animate-[ping_11s_cubic-bezier(0.1,0.5,0.8,1)_infinite] dark:border-white/[0.04]" />
      </div>

      <div className="relative z-10 grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-center">
        <div>
          <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-[1.35rem] border border-signal-500/20 bg-signal-500/10 text-signal-500 shadow-[0_0_32px_rgba(0,224,160,0.16)]">
            <ListChecks className="h-7 w-7" strokeWidth={1.7} />
          </div>
          <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-signal-500">
            {eyebrow}
          </div>
          <h1 className="mt-3 max-w-3xl font-display text-4xl font-black leading-[0.98] tracking-tight text-slate-900 dark:text-white md:text-5xl">
            {title}
          </h1>
          <p className="mt-5 max-w-2xl text-sm font-medium leading-relaxed text-slate-500 dark:text-slate-400 md:text-base">
            {body}
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            {isProjectMode ? (
              <Button
                type="button"
                onClick={onAddProject}
                variant="signal"
                icon={Plus}
                className="!inline-flex !min-h-[44px] !items-center !gap-2.5 !rounded-full !px-5 !py-2.5 !text-[10px] !font-bold !uppercase !tracking-[0.14em] !shadow-[0_10px_30px_rgba(0,224,160,0.22)] hover:!-translate-y-px focus-visible:!ring-2 focus-visible:!ring-signal-500/40"
              >
                {hasProjects ? "Add Project" : "Add First Project"}
              </Button>
            ) : (
              <Link
                to="/sprints"
                className="inline-flex min-h-[44px] items-center gap-2.5 rounded-full bg-signal-500 px-5 py-2.5 text-[10px] font-bold uppercase tracking-[0.14em] text-white dark:text-void-900 shadow-[0_10px_30px_rgba(0,224,160,0.22)] transition-all hover:-translate-y-px hover:bg-signal-400 focus-visible:ring-2 focus-visible:ring-signal-500/40"
              >
                <Plus className="h-3.5 w-3.5" strokeWidth={2.3} />
                Plan Sprint
              </Link>
            )}
            <Link
              to={isProjectMode ? "/projects" : "/sprints"}
              className="inline-flex min-h-[44px] items-center gap-2.5 rounded-full border border-black/[0.06] bg-white/75 px-5 py-2.5 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-600 transition-all hover:-translate-y-px hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-signal-500/40 dark:border-white/[0.06] dark:bg-white/[0.04] dark:text-slate-300 dark:hover:text-white"
            >
              <FolderGit2 className="h-3.5 w-3.5 text-ember-500" strokeWidth={2.1} />
              {isProjectMode ? "Manage Projects" : "Open Sprints"}
              <ArrowRight className="h-3.5 w-3.5" strokeWidth={2.1} />
            </Link>
          </div>
        </div>

        <div className="relative overflow-hidden rounded-[1.7rem] border border-black/[0.06] bg-black/[0.025] p-5 dark:border-white/[0.06] dark:bg-white/[0.035]">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_85%_65%_at_50%_0%,rgba(255,184,0,0.12),transparent_68%)]" />
          <div className="relative z-10 space-y-3">
            {[
              { label: "Project", value: isProjectMode ? "required" : "ready", tone: isProjectMode ? "text-ember-500" : "text-status-green" },
              { label: "Sprint", value: isProjectMode ? "waiting" : "required", tone: isProjectMode ? "text-signal-500" : "text-ember-500" },
              { label: "Tasks", value: "locked", tone: "text-slate-500 dark:text-slate-400" },
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
    </section>
  );
};

const SprintProgressCard: FunctionComponent<{
  sprint: { id: string; name: string; date: string };
  tasks: Task[];
}> = memo(({ sprint, tasks }) => {
  const completed = tasks.filter((task) => task.status === "completed").length;
  const inProgress = tasks.filter((task) => task.status === "in_progress").length;
  const pending = tasks.filter((task) => task.status === "pending").length;
  const total = tasks.length;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <div className="relative overflow-hidden bg-white/70 dark:bg-void-800/60 backdrop-blur-2xl border border-black/[0.06] dark:border-white/[0.06] rounded-[1.75rem] p-7 shadow-[0_2px_20px_rgba(0,0,0,0.04)] dark:shadow-[0_4px_24px_rgba(0,0,0,0.2)]">
      <div aria-hidden className="absolute -right-4 -bottom-6 text-[6rem] font-black tracking-tighter text-black/[0.025] dark:text-white/[0.02] pointer-events-none select-none font-display leading-none">
        {pct}%
      </div>

      <div className="flex items-center gap-3 mb-5">
        <div className="w-10 h-10 rounded-xl bg-ember-500/[0.1] dark:bg-ember-500/[0.15] flex items-center justify-center">
          <Target className="w-5 h-5 text-ember-500" strokeWidth={2} />
        </div>
        <div>
          <h3 className="text-base font-semibold font-display tracking-tight text-slate-900 dark:text-white">{sprint.name}</h3>
          <p className="text-[10px] font-mono text-slate-400 uppercase tracking-[0.1em]">{sprint.date}</p>
        </div>
      </div>

      <div 
        className="flex gap-1 h-2.5 rounded-full overflow-hidden mb-5"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Sprint progress: ${pct}%`}
      >
        {completed > 0 && <div className="bg-status-green rounded-full transition-all duration-700" style={{ width: `${(completed / total) * 100}%` }} />}
        {inProgress > 0 && <div className="bg-signal-500 rounded-full transition-all duration-700" style={{ width: `${(inProgress / total) * 100}%` }} />}
        {pending > 0 && <div className="bg-slate-200 dark:bg-slate-700 rounded-full transition-all duration-700" style={{ width: `${(pending / total) * 100}%` }} />}
      </div>

      <div className="grid grid-cols-3 gap-2">
        {[
          { label: "Completed", value: completed, color: "text-status-green" },
          { label: "Running", value: inProgress, color: "text-signal-500" },
          { label: "Queued", value: pending, color: "text-slate-400" },
        ].map(({ label, value, color }) => (
          <div key={label} className="flex flex-col items-center py-2.5 rounded-xl bg-black/[0.03] dark:bg-white/[0.03] border border-black/[0.04] dark:border-white/[0.04]">
            <span className={`text-lg font-semibold font-mono leading-none ${color}`}>{value}</span>
            <span className="text-[8px] font-bold uppercase tracking-[0.14em] text-slate-400 mt-1">{label}</span>
          </div>
        ))}
      </div>

      <Link
        to="/sprints"
        className="flex items-center gap-1.5 mt-5 pt-4 border-t border-black/[0.05] dark:border-white/[0.04] text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400 hover:text-ember-500 transition-colors duration-200 group/link"
      >
        <ArrowUpRight className="w-3 h-3 group-hover/link:translate-x-0.5 group-hover/link:-translate-y-0.5 transition-transform duration-200" strokeWidth={2.5} />
        View Sprint
      </Link>
    </div>
  );
});

export const TasksPage: FunctionComponent = () => {
  const headerRef = useRef<HTMLDivElement>(null);
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
    if (!headerRef.current) return;
    const ctx = gsap.context(() => {
      gsap.fromTo(Array.from(headerRef.current!.children), { opacity: 0, y: 40 }, { opacity: 1, y: 0, stagger: 0.1, duration: 0.9, ease: "power4.out", delay: 0.05 });
    });
    return () => ctx.revert();
  }, []);

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

    el.scrollIntoView({ behavior: "smooth", block: "nearest" });

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
  }, [clearResolvedTaskId, resolvedTaskId, tasks]);

  return (
    <PageContainer
      className={isTaskScopeReady ? "gap-16" : "gap-10"}
      padding={isTaskScopeReady ? "standard" : "sprintsEmpty"}
    >
      <PageHeader
        containerRef={headerRef}
        icon={ListChecks}
        eyebrow="Task Pipeline"
        title="Task Board"
        subtitle={
          <>
            {selectedProject
              ? taskScopeSprintId
                ? `Task execution for ${selectedProject.name}, scoped to Sprint ${sprints.find((sprint) => sprint.id === taskScopeSprintId)?.number ?? "..."}.`
                : `Task execution for ${selectedProject.name}. Showing all tasks across the project.`
              : "Select a project to manage sprint tasks."}
            {selectedProject && (statusFilter !== "all" || priorityFilter !== "all") && (
              <span className="block text-sm text-signal-600 dark:text-signal-500 mt-1">
                Filtered to show {statusFilter !== "all" ? statusFilter.replace("_", " ") : "all"} status and {priorityFilter !== "all" ? priorityFilter : "any"} priority.
              </span>
            )}
          </>
        }
        actions={
          <div className="flex flex-col items-start lg:items-end gap-4 shrink-0 w-full lg:w-auto">
          <div className="flex items-center gap-2.5 flex-wrap w-full lg:w-auto">
            {stats.inProgress > 0 && (
              <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-signal-500/[0.08] border border-signal-500/20 text-[10px] font-bold uppercase tracking-[0.14em] text-signal-600 dark:text-signal-400">
                <span className="w-1.5 h-1.5 rounded-full bg-signal-500 relative">
                  <span className="absolute inset-0 rounded-full animate-ping bg-signal-400 opacity-70" />
                </span>
                {stats.inProgress} Running
              </div>
            )}
            {stats.critical > 0 && (
              <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-status-red/[0.06] border border-status-red/20 text-[10px] font-bold uppercase tracking-[0.14em] text-status-red">
                <Flame className="w-3 h-3" strokeWidth={2.5} />
                {stats.critical} Critical
              </div>
            )}
            <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-black/[0.04] dark:bg-white/[0.04] border border-black/[0.06] dark:border-white/[0.06] text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">
              <ListChecks className="w-3 h-3" strokeWidth={2} />
              {stats.total} Total
            </div>
          </div>

          <Button
            onClick={handleComposerToggle}
            variant="signal"
            icon={(showComposer || editingTask) ? X : Plus}
            disabled={!selectedProject || sprints.length === 0}
            className="!flex !items-center !justify-center !w-full lg:!w-auto !gap-2.5 !px-6 !py-3.5 !font-bold !text-sm !rounded-2xl !transition-all !duration-300 !shadow-[0_4px_20px_rgba(0,224,160,0.25)] hover:!shadow-[0_8px_32px_rgba(0,224,160,0.45)] hover:!-translate-y-px !shrink-0"
          >
            {(showComposer || editingTask) ? "Close Composer" : "New Task"}
          </Button>
          </div>
        }
      />

      {isTaskScopeReady && (
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
      )}

      {isTaskScopeReady && selectedSprintModel && (
        <div className="-mt-6">
          <SprintProgressCard sprint={selectedSprintModel} tasks={filteredTasks} />
        </div>
      )}

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

      {isTaskScopeReady && error && (
        <div role="alert" aria-live="assertive" className="px-6 py-4 rounded-2xl border border-status-red/20 bg-status-red/[0.06] text-status-red text-sm">
          {error}
        </div>
      )}

      {isTaskScopeReady && (showComposer || editingTask) && (
        <div ref={composerRef} className="scroll-mt-8">
          <TaskComposer
            key={editingTask?.recordId || "new"}
            sprints={sprints}
            availableTasks={tasks}
            initialTask={editingTask}
            initialSprintId={selectedSprintId}
            onClose={handleComposerClose}
            onSubmit={handleTaskSubmit}
          />
        </div>
      )}

      {isTaskScopeReady && (
        <section aria-labelledby="task-board-heading" className="space-y-4">
        <div className="sr-only" aria-live="polite" aria-atomic="true">
          {boardCountAnnouncement}
        </div>
        {filterTransitionPending && (
          <div role="status" aria-live="polite" className="rounded-2xl border border-signal-500/15 bg-signal-500/[0.06] px-4 py-3 text-xs font-bold uppercase tracking-[0.14em] text-signal-600 dark:text-signal-400">
            Updating task board filters. Current cards remain visible until results settle.
          </div>
        )}
        <h2 id="task-board-heading" className="sr-only">Task board</h2>
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
