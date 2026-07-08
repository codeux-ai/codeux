import { useRouterState } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { RefObject } from "preact";
import { useDashboardRuntimeData } from "../../hooks/use-dashboard-runtime-data.js";
import { useSprints } from "../../hooks/useSprints.js";
import type { AddProjectModalSubmission } from "../components/ui/AddProjectModal.js";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../lib/settings.js";
import { buildProjectCreationSettingsOverride } from "../../lib/settings-updaters.js";
import type {
  TaskBoardPriorityFilter,
  TaskBoardStatusFilter,
} from "../components/tasks/TaskBoardFilters.js";
import type { TaskBoardDropTargetContext } from "../components/tasks/TaskBoardColumns.js";
import { useProjectData } from "../context/project-data.js";
import { DEFAULT_LIST_WINDOW, type ListWindowOption } from "../lib/list-window.js";
import { fetchAgentPresets } from "../lib/agent-preset-api.js";
import { createTask, deleteTask, updateTask } from "../lib/project-api.js";
import { resolveTaskDropStatus } from "../lib/tasks/task-board-actions.js";
import {
  buildTaskBoardViewModel,
  type TaskBoardViewModel,
} from "../lib/tasks/task-board-view-model.js";
import { STATUS_CFG } from "../lib/tasks-constants.js";
import type { TaskDraft } from "../lib/task-composer-state.js";
import type { AgentPreset, Sprint, Task, TaskStatus } from "../types.js";
import { useProjectEffectiveSettings } from "./use-project-effective-settings.js";
import { useProjectTasks } from "./use-project-tasks.js";
import { useReducedMotion } from "./use-reduced-motion.js";

export interface TaskBoardController {
  projects: ReturnType<typeof useProjectData>["projects"];
  selectedProject: ReturnType<typeof useProjectData>["selectedProject"];
  sprints: Sprint[];
  sprintsLoading: boolean;
  selectedSprintId: string | null;
  taskScopeSprintId: string | null;
  selectedSprintModel: Sprint | null;
  sprintKeyPrefix: string;
  isTaskScopeReady: boolean;
  tasks: Task[];
  loading: boolean;
  error: string | null;
  statusFilter: TaskBoardStatusFilter;
  setStatusFilter: (filter: TaskBoardStatusFilter) => void;
  priorityFilter: TaskBoardPriorityFilter;
  setPriorityFilter: (filter: TaskBoardPriorityFilter) => void;
  listWindow: ListWindowOption;
  setListWindow: (window: ListWindowOption) => void;
  showComposer: boolean;
  editingTask: Task | null;
  composerRef: RefObject<HTMLDivElement>;
  showAddProjectModal: boolean;
  setShowAddProjectModal: (show: boolean) => void;
  reducedMotion: boolean;
  showSkeletons: boolean;
  filterTransitionPending: boolean;
  boardCountAnnouncement: string;
  boardViewModel: TaskBoardViewModel;
  draggedTaskId: string | null;
  dropTargetContext: TaskBoardDropTargetContext | null;
  agentPresets: AgentPreset[];
  agentPresetsMap: Map<string, AgentPreset>;
  resolvedTaskId: string | null;
  clearResolvedTaskId: () => void;
  handleSprintScopeSelect: (sprintId: string | null) => void;
  handleComposerToggle: () => void;
  handleComposerClose: () => void;
  handleTaskSubmit: (draft: TaskDraft) => Promise<void>;
  handleDragStart: (taskId: string, event: DragEvent) => void;
  handleDragEnd: () => void;
  handleDragOver: (status: TaskStatus, index: number, event: DragEvent) => void;
  handleDrop: (status: TaskStatus, event: DragEvent) => Promise<void>;
  handleDeleteTask: (task: Task) => Promise<void>;
  handleEditClick: (task: Task) => void;
  handleAddProject: (project: AddProjectModalSubmission) => Promise<void>;
}

