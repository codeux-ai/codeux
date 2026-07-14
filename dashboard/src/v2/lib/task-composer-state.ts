import { useState, useEffect, useMemo } from "preact/hooks";
import type { Task, TaskExecutorType, TaskPriority, TaskStatus, Sprint } from "../types.js";
import { sprintAuthoringMessages } from "../i18n/messages/sprint-authoring.js";
import { DEFAULT_DASHBOARD_LOCALE, translateDashboardMessage, type DashboardLocale } from "../i18n/locales.js";

export interface TaskDraft {
  sprintId: string;
  title: string;
  description: string;
  promptMarkdown: string;
  status: TaskStatus;
  priority: TaskPriority;
  executorType: TaskExecutorType;
  agentPresetId: string | null;
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
  agentPresetId: string | null;
  setAgentPresetId: (val: string | null) => void;
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
  touchedFields: Record<string, boolean>;
  setFieldTouched: (field: string) => void;
  hasAttemptedSubmit: boolean;
  setHasAttemptedSubmit: (val: boolean) => void;
  isTitleValid: boolean;
  titleError: string | undefined;
  isSprintIdValid: boolean;
  sprintIdError: string | undefined;
  isDescriptionValid: boolean;
  descriptionError: string | undefined;
  isPromptMarkdownValid: boolean;
  promptMarkdownError: string | undefined;
  isExecutorTypeValid: boolean;
  executorTypeError: string | undefined;
  isPriorityValid: boolean;
  priorityError: string | undefined;
  isStatusValid: boolean;
  statusError: string | undefined;
  getPayload: () => TaskDraft;
}

export const useTaskComposerState = (
  sprints: Sprint[],
  availableTasks: Task[],
  initialTask?: Task | null,
  initialSprintId?: string | null,
  locale: DashboardLocale = DEFAULT_DASHBOARD_LOCALE,
): TaskComposerState => {
  const defaultSprintId = initialTask?.sprintId || initialSprintId || sprints[0]?.id || "";

  const [sprintId, setSprintId] = useState(defaultSprintId);
  const [title, setTitle] = useState(initialTask?.title || "");
  const [description, setDescription] = useState(initialTask?.description || "");
  const [promptMarkdown, setPromptMarkdown] = useState(initialTask?.promptMarkdown || "");
  const [status, setStatus] = useState<TaskStatus>(initialTask?.status || "pending");
  const [priority, setPriority] = useState<TaskPriority>(initialTask?.priority || "medium");
  const [executorType, setExecutorType] = useState<TaskExecutorType>(initialTask?.executorType || "auto");
  const [agentPresetId, setAgentPresetId] = useState<string | null>(initialTask?.agentPresetId ?? null);
  const [dependsOnTaskIds, setDependsOnTaskIds] = useState<string[]>(initialTask?.dependsOnTaskIds || []);

  const isEditing = Boolean(initialTask);

  const [dependencySearchQuery, setDependencySearchQuery] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [touchedFields, setTouchedFields] = useState<Record<string, boolean>>({});
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);

  const setFieldTouched = (field: string) => {
    setTouchedFields((prev) => ({ ...prev, [field]: true }));
  };

  const validationErrors = useMemo(() => {
    const errors: Record<string, string> = {};
    const t = (key: keyof typeof sprintAuthoringMessages.en): string => translateDashboardMessage(sprintAuthoringMessages, locale, key);
    if (!sprintId) errors.sprintId = t("sprintRequired");
    if (!title.trim()) {
      errors.title = t("taskTitleRequired");
    } else if (title.trim().length < 3) {
      errors.title = t("taskTitleMinLength");
    }
    if (!description.trim()) {
      errors.description = t("taskDetailsRequired");
    }
    if (!promptMarkdown.trim()) {
      errors.promptMarkdown = t("executionPromptRequired");
    }
    if (!executorType) {
      errors.executorType = t("executorRequired");
    }
    if (!priority) {
      errors.priority = t("priorityRequired");
    }
    if (!status) {
      errors.status = t("statusRequired");
    }
    return errors;
  }, [sprintId, title, description, promptMarkdown, executorType, priority, status, locale]);

  useEffect(() => {
    if (initialTask) {
      setSprintId(initialTask.sprintId);
      setTitle(initialTask.title);
      setDescription(initialTask.description || "");
      setPromptMarkdown(initialTask.promptMarkdown || "");
      setStatus(initialTask.status);
      setPriority(initialTask.priority);
      setExecutorType(initialTask.executorType);
      setAgentPresetId(initialTask.agentPresetId ?? null);
      setDependsOnTaskIds(initialTask.dependsOnTaskIds || []);
    } else {
      setSprintId(initialSprintId || sprints[0]?.id || "");
      setTitle("");
      setDescription("");
      setPromptMarkdown("");
      setStatus("pending");
      setPriority("medium");
      setExecutorType("auto");
      setAgentPresetId(null);
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

      // Cycle detection: if making initialTask depend on this task would create a cycle
      if (initialTask?.recordId) {
        const visited = new Set<string>();
        const checkCycle = (currentId: string): boolean => {
          if (currentId === initialTask.recordId) return true;
          if (visited.has(currentId)) return false;
          visited.add(currentId);
          const currentTask = availableTasks.find((t) => t.recordId === currentId);
          if (!currentTask) return false;
          return currentTask.dependsOnTaskIds.some(checkCycle);
        };
        if (checkCycle(task.recordId)) return false;
      }

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
    agentPresetId: agentPresetId?.trim() || null,
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
    agentPresetId, setAgentPresetId,
    dependsOnTaskIds, setDependsOnTaskIds,
    toggleDependency,
    dependencyOptions,
    isEditing,
    isValid,
    dependencySearchQuery, setDependencySearchQuery,
    isSubmitting, setIsSubmitting,
    submitError, setSubmitError,
    validationErrors,
    touchedFields, setFieldTouched,
    hasAttemptedSubmit, setHasAttemptedSubmit,
    isTitleValid: !validationErrors.title,
    titleError: validationErrors.title,
    isSprintIdValid: !validationErrors.sprintId,
    sprintIdError: validationErrors.sprintId,
    isDescriptionValid: !validationErrors.description,
    descriptionError: validationErrors.description,
    isPromptMarkdownValid: !validationErrors.promptMarkdown,
    promptMarkdownError: validationErrors.promptMarkdown,
    isExecutorTypeValid: !validationErrors.executorType,
    executorTypeError: validationErrors.executorType,
    isPriorityValid: !validationErrors.priority,
    priorityError: validationErrors.priority,
    isStatusValid: !validationErrors.status,
    statusError: validationErrors.status,
    getPayload,
  };
};
