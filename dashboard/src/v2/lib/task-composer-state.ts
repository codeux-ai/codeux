import { useState, useEffect, useMemo } from "preact/hooks";
import type { Task, TaskExecutorType, TaskPriority, TaskStatus, Sprint } from "../types.js";

export interface TaskDraft {
  sprintId: string;
  title: string;
  description: string;
  promptMarkdown: string;
  status: TaskStatus;
  priority: TaskPriority;
  executorType: TaskExecutorType;
  dependsOnTaskIds: string[];
}

export interface TaskComposerState {
  sprintId: string;
  setSprintId: (val: string) => void;
  title: string;
  setTitle: (val: string) => void;
  description: string;
  setDescription: (val: string) => void;
  promptMarkdown: string;
  setPromptMarkdown: (val: string) => void;
  status: TaskStatus;
  setStatus: (val: TaskStatus) => void;
  priority: TaskPriority;
  setPriority: (val: TaskPriority) => void;
  executorType: TaskExecutorType;
  setExecutorType: (val: TaskExecutorType) => void;
  dependsOnTaskIds: string[];
  setDependsOnTaskIds: (val: string[]) => void;
  toggleDependency: (taskId: string) => void;
  dependencyOptions: Task[];
  isEditing: boolean;
  dependencySearchQuery: string;
  setDependencySearchQuery: (val: string) => void;
  isSubmitting: boolean;
  setIsSubmitting: (val: boolean) => void;
  submitError: string | null;
  setSubmitError: (val: string | null) => void;
  validationErrors: Record<string, string>;
  isValid: boolean;
  getPayload: () => TaskDraft;
}

export const useTaskComposerState = (
  sprints: Sprint[],
  availableTasks: Task[],
  initialTask?: Task | null,
  initialSprintId?: string | null
): TaskComposerState => {
  const defaultSprintId = initialTask?.sprintId || initialSprintId || sprints[0]?.id || "";

  const [sprintId, setSprintId] = useState(defaultSprintId);
  const [title, setTitle] = useState(initialTask?.title || "");
  const [description, setDescription] = useState(initialTask?.description || "");
  const [promptMarkdown, setPromptMarkdown] = useState(initialTask?.promptMarkdown || "");
  const [status, setStatus] = useState<TaskStatus>(initialTask?.status || "pending");
  const [priority, setPriority] = useState<TaskPriority>(initialTask?.priority || "medium");
  const [executorType, setExecutorType] = useState<TaskExecutorType>(initialTask?.executorType || "auto");
  const [dependsOnTaskIds, setDependsOnTaskIds] = useState<string[]>(initialTask?.dependsOnTaskIds || []);

  const isEditing = Boolean(initialTask);

  const [dependencySearchQuery, setDependencySearchQuery] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const validationErrors = useMemo(() => {
    const errors: Record<string, string> = {};
    if (!sprintId) errors.sprintId = "Sprint selection is required.";
    if (!title.trim()) errors.title = "Task title is required.";
    return errors;
  }, [sprintId, title]);

  useEffect(() => {
    if (initialTask) {
      setSprintId(initialTask.sprintId);
      setTitle(initialTask.title);
      setDescription(initialTask.description || "");
      setPromptMarkdown(initialTask.promptMarkdown || "");
      setStatus(initialTask.status);
      setPriority(initialTask.priority);
      setExecutorType(initialTask.executorType);
      setDependsOnTaskIds(initialTask.dependsOnTaskIds || []);
    } else {
      setSprintId(initialSprintId || sprints[0]?.id || "");
      setTitle("");
      setDescription("");
      setPromptMarkdown("");
      setStatus("pending");
      setPriority("medium");
      setExecutorType("auto");
      setDependsOnTaskIds([]);
    }
  }, [initialTask, initialSprintId, sprints]);

  useEffect(() => {
    // If sprint changes and it's not the initialTask's sprint, clear dependencies
    if (initialTask && sprintId === initialTask.sprintId) {
       // restore? maybe not needed if we just rely on user explicit change
    } else if (sprintId !== (initialTask?.sprintId || initialSprintId || sprints[0]?.id || "")) {
       setDependsOnTaskIds([]);
    }
  }, [sprintId]);

  const dependencyOptions = useMemo(() => {
    return availableTasks.filter((task) => {
      if (task.sprintId !== sprintId) return false;
      if (task.recordId === initialTask?.recordId) return false;

      if (dependencySearchQuery) {
        const query = dependencySearchQuery.toLowerCase();
        const matchesId = task.id ? task.id.toLowerCase().includes(query) : false;
        const matchesRecordId = task.recordId.toLowerCase().includes(query);
        const matchesTitle = task.title.toLowerCase().includes(query);
        return matchesId || matchesRecordId || matchesTitle;
      }

      return true;
    });
  }, [availableTasks, sprintId, initialTask?.recordId, dependencySearchQuery]);

  const toggleDependency = (taskId: string) => {
    setDependsOnTaskIds((current) => (
      current.includes(taskId)
        ? current.filter((id) => id !== taskId)
        : [...current, taskId]
    ));
  };

  const isValid = Object.keys(validationErrors).length === 0;

  const getPayload = (): TaskDraft => ({
    sprintId,
    title: title.trim(),
    description: description.trim(),
    promptMarkdown: promptMarkdown.trim(),
    status,
    priority,
    executorType,
    dependsOnTaskIds,
  });

  return {
    sprintId, setSprintId,
    title, setTitle,
    description, setDescription,
    promptMarkdown, setPromptMarkdown,
    status, setStatus,
    priority, setPriority,
    executorType, setExecutorType,
    dependsOnTaskIds, setDependsOnTaskIds,
    toggleDependency,
    dependencyOptions,
    isEditing,
    isValid,
    dependencySearchQuery, setDependencySearchQuery,
    isSubmitting, setIsSubmitting,
    submitError, setSubmitError,
    validationErrors,
    getPayload,
  };
};
