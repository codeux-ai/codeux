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
    return availableTasks.filter((task) => task.sprintId === sprintId && task.recordId !== initialTask?.recordId);
  }, [availableTasks, sprintId, initialTask?.recordId]);

  const toggleDependency = (taskId: string) => {
    setDependsOnTaskIds((current) => (
      current.includes(taskId)
        ? current.filter((id) => id !== taskId)
        : [...current, taskId]
    ));
  };

  const isValid = Boolean(title.trim() && sprintId);

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
    getPayload,
  };
};
