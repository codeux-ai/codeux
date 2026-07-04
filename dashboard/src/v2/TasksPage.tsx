import type { FunctionComponent } from "preact";
import { memo } from "preact/compat";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import gsap from "gsap";
import { Flame, ListChecks, Plus, X } from "lucide-preact";
import { TaskComposer } from "./components/ui/TaskComposer.js";
import { AddProjectModal } from "./components/ui/AddProjectModal.js";
import type { TaskStatus } from "./types.js";
import { ListWindowSelector } from "./components/ui/ListWindowSelector.js";
import { SkeletonCard, SkeletonLoader } from "./components/layout/SkeletonLoader.js";
import { FilterStrip } from "./components/ui/FilterStrip.js";
import { PageContainer } from "./components/layout/PageContainer.js";
import { PageHeader } from "./components/layout/PageHeader.js";
import { useProjectEffectiveSettings } from "./hooks/use-project-effective-settings.js";
import { KanbanTaskCard } from "./components/tasks/KanbanTaskCard.js";
import { Button } from "./components/ui/Button.js";
import { fetchAgentPresets } from "./lib/agent-preset-api.js";
import type { AgentPreset } from "./types.js";
import { STATUS_CFG } from "./lib/tasks-constants.js";
import { SprintProgressCard } from "./components/tasks/SprintProgressCard.js";
import { SprintSelector } from "./components/tasks/SprintSelector.js";
import { TaskScopePlaceholder } from "./components/tasks/TaskScopePlaceholder.js";
import { useTasksPageController, type TasksPagePriorityFilter, type TasksPageStatusFilter } from "./hooks/use-tasks-page-controller.js";
import { useReducedMotion } from "./hooks/use-reduced-motion.js";

const ColumnHeader: FunctionComponent<{ status: TaskStatus; count: number }> = memo(({ status, count }) => {
  const cfg = STATUS_CFG[status];
  const Icon = cfg.icon;

  return (
    <div className="flex items-center justify-between mb-6">
      <div className="flex items-center gap-2.5">
        <Icon className={`w-5 h-5 ${cfg.color}`} strokeWidth={2} />
        <span className={`font-display text-lg font-bold tracking-tight ${cfg.color}`}>{cfg.label}</span>
      </div>
      <span className={`text-[10px] font-mono font-bold px-2.5 py-1 rounded-lg bg-black/[0.03] dark:bg-white/[0.03] ${cfg.color}`}>
        {count}
      </span>
    </div>
  );
});

