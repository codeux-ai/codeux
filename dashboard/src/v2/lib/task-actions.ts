import { useCallback } from "preact/hooks";
import { createTask, updateTask, deleteTask, fetchTasks } from "./project-api.js";
import type { CreateTaskInput, UpdateTaskInput, TaskRecord } from "../types.js";

// Custom hook to centralize task actions with automatic error handling & toast integration
export function useTaskActions(
  onError: (error: Error, retryAction: () => void) => void
) {
  const handleCreateTask = useCallback(async (projectId: string, input: CreateTaskInput): Promise<TaskRecord> => {
    try {
      return await createTask(projectId, input);
    } catch (error) {
      const e = error instanceof Error ? error : new Error(String(error));
      onError(e, () => { void handleCreateTask(projectId, input); });
      throw e;
    }
  }, [onError]);

  const handleUpdateTask = useCallback(async (taskId: string, input: UpdateTaskInput): Promise<TaskRecord> => {
    try {
      return await updateTask(taskId, input);
    } catch (error) {
      const e = error instanceof Error ? error : new Error(String(error));
      onError(e, () => { void handleUpdateTask(taskId, input); });
      throw e;
    }
  }, [onError]);

  const handleDeleteTask = useCallback(async (taskId: string): Promise<void> => {
    try {
      return await deleteTask(taskId);
    } catch (error) {
      const e = error instanceof Error ? error : new Error(String(error));
      onError(e, () => { void handleDeleteTask(taskId); });
      throw e;
    }
  }, [onError]);

  const handleFetchTasks = useCallback(async (projectId: string, sprintId?: string): Promise<TaskRecord[]> => {
    try {
      return await fetchTasks(projectId, sprintId);
    } catch (error) {
      const e = error instanceof Error ? error : new Error(String(error));
      onError(e, () => { void handleFetchTasks(projectId, sprintId); });
      throw e;
    }
  }, [onError]);

  return {
    handleCreateTask,
    handleUpdateTask,
    handleDeleteTask,
    handleFetchTasks
  };
}
