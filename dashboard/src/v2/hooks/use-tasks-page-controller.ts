import type { RefObject } from "preact";
import { useRouterState } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { AddProjectModalSubmission } from "../components/ui/AddProjectModal.js";
import { useProjectData } from "../context/project-data.js";
import { getTaskLane } from "../lib/task-board-state.js";
import { buildTaskBoardViewModel } from "../lib/tasks/task-board-view-model.js";
import { DEFAULT_LIST_WINDOW, type ListWindowOption } from "../lib/list-window.js";
import { createTask, deleteTask, updateTask } from "../lib/project-api.js";
import type { Sprint, Task, TaskPriority, TaskStatus } from "../types.js";
import { useDashboardRuntimeData } from "../../hooks/use-dashboard-runtime-data.js";
import { useSprints } from "../../hooks/useSprints.js";
import { useProjectTasks } from "./use-project-tasks.js";

export type TasksPageStatusFilter = "all" | TaskStatus;
export type TasksPagePriorityFilter = "all" | TaskPriority;

export interface TaskComposerDraft {
  sprintId: string;
  title: string;
  description: string;
  promptMarkdown: string;
  status: TaskStatus;
  priority: TaskPriority;
  executorType: Task["executorType"];
  dependsOnTaskIds: string[];
}

export interface TasksPageController {
  projects: ReturnType<typeof useProjectData>["projects"];
  selectedProject: ReturnType<typeof useProjectData>["selectedProject"];
  projectId: string | null;
  sprints: Sprint[];
  sprintsLoading: boolean;
  selectedSprintId: string | null;
  taskScopeSprintId: string | null;
  selectedSprintModel: Sprint | null;
  isTaskScopeReady: boolean;
  tasks: Task[];
  loading: boolean;
  error: string | null;
  filteredTasks: Task[];
  stats: ReturnType<typeof buildTaskBoardViewModel>["boardState"]["stats"];
  columns: ReturnType<typeof buildTaskBoardViewModel>["boardState"]["columns"];
  taskViewModels: ReturnType<typeof buildTaskBoardViewModel>["taskViewModels"];
  statusFilter: TasksPageStatusFilter;
  setStatusFilter: (statusFilter: TasksPageStatusFilter) => void;
  priorityFilter: TasksPagePriorityFilter;
  setPriorityFilter: (priorityFilter: TasksPagePriorityFilter) => void;
  listWindow: ListWindowOption;
  setListWindow: (listWindow: ListWindowOption) => void;
  showComposer: boolean;
  editingTask: Task | null;
  composerRef: RefObject<HTMLDivElement>;
  showAddProjectModal: boolean;
  setShowAddProjectModal: (show: boolean) => void;
  draggedTaskId: string | null;
  dropTargetContext: { status: TaskStatus; index: number } | null;
  resolvedTaskId: string | null;
  clearResolvedTaskId: () => void;
  handleSprintScopeSelect: (sprintId: string | null) => void;
  handleComposerToggle: () => void;
  handleComposerClose: () => void;
  handleTaskSubmit: (draft: TaskComposerDraft) => Promise<void>;
  handleDragStart: (taskId: string, e: DragEvent) => void;
  handleDragEnd: () => void;
  handleDragOver: (status: TaskStatus, index: number, e: DragEvent) => void;
  handleDrop: (status: TaskStatus, insertIndex: number, e: DragEvent) => Promise<void>;
  handleDeleteTask: (task: Task) => Promise<void>;
  handleEditClick: (nextTask: Task) => void;
  handleAddProject: (project: AddProjectModalSubmission) => Promise<void>;
}

interface UseTasksPageControllerOptions {
  reducedMotion: boolean;
}