function replaceTaskBoardSearch(params: URLSearchParams): void {
  const nextSearch = params.toString();
  const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ""}${window.location.hash}`;
  window.history.replaceState(window.history.state, "", nextUrl);
}

function buildOptimisticTask(args: {
  draft: TaskDraft;
  recordId: string;
  sprintName: string;
}): Task {
  const now = new Date().toISOString();
  return {
    recordId: args.recordId,
    id: "OPT-...",
    source: "dash",
    sprint: args.sprintName,
    sprintId: args.draft.sprintId,
    title: args.draft.title,
    status: args.draft.status,
    priority: args.draft.priority,
    executorType: args.draft.executorType,
    assignee: "Pending",
    time: "...",
    createdAt: now,
    updatedAt: now,
    promptMarkdown: args.draft.promptMarkdown,
    description: args.draft.description,
    dependsOnTaskIds: args.draft.dependsOnTaskIds,
    agentPresetId: args.draft.agentPresetId,
    isIndependent: false,
    isMerged: false,
    mergeIndicator: null,
    isOptimistic: true,
  };
}

function areArrayItemsStable<T>(previous: readonly T[], next: readonly T[]): boolean {
  return previous.length === next.length && previous.every((item, index) => Object.is(item, next[index]));
}

function useStableArrayValue<T>(value: T[]): T[] {
  const stableRef = useRef(value);
  if (!areArrayItemsStable(stableRef.current, value)) {
    stableRef.current = value;
  }
  return stableRef.current;
}

export function useTaskBoardController(): TaskBoardController {
  const { projects, selectedProject, selectProject, createProject } = useProjectData();
  const locationSearch = useRouterState({ select: (state) => state.location.searchStr });
  const routeProjectId = useMemo(() => {
    const params = new URLSearchParams(locationSearch);
    return params.get("projectId")?.trim() || null;
  }, [locationSearch]);

  useEffect(() => {
    if (!routeProjectId || selectedProject?.id === routeProjectId) {
      return;
    }
    void selectProject(routeProjectId);
  }, [routeProjectId, selectedProject?.id, selectProject]);

  const routeProjectReady = !routeProjectId || selectedProject?.id === routeProjectId;
  const projectId = routeProjectReady ? selectedProject?.id || null : null;
  const {
    data: sprints,
    loading: sprintsLoading,
    selectedSprintId,
    selectSprint,
    refetch: refreshSprints,
  } = useSprints(projectId);
  const currentProjectSprints = useMemo(() => {
    if (!projectId) {
      return [];
    }
    return sprints.filter((sprint) => !sprint.projectId || sprint.projectId === projectId);
  }, [projectId, sprints]);
  const initialSprint = useMemo(() => {
    const params = new URLSearchParams(locationSearch);
    return params.get("sprintId") || params.get("sprint");
  }, [locationSearch]);
  const routeSprintId = useMemo(() => {
    if (!initialSprint) {
      return null;
    }
    return currentProjectSprints.some((sprint) => sprint.id === initialSprint) ? initialSprint : null;
  }, [currentProjectSprints, initialSprint]);
  const validSelectedSprintId = useMemo(() => {
    if (!selectedSprintId) {
      return null;
    }
    return currentProjectSprints.some((sprint) => sprint.id === selectedSprintId) ? selectedSprintId : null;
  }, [currentProjectSprints, selectedSprintId]);
  const taskScopeSprintId = routeSprintId ?? validSelectedSprintId;

  useEffect(() => {
    if (!routeProjectReady || !initialSprint || routeSprintId || sprintsLoading) {
      return;
    }
    const params = new URLSearchParams(locationSearch);
    if (params.get("sprintId") !== initialSprint && params.get("sprint") !== initialSprint) {
      return;
    }
    params.delete("sprintId");
    params.delete("sprint");
    replaceTaskBoardSearch(params);
  }, [initialSprint, locationSearch, routeProjectReady, routeSprintId, sprintsLoading]);

  useEffect(() => {
    if (!routeProjectReady || !routeSprintId || routeSprintId === selectedSprintId) {
      return;
    }
    void selectSprint(routeSprintId);
  }, [routeProjectReady, routeSprintId, selectedSprintId, selectSprint]);

  const { execution, status } = useDashboardRuntimeData(
    projectId,
    routeProjectReady && !!selectedProject,
    { selectedSprintId: taskScopeSprintId },
  );
  const taskDispatches = useStableArrayValue(execution.taskDispatches);
  const recentEvents = useStableArrayValue(execution.recentEvents);
  const subtasks = useStableArrayValue(status.subtasks ?? []);
  const settings = useProjectEffectiveSettings(projectId);
  const sprintKeyPrefix = settings.data?.settings?.git?.sprintKeyPrefix || "SPR";
  const gitSettings = settings.data?.settings?.git;
  const taskPullRequestsEnabled = gitSettings
    ? gitSettings.githubMode !== "LOCAL" && gitSettings.autoCreatePr === true
    : true;

  const [agentPresets, setAgentPresets] = useState<AgentPreset[]>([]);
  useEffect(() => {
    if (!projectId) {
      setAgentPresets([]);
      return;
    }
    let cancelled = false;
    fetchAgentPresets(projectId).then((presets) => {
      if (!cancelled) setAgentPresets(presets);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [projectId]);
  const agentPresetsMap = useMemo(() => (
    new Map(agentPresets.map((preset) => [preset.id, preset]))
  ), [agentPresets]);

  const [statusFilter, setStatusFilter] = useState<TaskBoardStatusFilter>("all");
  const [priorityFilter, setPriorityFilter] = useState<TaskBoardPriorityFilter>("all");
  const [listWindow, setListWindow] = useState<ListWindowOption>(DEFAULT_LIST_WINDOW);
  const [showComposer, setShowComposer] = useState(false);
  const [showAddProjectModal, setShowAddProjectModal] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [dropTargetContext, setDropTargetContext] = useState<TaskBoardDropTargetContext | null>(null);
  const [optimisticTasks, setOptimisticTasks] = useState<Task[]>([]);
  const [resolvedTaskId, setResolvedTaskId] = useState<string | null>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();

  const { tasks, loading, error, refresh: refreshTasks } = useProjectTasks(
    projectId,
    projects,
    currentProjectSprints,
    taskScopeSprintId,
  );
  const previousTaskViewModelsRef = useRef<TaskBoardViewModel["taskViewModels"] | undefined>(undefined);

  useEffect(() => {
    if (loading || tasks.length === 0) {
      return;
    }
    const params = new URLSearchParams(locationSearch);
    const taskId = params.get("taskId");
    if (!taskId) {
      return;
    }
    const targetTask = tasks.find((task) => task.id === taskId || task.recordId === taskId);
    if (!targetTask) {
      return;
    }
    setResolvedTaskId(targetTask.recordId);
    params.delete("taskId");
    replaceTaskBoardSearch(params);
  }, [locationSearch, loading, tasks]);

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

  const currentBoardViewModel = useMemo(() => {
    return buildTaskBoardViewModel({
      tasks,
      optimisticTasks,
      statusFilter,
      priorityFilter,
      listWindow,
      taskScopeSprintId,
      taskDispatches,
      recentEvents,
      subtasks,
      taskPullRequestsEnabled,
      previousTaskViewModels: previousTaskViewModelsRef.current,
    });
  }, [
    tasks,
    optimisticTasks,
    statusFilter,
    priorityFilter,
    listWindow,
    taskScopeSprintId,
    taskDispatches,
    recentEvents,
    subtasks,
    taskPullRequestsEnabled,
  ]);

  useEffect(() => {
    previousTaskViewModelsRef.current = currentBoardViewModel.taskViewModels;
  }, [currentBoardViewModel.taskViewModels]);
  const [displayBoardViewModel, setDisplayBoardViewModel] = useState<TaskBoardViewModel>(currentBoardViewModel);
  const [filterTransitionPending, setFilterTransitionPending] = useState(false);
  const previousFilterKeyRef = useRef(`${statusFilter}|${priorityFilter}`);

  useEffect(() => {
    const nextFilterKey = `${statusFilter}|${priorityFilter}`;
    if (previousFilterKeyRef.current !== nextFilterKey) {
      previousFilterKeyRef.current = nextFilterKey;
      setFilterTransitionPending(true);
      const timeoutId = window.setTimeout(() => {
        setDisplayBoardViewModel(currentBoardViewModel);
        setFilterTransitionPending(false);
      }, reducedMotion ? 0 : 160);
      return () => window.clearTimeout(timeoutId);
    }

    setDisplayBoardViewModel(currentBoardViewModel);
    setFilterTransitionPending(false);
    return undefined;
  }, [currentBoardViewModel, priorityFilter, reducedMotion, statusFilter]);

  const boardCountSummary = useMemo(() => (
    displayBoardViewModel.boardState.columns
      .map(({ status: columnStatus, count }) => `${STATUS_CFG[columnStatus].label}: ${count}`)
      .join(", ")
  ), [displayBoardViewModel.boardState.columns]);
  const [boardCountAnnouncement, setBoardCountAnnouncement] = useState("");
  const previousBoardCountSummaryRef = useRef("");

  useEffect(() => {
    if (loading || showSkeletons || filterTransitionPending || previousBoardCountSummaryRef.current === boardCountSummary) {
      return;
    }
    previousBoardCountSummaryRef.current = boardCountSummary;
    const timeoutId = window.setTimeout(() => {
      setBoardCountAnnouncement(`${displayBoardViewModel.filterAnnouncement} ${boardCountSummary}.`);
    }, 350);
    return () => window.clearTimeout(timeoutId);
  }, [boardCountSummary, displayBoardViewModel.filterAnnouncement, filterTransitionPending, loading, showSkeletons]);

  const selectedSprintModel = taskScopeSprintId
    ? currentProjectSprints.find((sprint) => sprint.id === taskScopeSprintId) || null
    : null;
  const isTaskScopeReady = !!selectedProject && currentProjectSprints.length > 0;

  const handleSprintScopeSelect = useCallback((sprintId: string | null) => {
    const nextSprintId = sprintId && currentProjectSprints.some((sprint) => sprint.id === sprintId)
      ? sprintId
      : null;
    const params = new URLSearchParams(locationSearch);
    if (nextSprintId) {
      params.set("sprintId", nextSprintId);
    } else {
      params.delete("sprintId");
    }
    params.delete("sprint");
    replaceTaskBoardSearch(params);
    void selectSprint(nextSprintId);
  }, [currentProjectSprints, locationSearch, selectSprint]);

  const scrollComposerIntoView = useCallback(() => {
    setTimeout(() => {
      if (typeof composerRef.current?.scrollIntoView === "function") {
        composerRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }, 50);
  }, []);

  const handleComposerToggle = useCallback(() => {
    if (showComposer || editingTask) {
      setShowComposer(false);
      setEditingTask(null);
      return;
    }
    setShowComposer(true);
    scrollComposerIntoView();
  }, [editingTask, scrollComposerIntoView, showComposer]);

  const handleComposerClose = useCallback(() => {
    setShowComposer(false);
    setEditingTask(null);
  }, []);

  const handleTaskSubmit = useCallback(async (draft: TaskDraft) => {
    if (!selectedProject) return;

    const isEditing = !!editingTask;
    const optId = `opt-${Date.now()}`;

    if (!isEditing) {
      setOptimisticTasks((prev) => [
        buildOptimisticTask({
          draft,
          recordId: optId,
          sprintName: sprints.find((sprint) => sprint.id === draft.sprintId)?.name || "...",
        }),
        ...prev,
      ]);
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
  }, [editingTask, refreshSprints, refreshTasks, selectedProject, sprints]);

  const handleDragStart = useCallback((taskId: string, event: DragEvent) => {
    if (reducedMotion) return;
    setDraggedTaskId(taskId);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
  }, [reducedMotion]);

  const handleDragEnd = useCallback(() => {
    setDraggedTaskId(null);
    setDropTargetContext(null);
  }, []);

  const handleDragOver = useCallback((status: TaskStatus, index: number, event: DragEvent) => {
    if (reducedMotion) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    setDropTargetContext({ status, index });
  }, [reducedMotion]);

  const handleDrop = useCallback(async (status: TaskStatus, event: DragEvent) => {
    event.preventDefault();
    if (reducedMotion) return;
    if (!draggedTaskId) return;

    const draggedTask = tasks.find((task) => task.recordId === draggedTaskId);
    if (!draggedTask) return;

    const targetStatus = resolveTaskDropStatus(draggedTask.status, status);
    if (targetStatus) {
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
    setDraggedTaskId(null);
    setDropTargetContext(null);
  }, [draggedTaskId, reducedMotion, refreshTasks, tasks]);

  const handleDeleteTask = useCallback(async (task: Task) => {
    await deleteTask(task.recordId);
    await Promise.all([refreshTasks(), refreshSprints()]);
    setEditingTask((prev) => prev?.recordId === task.recordId ? null : prev);
  }, [refreshSprints, refreshTasks]);

  const handleEditClick = useCallback((nextTask: Task) => {
    setEditingTask(nextTask);
    setShowComposer(true);
    scrollComposerIntoView();
  }, [scrollComposerIntoView]);

  const handleAddProject = useCallback(async (project: AddProjectModalSubmission) => {
    if (project.type === "new_project") {
      const isLocalProject = project.initMode === "new-local";
      const sourceRef = project.initMode === "new-local"
        ? (project.path || project.name)
        : (project.repoSlug || project.name);

      await createProject({
        name: project.name,
        sourceType: isLocalProject ? "local" : "git",
        sourceRef,
        initMode: project.initMode,
        remoteProvider: project.remoteProvider,
        isPrivate: project.isPrivate,
        settingsOverrides: buildProjectCreationSettingsOverride({
          ...(isLocalProject ? { githubMode: "LOCAL" as const } : {}),
          selectedTechstackId: project.selectedTechstackId ?? DEFAULT_DASHBOARD_SETTINGS.techstackCatalog.defaultTechstackId,
          applicationKind: project.applicationKind ?? null,
        }),
      });
      return;
    }

    await createProject({
      name: project.name,
      sourceType: project.type,
      sourceRef: project.path,
      cloneDir: project.cloneDir,
      ...(project.type === "local" ? { settingsOverrides: buildProjectCreationSettingsOverride({ githubMode: "LOCAL" }) } : {}),
    });
  }, [createProject]);

  const clearResolvedTaskId = useCallback(() => setResolvedTaskId(null), []);

  return {
    projects,
    selectedProject,
    sprints: currentProjectSprints,
    sprintsLoading,
    selectedSprintId: validSelectedSprintId,
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
    boardViewModel: displayBoardViewModel,
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
  };
}
