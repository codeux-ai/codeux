import type { QuicksprintExecutionInput } from "./quicksprint-types.js";
import type { ProviderId } from "./app-types.js";

export type ScheduleTargetType = "sprint" | "quicksprint" | "chat" | "wakeup" | "memory_remediation" | "agent_wakeup" | "task";
export type ScheduleStatus = "scheduled" | "paused" | "completed" | "failed" | "cancelled";
export type ScheduleRecurrenceFrequency = "none" | "minutely" | "hourly" | "daily" | "weekly" | "monthly";
export type ScheduleRecurrenceEndMode = "never" | "after_count" | "on_date";
export type ScheduleAnchorMode = "after_sprint_end";
export type ScheduleAgentSchedulerSource = "agent_scheduler";

export interface ScheduleRecurrenceRule {
  frequency: ScheduleRecurrenceFrequency;
  interval: number;
  endMode: ScheduleRecurrenceEndMode;
  count?: number | null;
  until?: string | null;
}

export interface ScheduleAfterSprintEndAnchor {
  mode: "after_sprint_end";
  sourceSprintId: string;
  offsetMinutes?: number;
}

export type ScheduleAnchor = ScheduleAfterSprintEndAnchor;

export interface ScheduleSprintTarget {
  sprintId: string;
}

export interface ScheduleQuicksprintTarget {
  templateId: string;
  taskCount: number;
  noTaskLimit?: boolean;
  submitMode: QuicksprintExecutionInput["submitMode"];
  additionalPrompt?: string;
  agentPresetId?: string;
  planningOverrides?: QuicksprintExecutionInput["planningOverrides"];
}

export interface ScheduleChatTarget {
  bodyMarkdown: string;
  threadId?: string | null;
  title?: string;
  connectionId?: string | null;
}

export interface ScheduleWakeupTarget {
  bodyMarkdown: string;
  threadId?: string | null;
  title?: string;
  connectionId?: string | null;
  sourceInvocationId?: string | null;
  resumeAfterInvocationCompletion?: boolean;
}

export interface ScheduleAgentSchedulerMetadata {
  origin: ScheduleAgentSchedulerSource;
  source: ScheduleAgentSchedulerSource;
  createdByAgentId?: string | null;
}

export interface ScheduleAgentWakeupTarget extends ScheduleAgentSchedulerMetadata {
  bodyMarkdown: string;
  threadId?: string | null;
  title?: string;
  connectionId?: string | null;
}

export interface ScheduleTaskTarget extends ScheduleAgentSchedulerMetadata {
  taskId: string;
  provider?: ProviderId;
}

export interface ScheduleMemoryRemediationTarget {
  mode: "deterministic" | "ai";
  source?: "scheduler" | "memory_settings";
}

export interface SchedulerEntryRecord {
  id: string;
  projectId: string;
  title: string;
  targetType: ScheduleTargetType;
  status: ScheduleStatus;
  scheduledFor: string;
  scheduleAnchor?: ScheduleAnchor;
  timezone: string;
  recurrence: ScheduleRecurrenceRule;
  nextRunAt: string | null;
  lastRunAt: string | null;
  runCount: number;
  lastError: string | null;
  sprintTarget?: ScheduleSprintTarget;
  quicksprintTarget?: ScheduleQuicksprintTarget;
  chatTarget?: ScheduleChatTarget;
  wakeupTarget?: ScheduleWakeupTarget;
  agentWakeupTarget?: ScheduleAgentWakeupTarget;
  taskTarget?: ScheduleTaskTarget;
  memoryRemediationTarget?: ScheduleMemoryRemediationTarget;
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
  scheduledFor?: string;
  scheduleAnchor?: ScheduleAnchor;
  timezone?: string;
  recurrence?: Partial<ScheduleRecurrenceRule>;
  sprintTarget?: ScheduleSprintTarget;
  quicksprintTarget?: ScheduleQuicksprintTarget;
  chatTarget?: ScheduleChatTarget;
  wakeupTarget?: ScheduleWakeupTarget;
  agentWakeupTarget?: ScheduleAgentWakeupTarget;
  taskTarget?: ScheduleTaskTarget;
  memoryRemediationTarget?: ScheduleMemoryRemediationTarget;
}

export interface UpdateSchedulerEntryInput {
  title?: string;
  status?: ScheduleStatus;
  targetType?: ScheduleTargetType;
  scheduledFor?: string;
  scheduleAnchor?: ScheduleAnchor | null;
  timezone?: string;
  recurrence?: Partial<ScheduleRecurrenceRule>;
  sprintTarget?: ScheduleSprintTarget;
  quicksprintTarget?: ScheduleQuicksprintTarget;
  chatTarget?: ScheduleChatTarget;
  wakeupTarget?: ScheduleWakeupTarget;
  agentWakeupTarget?: ScheduleAgentWakeupTarget;
  taskTarget?: ScheduleTaskTarget;
  memoryRemediationTarget?: ScheduleMemoryRemediationTarget;
}

export type MemoryRemediationScheduleCadence = "off" | "daily" | "weekly";

export interface MemoryRemediationScheduleSettings {
  cadence: MemoryRemediationScheduleCadence;
  mode: "deterministic" | "ai";
  scheduledFor?: string;
  timezone?: string;
}

export interface MemoryRemediationScheduleResponse {
  entry: SchedulerEntryRecord | null;
  cadence: MemoryRemediationScheduleCadence;
  mode: "deterministic" | "ai";
}