export const TasksPage: FunctionComponent = () => {
  const headerRef = useRef<HTMLDivElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();
  const {
    projects,
    selectedProject,
    projectId,
    sprints,
    sprintsLoading,
    selectedSprintId,
    taskScopeSprintId,
    selectedSprintModel,
    isTaskScopeReady,
    tasks,
    loading,
    error,
    filteredTasks,
    stats,
    columns,
    taskViewModels,
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
    draggedTaskId,
    dropTargetContext,
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
  } = useTasksPageController({ reducedMotion });
  const settings = useProjectEffectiveSettings(projectId);
  const sprintKeyPrefix = settings.data?.settings?.git?.sprintKeyPrefix || "SPR";
  const [agentPresetsMap, setAgentPresetsMap] = useState<Map<string, AgentPreset>>(new Map());
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    fetchAgentPresets(projectId).then(presets => {
      if (!cancelled) setAgentPresetsMap(new Map(presets.map(p => [p.id, p])));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [projectId]);
  const [showSkeletons, setShowSkeletons] = useState(false);

  useEffect(() => {
    let timeoutId: number;
    if (loading) {
      timeoutId = window.setTimeout(() => setShowSkeletons(true), 200);
    } else {
      setShowSkeletons(false);
    }
    return () => window.clearTimeout(timeoutId);
  }, [loading]);

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
  }, [selectedProject?.id, statusFilter, priorityFilter, taskScopeSprintId, loading, showSkeletons, reducedMotion]);

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
          borderColor: "rgba(0,0,0,0.06)", // Fallback, clearProps will remove it
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
                ? `Task execution for ${selectedProject.name}, scoped to Sprint ${selectedSprintModel?.number ?? "..."}.`
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
        <div className="flex flex-wrap items-center gap-4 mt-2 sm:-mt-4">
          <div className="min-w-0 flex-shrink">
            <SprintSelector sprints={sprints} selectedId={taskScopeSprintId} onSelect={handleSprintScopeSelect} sprintKeyPrefix={sprintKeyPrefix} />
          </div>

          <FilterStrip
            options={[
              { value: "all", label: "All" },
              { value: "in_progress", label: "Running" },
              { value: "pending", label: "Queued" },
              { value: "completed", label: "Done" },
            ]}
            active={statusFilter}
            onChange={(val) => setStatusFilter(val as TasksPageStatusFilter)}
          />

          <FilterStrip
            options={[
              { value: "all", label: "Any Priority" },
              { value: "critical", label: "Critical" },
              { value: "high", label: "High" },
              { value: "medium", label: "Medium" },
              { value: "low", label: "Low" },
            ]}
            active={priorityFilter}
            onChange={(val) => setPriorityFilter(val as TasksPagePriorityFilter)}
          />

          <div className="ml-auto w-full sm:w-auto">
            <ListWindowSelector value={listWindow} onChange={setListWindow} label="Show" />
          </div>
        </div>
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
        <div role="alert" className="px-6 py-4 rounded-2xl border border-status-red/20 bg-status-red/[0.06] text-status-red text-sm">
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
        <div ref={boardRef} className={`grid gap-6 ${
          columns.length === 1 ? "grid-cols-1" :
          columns.length === 2 ? "grid-cols-1 lg:grid-cols-2" :
          "grid-cols-1 lg:grid-cols-2 xl:grid-cols-3"
        }`}>
          {columns.map(({ status, count, tasks: columnTasks }) => (
            <div key={status} className="flex flex-col">
              <ColumnHeader status={status} count={count} />
              <div
              className={`flex-1 grid grid-cols-1 grid-rows-1 p-4 rounded-[1.5rem] min-h-[200px] bg-black/[0.015] dark:bg-white/[0.015] border relative transition-colors duration-300 ${dropTargetContext?.status === status ? "border-signal-500/50 bg-signal-500/5" : "border-black/[0.03] dark:border-white/[0.03]"}`}
              onDragOver={(e) => handleDragOver(status, columnTasks.length, e)}
              onDrop={(e) => handleDrop(status, columnTasks.length, e)}
            >
                <SkeletonLoader
                  show={showSkeletons}
                  className="col-start-1 row-start-1"
                  skeleton={(
                    <div className="flex flex-col gap-4">
                      <SkeletonCard />
                      <SkeletonCard />
                      <SkeletonCard />
                    </div>
                  )}
                >
                {!loading && columnTasks.length === 0 ? (
                  <div className={`col-start-1 row-start-1 flex items-center justify-center text-center p-6 text-xs font-medium text-slate-400 dark:text-slate-500 border-2 border-dashed rounded-[1.5rem] bg-black/[0.015] dark:bg-white/[0.015] transition-colors ${dropTargetContext?.status === status ? "border-signal-500/30" : "border-black/[0.05] dark:border-white/[0.05]"}`}>
                    No {status.replace("_", " ")} tasks
                    <br />
                    {statusFilter !== "all" || priorityFilter !== "all" ? "matching current filters" : taskScopeSprintId ? "in this sprint" : "in this project"}.
                  </div>
                ) : !loading ? (
                  <div className="col-start-1 row-start-1 flex flex-col gap-4">
                    {columnTasks.map((task, index) => {
                      const isDraggedOver = dropTargetContext?.status === status && dropTargetContext?.index === index;
                      const viewModel = taskViewModels.get(task.recordId);
                      if (!viewModel) return null;

                      return (
                        <div key={task.recordId} className="contents">
                          {isDraggedOver && draggedTaskId !== task.recordId && (
                        <div className="h-24 mb-4 rounded-[1.5rem] border-2 border-dashed border-signal-500/50 bg-signal-500/10 transition-all duration-300" />
                      )}
                      <div
                        key={task.recordId}
                        className="task-card-entry"
                        data-task-id={task.recordId}
                        onDragOver={(e) => { e.stopPropagation(); handleDragOver(status, index, e); }}
                        onDrop={(e) => { e.stopPropagation(); handleDrop(status, index, e); }}
                      >
                          <KanbanTaskCard
                            viewModel={viewModel}
                            index={index}
                            onEdit={handleEditClick}
                            onDelete={handleDeleteTask}
                            agentPresetName={task.agentPresetId ? agentPresetsMap.get(task.agentPresetId)?.name ?? null : null}
                            agentPresetAvatarConfig={task.agentPresetId ? agentPresetsMap.get(task.agentPresetId)?.avatarConfig : undefined}
                            isDragging={draggedTaskId === task.recordId}
                            onDragStart={(e) => handleDragStart(task.recordId, e)}
                            onDragEnd={handleDragEnd}
                          />
                        </div>
                        </div>
                      );
                    })}
                    {dropTargetContext?.status === status && dropTargetContext?.index === columnTasks.length && (
                        <div className="h-24 mt-4 rounded-[1.5rem] border-2 border-dashed border-signal-500/50 bg-signal-500/10 transition-all duration-300" />
                      )}
                  </div>
                ) : null}
                </SkeletonLoader>
              </div>
            </div>
          ))}
        </div>
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
