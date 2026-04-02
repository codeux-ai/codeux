// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { renderHook, act } from "@testing-library/preact";
import { useTaskComposerState } from "../../../dashboard/src/v2/lib/task-composer-state.js";
import type { Task, Sprint, TaskExecutorType, TaskPriority, TaskStatus } from "../../../dashboard/src/v2/types.js";

describe("Task Composer State Helper", () => {
  const mockSprints: Sprint[] = [
    { id: "s1", name: "Sprint 1", number: 1, projectId: "p1", status: "draft", goal: "", originalPrompt: null, createdAt: "", updatedAt: "", tasksCount: 0, date: "" },
    { id: "s2", name: "Sprint 2", number: 2, projectId: "p1", status: "draft", goal: "", originalPrompt: null, createdAt: "", updatedAt: "", tasksCount: 0, date: "" },
  ];

  const mockTasks: Task[] = [
    { recordId: "t1", id: "TASK-1", sprintId: "s1", title: "Task 1", status: "pending", priority: "medium", executorType: "auto", dependsOnTaskIds: [], source: "", sprint: "", assignee: "", time: "", createdAt: "", promptMarkdown: "", description: "", isIndependent: true, isMerged: false, mergeIndicator: null },
    { recordId: "t2", id: "TASK-2", sprintId: "s1", title: "Task 2", status: "pending", priority: "medium", executorType: "auto", dependsOnTaskIds: [], source: "", sprint: "", assignee: "", time: "", createdAt: "", promptMarkdown: "", description: "", isIndependent: true, isMerged: false, mergeIndicator: null },
    { recordId: "t3", id: "TASK-3", sprintId: "s2", title: "Task 3", status: "pending", priority: "medium", executorType: "auto", dependsOnTaskIds: [], source: "", sprint: "", assignee: "", time: "", createdAt: "", promptMarkdown: "", description: "", isIndependent: true, isMerged: false, mergeIndicator: null },
  ];

  it("initializes create state correctly", () => {
    const { result } = renderHook(() => useTaskComposerState(mockSprints, mockTasks));

    expect(result.current.isEditing).toBe(false);
    expect(result.current.sprintId).toBe("s1");
    expect(result.current.title).toBe("");
    expect(result.current.status).toBe("pending");
    expect(result.current.priority).toBe("medium");
    expect(result.current.executorType).toBe("auto");
    expect(result.current.dependsOnTaskIds).toEqual([]);
    expect(result.current.isValid).toBe(false);
    expect(result.current.isSubmitting).toBe(false);
    expect(result.current.submitError).toBeNull();
    expect(result.current.submitSuccess).toBe(false);
  });

  it("initializes create state with provided sprintId", () => {
    const { result } = renderHook(() => useTaskComposerState(mockSprints, mockTasks, null, "s2"));

    expect(result.current.sprintId).toBe("s2");
  });

  it("hydrates edit state correctly", () => {
    const initialTask = mockTasks[1]; // t2
    const { result } = renderHook(() => useTaskComposerState(mockSprints, mockTasks, initialTask));

    expect(result.current.isEditing).toBe(true);
    expect(result.current.sprintId).toBe("s1");
    expect(result.current.title).toBe("Task 2");
    expect(result.current.isValid).toBe(true);
  });

  it("filters dependency options by selected sprint", () => {
    const { result } = renderHook(() => useTaskComposerState(mockSprints, mockTasks, null, "s1"));

    expect(result.current.dependencyOptions.map(t => t.recordId)).toEqual(["t1", "t2"]);

    act(() => {
      result.current.setSprintId("s2");
    });

    expect(result.current.dependencyOptions.map(t => t.recordId)).toEqual(["t3"]);
  });

  it("excludes self from dependency options in edit mode", () => {
    const initialTask = mockTasks[0]; // t1
    const { result } = renderHook(() => useTaskComposerState(mockSprints, mockTasks, initialTask));

    expect(result.current.dependencyOptions.map(t => t.recordId)).toEqual(["t2"]); // t1 is excluded
  });

  it("handles submitting states correctly", () => {
    const { result } = renderHook(() => useTaskComposerState(mockSprints, mockTasks));

    act(() => {
      result.current.setIsSubmitting(true);
      result.current.setSubmitError("Failed");
      result.current.setSubmitSuccess(true);
    });

    expect(result.current.isSubmitting).toBe(true);
    expect(result.current.submitError).toBe("Failed");
    expect(result.current.submitSuccess).toBe(true);
  });

  it("preserves task submit payload shape", () => {
    const { result } = renderHook(() => useTaskComposerState(mockSprints, mockTasks));

    act(() => {
      result.current.setTitle("New Task");
      result.current.setDescription("Desc");
      result.current.setPromptMarkdown("Prompt");
      result.current.setPriority("high");
      result.current.toggleDependency("t1");
    });

    const payload = result.current.getPayload();
    expect(payload).toEqual({
      sprintId: "s1",
      title: "New Task",
      description: "Desc",
      promptMarkdown: "Prompt",
      status: "pending",
      priority: "high",
      executorType: "auto",
      dependsOnTaskIds: ["t1"],
    });
  });
});
