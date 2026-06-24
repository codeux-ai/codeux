import type { QuicksprintExecutionInput } from "./quicksprint-types.js";
import type { GoalSprintPlanInput } from "./project-management-types.js";

export type ScheduleTargetType = "sprint" | "quicksprint" | "goal_sprint" | "chat";
export type ScheduleStatus = "scheduled" | "paused" | "completed" | "failed" | "cancelled";
export type ScheduleRecurrenceFrequency = "none" | "hourly" | "daily" | "weekly" | "monthly";
export type ScheduleRecurrenceEndMode = "never" | "after_count" | "on_date";

export interface ScheduleRecurrenceRule {
  frequency: ScheduleRecurrenceFrequency;
  interval: number;
  endMode: ScheduleRecurrenceEndMode;
  count?: number | null;
  until?: string | null;
}

export interface ScheduleSprintTarget {
  sprintId: string;
}

export interface ScheduleQuicksprintTarget {
  templateId: string;
  taskCount: number;
  submitMode: QuicksprintExecutionInput["submitMode"];
  additionalPrompt?: string;
  agentPresetId?: string;
  planningOverrides?: QuicksprintExecutionInput["planningOverrides"];
}

export interface ScheduleGoalSprintTarget {
  goalIds: string[];
  minTasks: number;
  maxTasks: number;
  minSprints: number;
  maxSprints: number;
  submitMode: GoalSprintPlanInput["submitMode"];
  autoTriggerNext?: boolean;
  planningOverrides?: GoalSprintPlanInput["overrides"];
}

export interface ScheduleChatTarget {
  bodyMarkdown: string;
  threadId?: string | null;
  title?: string;
  connectionId?: string | null;
}

export interface SchedulerEntryRecord {
  id: string;
  projectId: string;
  title: string;
  targetType: ScheduleTargetType;
  status: ScheduleStatus;
  scheduledFor: string;
  timezone: string;
  recurrence: ScheduleRecurrenceRule;
  nextRunAt: string | null;
  lastRunAt: string | null;
  runCount: number;
  lastError: string | null;
  sprintTarget?: ScheduleSprintTarget;
  quicksprintTarget?: ScheduleQuicksprintTarget;
  goalSprintTarget?: ScheduleGoalSprintTarget;
  chatTarget?: ScheduleChatTarget;
  createdAt: string;
  updatedAt: string;
}

export interface SchedulerOccurrence {
  id: string;
  entryId: string;
  projectId: string;
  title: string;
  targetType: ScheduleTargetType;
  status: ScheduleStatus;
  startsAt: string;
  occurrenceIndex: number;
  isNextRun: boolean;
  isCompletedRun: boolean;
}

export interface SchedulerCollectionResponse {
  entries: SchedulerEntryRecord[];
  occurrences: SchedulerOccurrence[];
  from: string;
  to: string;
}

export interface CreateSchedulerEntryInput {
  title?: string;
  targetType: ScheduleTargetType;
  scheduledFor: string;
  timezone?: string;
  recurrence?: Partial<ScheduleRecurrenceRule>;
  sprintTarget?: ScheduleSprintTarget;
  quicksprintTarget?: ScheduleQuicksprintTarget;
  goalSprintTarget?: ScheduleGoalSprintTarget;
  chatTarget?: ScheduleChatTarget;
}

export interface UpdateSchedulerEntryInput {
  title?: string;
  status?: ScheduleStatus;
  targetType?: ScheduleTargetType;
  scheduledFor?: string;
  timezone?: string;
  recurrence?: Partial<ScheduleRecurrenceRule>;
  sprintTarget?: ScheduleSprintTarget;
  quicksprintTarget?: ScheduleQuicksprintTarget;
  goalSprintTarget?: ScheduleGoalSprintTarget;
  chatTarget?: ScheduleChatTarget;
}