const scrollComposerIntoView = (composerRef: RefObject<HTMLDivElement>): void => {
  setTimeout(() => composerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
};

export function useTasksPageController({ reducedMotion }: UseTasksPageControllerOptions): TasksPageController {
  const { projects, selectedProject, createProject } = useProjectData();
  const projectId = selectedProject?.id || null;
  const { execution, status } = useDashboardRuntimeData(
    projectId,
    !!selectedProject,
  );
  const {
    data: sprints,
    loading: sprintsLoading,
    selectedSprintId,
    selectSprint,
    refetch: refreshSprints,
  } = useSprints(selectedProject?.id || null);
  const locationSearch = useRouterState({ select: (state) => state.location.searchStr });
  const initialSprint = useMemo(() => {
    const params = new URLSearchParams(locationSearch);
    return params.get("sprintId") || params.get("sprint");
  }, [locationSearch]);
  const routeSprintId = useMemo(() => {
    if (!initialSprint) {
      return null;
    }
    return sprints.some((sprint: Sprint) => sprint.id === initialSprint) ? initialSprint : null;
  }, [initialSprint, sprints]);
  const taskScopeSprintId = routeSprintId ?? selectedSprintId;

  useEffect(() => {
    if (!routeSprintId || routeSprintId === selectedSprintId) {
      return;
    }
    void selectSprint(routeSprintId);
  }, [routeSprintId, selectedSprintId, selectSprint]);

  const [statusFilter, setStatusFilter] = useState<TasksPageStatusFilter>("all");
  const [priorityFilter, setPriorityFilter] = useState<TasksPagePriorityFilter>("all");
  const [listWindow, setListWindow] = useState<ListWindowOption>(DEFAULT_LIST_WINDOW);
  const [showComposer, setShowComposer] = useState(false);
  const [showAddProjectModal, setShowAddProjectModal] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [dropTargetContext, setDropTargetContext] = useState<{ status: TaskStatus; index: number } | null>(null);
  const [optimisticTasks, setOptimisticTasks] = useState<Task[]>([]);
  const [resolvedTaskId, setResolvedTaskId] = useState<string | null>(null);
  const composerRef = useRef<HTMLDivElement>(null);

  const { tasks, loading, error, refresh: refreshTasks } = useProjectTasks(
    selectedProject?.id || null,
    projects,
    sprints,
    taskScopeSprintId
  );

  useEffect(() => {
    if (loading || tasks.length === 0) {
      return;
    }

    const params = new URLSearchParams(locationSearch);
    const taskId = params.get("taskId");
    if (!taskId || !tasks.some((task) => task.id === taskId || task.recordId === taskId)) {
      return;
    }

    const targetTask = tasks.find((task) => task.id === taskId || task.recordId === taskId);
    if (!targetTask) {
      return;
    }

    setResolvedTaskId(targetTask.recordId);
    params.delete("taskId");
    const nextSearch = params.toString();
    const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ""}${window.location.hash}`;
    window.history.replaceState(window.history.state, "", nextUrl);
  }, [locationSearch, loading, tasks]);

  const { boardState, taskViewModels } = useMemo(() => {
    const now = Date.now();
    return buildTaskBoardViewModel({
      tasks,
      optimisticTasks,
      statusFilter,
      priorityFilter,
      listWindow,
      taskScopeSprintId,
      taskDispatches: execution.taskDispatches,
      recentEvents: execution.recentEvents,
      subtasks: status.subtasks ?? [],
      now,
    });
  }, [
    tasks,
    optimisticTasks,
    statusFilter,
    priorityFilter,
    listWindow,
    taskScopeSprintId,
    execution.taskDispatches,
    execution.recentEvents,
    status.subtasks,
  ]);

  const selectedSprintModel = taskScopeSprintId ? sprints.find((sprint: Sprint) => sprint.id === taskScopeSprintId) || null : null;
  const isTaskScopeReady = !!selectedProject && sprints.length > 0;

  const handleSprintScopeSelect = useCallback((sprintId: string | null) => {
    const params = new URLSearchParams(locationSearch);
    if (sprintId) {
      params.set("sprintId", sprintId);
    } else {
      params.delete("sprintId");
    }
    params.delete("sprint");
    const nextSearch = params.toString();
    const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ""}${window.location.hash}`;
    window.history.replaceState(window.history.state, "", nextUrl);
    void selectSprint(sprintId);
  }, [locationSearch, selectSprint]);

  const handleComposerToggle = useCallback(() => {
    if (showComposer || editingTask) {
      setShowComposer(false);
      setEditingTask(null);
      return;
    }
    setShowComposer(true);
    scrollComposerIntoView(composerRef);
  }, [editingTask, showComposer]);

  const handleComposerClose = useCallback(() => {
    setShowComposer(false);
    setEditingTask(null);
  }, []);

  const handleTaskSubmit = useCallback(async (draft: TaskComposerDraft) => {
    if (!selectedProject) return;

    const isEditing = !!editingTask;
    const optId = `opt-${Date.now()}`;

    if (!isEditing) {
      const optimisticTask: Task = {
        recordId: optId,
        id: "OPT-...",
        source: "dash",
        sprint: sprints.find((sprint: Sprint) => sprint.id === draft.sprintId)?.name || "...",
        sprintId: draft.sprintId,
        title: draft.title,
        status: draft.status,
        priority: draft.priority,
        executorType: draft.executorType,
        assignee: "Pending",
        time: "...",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        promptMarkdown: draft.promptMarkdown,
        description: draft.description,
        dependsOnTaskIds: draft.dependsOnTaskIds,
        isIndependent: false,
        isMerged: false,
        mergeIndicator: null,
        isOptimistic: true,
      };
      setOptimisticTasks((prev) => [optimisticTask, ...prev]);
    }

    try {
      let createdTaskId: string | null = null;
      if (isEditing) {
        await updateTask(editingTask.recordId, draft);
      } else {
        const createdTask = await createTask(selectedProject.id, draft);
        createdTaskId = createdTask.id;
      }
      await Promise.all([refreshTasks(), refreshSprints()]);
      setEditingTask(null);
      setShowComposer(false);

      if (createdTaskId) {
        setResolvedTaskId(createdTaskId);
      }
    } finally {
      if (!isEditing) {
        setOptimisticTasks((prev) => prev.filter((task) => task.recordId !== optId));
      }
    }
  }, [selectedProject, editingTask, refreshTasks, refreshSprints, sprints]);

  const handleDragStart = useCallback((taskId: string, e: DragEvent) => {
    if (reducedMotion) return;
    setDraggedTaskId(taskId);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
  }, [reducedMotion]);

  const handleDragEnd = useCallback(() => {
    setDraggedTaskId(null);
    setDropTargetContext(null);
  }, []);

  const handleDragOver = useCallback((dragStatus: TaskStatus, index: number, e: DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    setDropTargetContext({ status: dragStatus, index });
  }, []);

  const handleDrop = useCallback(async (dragStatus: TaskStatus, _insertIndex: number, e: DragEvent) => {
    e.preventDefault();
    if (!draggedTaskId) return;

    const draggedTask = tasks.find((task) => task.recordId === draggedTaskId);
    if (!draggedTask) return;

    const laneMap: Record<string, TaskStatus> = {
      pending: "pending",
      in_progress: "in_progress",
      completed: "completed",
    };

    if (getTaskLane(draggedTask.status) !== dragStatus) {
      const targetStatus = laneMap[dragStatus] || draggedTask.status;
      const updatedTask = { ...draggedTask, status: targetStatus };
      setOptimisticTasks((prev) => {
        const filtered = prev.filter((task) => task.recordId !== updatedTask.recordId);
        return [updatedTask, ...filtered];
      });

      try {
        await updateTask(draggedTask.recordId, { status: targetStatus });
        await refreshTasks();
      } finally {
        setOptimisticTasks((prev) => prev.filter((task) => task.recordId !== updatedTask.recordId));
      }
    } else {
      const targetStatus = laneMap[dragStatus] || draggedTask.status;
      if (draggedTask.status !== targetStatus) {
        const updatedTask = { ...draggedTask, status: targetStatus };
        setOptimisticTasks((prev) => {
          const filtered = prev.filter((task) => task.recordId !== updatedTask.recordId);
          return [updatedTask, ...filtered];
        });
        try {
          await updateTask(draggedTask.recordId, { status: targetStatus });
          await refreshTasks();
        } finally {
          setOptimisticTasks((prev) => prev.filter((task) => task.recordId !== updatedTask.recordId));
        }
      }
    }
    setDraggedTaskId(null);
    setDropTargetContext(null);
  }, [draggedTaskId, tasks, refreshTasks]);

  const handleDeleteTask = useCallback(async (task: Task) => {
    await deleteTask(task.recordId);
    await Promise.all([refreshTasks(), refreshSprints()]);
    setEditingTask((prev) => prev?.recordId === task.recordId ? null : prev);
  }, [refreshTasks, refreshSprints]);

  const handleEditClick = useCallback((nextTask: Task) => {
    setEditingTask(nextTask);
    setShowComposer(true);
    scrollComposerIntoView(composerRef);
  }, []);

  const handleAddProject = useCallback(async (project: AddProjectModalSubmission) => {
    if (project.type === "new_project") {
      const sourceRef = project.initMode === "new-local"
        ? (project.path || project.name)
        : (project.repoSlug || project.name);

      await createProject({
        name: project.name,
        sourceType: project.initMode === "new-local" ? "local" : "git",
        sourceRef,
        initMode: project.initMode,
        remoteProvider: project.remoteProvider,
        isPrivate: project.isPrivate,
      });
      return;
    }

    await createProject({
      name: project.name,
      sourceType: project.type,
      sourceRef: project.path,
      cloneDir: project.cloneDir,
    });
  }, [createProject]);

  const clearResolvedTaskId = useCallback(() => {
    setResolvedTaskId(null);
  }, []);

  return {
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
    filteredTasks: boardState.filteredTasks,
    stats: boardState.stats,
    columns: boardState.columns,
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
  };
}
