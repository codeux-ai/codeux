import { afterEach, describe, expect, it } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { AppDbStorage } from "../../../src/repositories/app-db-storage.js";
import { ProjectManagementRepository } from "../../../src/repositories/project-management-repository.js";
import { SchedulerRepository } from "../../../src/repositories/scheduler-repository.js";

const tempDirs: string[] = [];

async function createRepositories(): Promise<{
  dir: string;
  storage: AppDbStorage;
  projectRepository: ProjectManagementRepository;
  schedulerRepository: SchedulerRepository;
}> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "scheduler-repo-"));
  tempDirs.push(dir);
  const storage = new AppDbStorage(path.join(dir, "app.db"));
  return {
    dir,
    storage,
    projectRepository: new ProjectManagementRepository(storage),
    schedulerRepository: new SchedulerRepository(storage),
  };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("SchedulerRepository", () => {
  it("persists sprint scheduler entries with recurrence metadata", async () => {
    const { dir, projectRepository, schedulerRepository } = await createRepositories();
    const project = projectRepository.createProject({
      name: "Scheduler Project",
      sourceType: "local",
      sourceRef: dir,
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Morning check",
      goal: "Run morning checks.",
    });

    const entry = schedulerRepository.createEntry(project.id, {
      targetType: "sprint",
      scheduledFor: "2026-05-18T09:00:00.000Z",
      recurrence: { frequency: "daily", interval: 1, endMode: "after_count", count: 4 },
      sprintTarget: { sprintId: sprint.id },
    });

    expect(entry.projectId).toBe(project.id);
    expect(entry.targetType).toBe("sprint");
    expect(entry.sprintTarget?.sprintId).toBe(sprint.id);
    expect(entry.recurrence.count).toBe(4);
    expect(entry.nextRunAt).toBe("2026-05-18T09:00:00.000Z");

    const [listed] = schedulerRepository.listEntries(project.id);
    expect(listed.id).toBe(entry.id);
  });

  it("round-trips minute-based recurrence entries through persistence", async () => {
    const { dir, projectRepository, schedulerRepository } = await createRepositories();
    const project = projectRepository.createProject({
      name: "Scheduler Project",
      sourceType: "local",
      sourceRef: dir,
    });

    const entry = schedulerRepository.createEntry(project.id, {
      targetType: "chat",
      scheduledFor: "2026-05-18T09:00:00.000Z",
      recurrence: { frequency: "minutely", interval: 15, endMode: "after_count", count: 4 },
      chatTarget: { bodyMarkdown: "Check in" },
    });

    expect(entry.recurrence).toEqual({
      frequency: "minutely",
      interval: 15,
      endMode: "after_count",
      count: 4,
      until: null,
    });

    const stored = schedulerRepository.getEntry(entry.id);
    expect(stored?.recurrence).toEqual(entry.recurrence);
    expect(schedulerRepository.listEntries(project.id)[0]?.recurrence).toEqual(entry.recurrence);
    expect(schedulerRepository.listEntries(project.id)[0]?.chatTarget).toEqual({
      bodyMarkdown: "Check in",
      threadId: null,
      title: "Scheduled message",
      connectionId: null,
    });
  });

  it("persists and hydrates agent wakeup targets with agent scheduler metadata", async () => {
    const { dir, storage, projectRepository, schedulerRepository } = await createRepositories();
    const project = projectRepository.createProject({
      name: "Scheduler Project",
      sourceType: "local",
      sourceRef: dir,
    });

    const entry = schedulerRepository.createEntry(project.id, {
      targetType: "agent_wakeup",
      scheduledFor: "2026-05-18T09:00:00.000Z",
      agentWakeupTarget: {
        bodyMarkdown: "  Wake up and review the thread.  ",
        threadId: " thread-1 ",
        connectionId: " connection-1 ",
        title: "  Review wakeup  ",
        origin: "agent_scheduler",
        source: "agent_scheduler",
        createdByAgentId: " agent-1 ",
      },
    });

    expect(entry.agentWakeupTarget).toEqual({
      bodyMarkdown: "Wake up and review the thread.",
      threadId: "thread-1",
      connectionId: "connection-1",
      title: "Review wakeup",
      origin: "agent_scheduler",
      source: "agent_scheduler",
      createdByAgentId: "agent-1",
    });
    expect(entry.title).toBe("Review wakeup");

    const stored = schedulerRepository.getEntry(entry.id);
    expect(stored?.agentWakeupTarget).toEqual(entry.agentWakeupTarget);

    const row = storage.getDatabase().prepare(`
      SELECT target_json
      FROM scheduler_entries
      WHERE id = ?
    `).get(entry.id) as { target_json: string };
    expect(JSON.parse(row.target_json)).toEqual({
      agentWakeupTarget: entry.agentWakeupTarget,
    });

    const updated = schedulerRepository.updateEntry(entry.id, {
      agentWakeupTarget: {
        ...entry.agentWakeupTarget!,
        bodyMarkdown: "Updated wakeup",
        createdByAgentId: "agent-2",
      },
    });

    expect(updated.agentWakeupTarget).toEqual({
      ...entry.agentWakeupTarget,
      bodyMarkdown: "Updated wakeup",
      createdByAgentId: "agent-2",
    });
    expect(schedulerRepository.getEntry(entry.id)?.agentWakeupTarget).toEqual(updated.agentWakeupTarget);
  });

  it("persists and hydrates task targets with provider and agent scheduler metadata", async () => {
    const { dir, storage, projectRepository, schedulerRepository } = await createRepositories();
    const project = projectRepository.createProject({
      name: "Scheduler Project",
      sourceType: "local",
      sourceRef: dir,
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Retry sprint",
      goal: "Retry a task.",
    });
    const task = projectRepository.createTask(project.id, {
      sprintId: sprint.id,
      title: "Retry task",
    });

    const entry = schedulerRepository.createEntry(project.id, {
      targetType: "task",
      scheduledFor: "2026-05-18T09:00:00.000Z",
      taskTarget: {
        taskId: ` ${task.id} `,
        provider: "codex",
        origin: "agent_scheduler",
        source: "agent_scheduler",
        createdByAgentId: "agent-1",
      },
    });

    expect(entry.taskTarget).toEqual({
      taskId: task.id,
      provider: "codex",
      origin: "agent_scheduler",
      source: "agent_scheduler",
      createdByAgentId: "agent-1",
    });
    expect(entry.title).toBe("Scheduled task rerun");

    const updated = schedulerRepository.updateEntry(entry.id, {
      taskTarget: {
        ...entry.taskTarget!,
        provider: "claude-code",
      },
    });
    expect(updated.taskTarget).toEqual({
      ...entry.taskTarget,
      provider: "claude-code",
    });
    expect(schedulerRepository.getEntry(entry.id)?.taskTarget).toEqual(updated.taskTarget);

    const row = storage.getDatabase().prepare(`
      SELECT target_json
      FROM scheduler_entries
      WHERE id = ?
    `).get(entry.id) as { target_json: string };
    expect(JSON.parse(row.target_json)).toEqual({
      taskTarget: updated.taskTarget,
    });
  });

  it("persists after-sprint-end anchors in the target payload without a schema migration", async () => {
    const { dir, projectRepository, schedulerRepository } = await createRepositories();
    const project = projectRepository.createProject({
      name: "Scheduler Project",
      sourceType: "local",
      sourceRef: dir,
    });
    const sourceSprint = projectRepository.createSprint(project.id, {
      name: "Source sprint",
      goal: "Finish first.",
    });

    const entry = schedulerRepository.createEntry(project.id, {
      targetType: "chat",
      scheduleAnchor: {
        mode: "after_sprint_end",
        sourceSprintId: sourceSprint.id,
        offsetMinutes: 15,
      },
      chatTarget: { bodyMarkdown: "Start the follow-up." },
    });

    expect(entry.scheduleAnchor).toEqual({
      mode: "after_sprint_end",
      sourceSprintId: sourceSprint.id,
      offsetMinutes: 15,
    });
    expect(entry.nextRunAt).toBeNull();

    const stored = schedulerRepository.getEntry(entry.id);
    expect(stored?.scheduleAnchor).toEqual(entry.scheduleAnchor);
    expect(schedulerRepository.listScheduledAnchoredEntries()).toEqual([stored]);
  });

  it("rejects recurrence for after-sprint-end anchors", async () => {
    const { dir, projectRepository, schedulerRepository } = await createRepositories();
    const project = projectRepository.createProject({
      name: "Scheduler Project",
      sourceType: "local",
      sourceRef: dir,
    });
    const sourceSprint = projectRepository.createSprint(project.id, { name: "Source sprint" });

    expect(() => schedulerRepository.createEntry(project.id, {
      targetType: "chat",
      scheduleAnchor: {
        mode: "after_sprint_end",
        sourceSprintId: sourceSprint.id,
      },
      recurrence: { frequency: "daily", interval: 1 },
      chatTarget: { bodyMarkdown: "Start the follow-up." },
    })).toThrow(/do not support recurrence/);
  });

  it("marks successful runs and completes one-time entries", async () => {
    const { dir, projectRepository, schedulerRepository } = await createRepositories();
    const project = projectRepository.createProject({
      name: "Scheduler Project",
      sourceType: "local",
      sourceRef: dir,
    });

    const entry = schedulerRepository.createEntry(project.id, {
      targetType: "chat",
      scheduledFor: "2026-05-18T09:00:00.000Z",
      chatTarget: { bodyMarkdown: "Status please" },
    });

    const updated = schedulerRepository.markRunSucceeded(entry.id, entry.scheduledFor, null);

    expect(updated.status).toBe("completed");
    expect(updated.runCount).toBe(1);
    expect(updated.nextRunAt).toBeNull();
  });

  it("persists settings-managed memory remediation targets", async () => {
    const { dir, projectRepository, schedulerRepository } = await createRepositories();
    const project = projectRepository.createProject({
      name: "Scheduler Project",
      sourceType: "local",
      sourceRef: dir,
    });

    const entry = schedulerRepository.createEntry(project.id, {
      title: "Long-term memory remediation",
      targetType: "memory_remediation",
      scheduledFor: "2026-05-18T03:00:00.000Z",
      recurrence: { frequency: "weekly", interval: 1 },
      memoryRemediationTarget: { mode: "ai", source: "memory_settings" },
    });

    expect(entry.targetType).toBe("memory_remediation");
    expect(entry.memoryRemediationTarget).toEqual({ mode: "ai", source: "memory_settings" });
    expect(schedulerRepository.listEntries(project.id)[0]!.memoryRemediationTarget).toEqual({
      mode: "ai",
      source: "memory_settings",
    });
  });

  it("recomputes nextRunAt to the next future occurrence when resuming a paused minute entry", async () => {
    const { dir, projectRepository, schedulerRepository } = await createRepositories();
    const project = projectRepository.createProject({
      name: "Scheduler Project",
      sourceType: "local",
      sourceRef: dir,
    });

    const pastDate = "2026-06-11T10:00:00.000Z";
    const now = new Date("2026-06-11T10:06:30.000Z");
    const nextFutureDate = "2026-06-11T10:07:00.000Z";

    // Create a daily entry that started in the past
    const entry = schedulerRepository.createEntry(project.id, {
      targetType: "chat",
      scheduledFor: pastDate,
      recurrence: { frequency: "minutely", interval: 1 },
      chatTarget: { bodyMarkdown: "Daily Ping" },
    });

    // Pause it
    schedulerRepository.updateEntry(entry.id, { status: "paused" });

    // Mock Date.now to control "now" during resumption
    const originalDate = global.Date;
    global.Date = class extends originalDate {
      constructor(arg?: any) {
        if (arg === undefined) return new originalDate(now);
        return new originalDate(arg);
      }
    } as any;

    try {
      // Resume it
      const resumed = schedulerRepository.updateEntry(entry.id, { status: "scheduled" });

      expect(resumed.status).toBe("scheduled");
      // It should skip all past occurrences and pick the next one >= now
      expect(resumed.nextRunAt).toBe(nextFutureDate);

      // Ensure it's not in the due list for "now"
      const due = schedulerRepository.listDueEntries(now.toISOString());
      expect(due.find((e) => e.id === entry.id)).toBeUndefined();
    } finally {
      global.Date = originalDate;
    }
  });
});
