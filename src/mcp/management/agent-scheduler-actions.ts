import type { SchedulerArgs, ManagementResponseEnvelope } from "../../contracts/internal-management-types.js";
import type {
  CreateSchedulerEntryInput,
  ScheduleAnchor,
  ScheduleAgentWakeupTarget,
  SchedulerCollectionResponse,
  SchedulerEntryRecord,
} from "../../contracts/scheduler-types.js";
import type { SchedulerService } from "../../services/scheduler-service.js";
import {
  managementValidationError,
  parseOptionalNullableString,
  parseOptionalString,
  parseRequiredString,
} from "./payload-parsers.js";

const DEFAULT_LIST_WINDOW_PAST_DAYS = 7;
const DEFAULT_LIST_WINDOW_FUTURE_DAYS = 35;
const AGENT_SCHEDULER_SOURCE = "agent_scheduler" as const;

function defaultFrom(): string {
  const date = new Date();
  date.setDate(date.getDate() - DEFAULT_LIST_WINDOW_PAST_DAYS);
  return date.toISOString();
}

function defaultTo(): string {
  const date = new Date();
  date.setDate(date.getDate() + DEFAULT_LIST_WINDOW_FUTURE_DAYS);
  return date.toISOString();
}

function parsePositiveDelaySeconds(payload: Record<string, unknown>): number | undefined {
  const hasDelaySeconds = payload.delaySeconds !== undefined && payload.delaySeconds !== null;
  const hasDelayMinutes = payload.delayMinutes !== undefined && payload.delayMinutes !== null;
  if (!hasDelaySeconds && !hasDelayMinutes) {
    return undefined;
  }
  if (hasDelaySeconds && hasDelayMinutes) {
    throw managementValidationError("Provide only one of delaySeconds or delayMinutes.", "delaySeconds");
  }

  const key = hasDelaySeconds ? "delaySeconds" : "delayMinutes";
  const raw = payload[key];
  const value = typeof raw === "number"
    ? raw
    : typeof raw === "string" && raw.trim()
      ? Number(raw.trim())
      : Number.NaN;
  if (!Number.isFinite(value) || value <= 0) {
    throw managementValidationError(`${key} must be a positive number.`, key);
  }
  return Math.ceil(value * (key === "delayMinutes" ? 60 : 1));
}

function parseBoolean(payload: Record<string, unknown>, key: string): boolean {
  const raw = payload[key];
  return raw === true || (typeof raw === "string" && raw.trim().toLowerCase() === "true");
}

function parseNonNegativeInteger(payload: Record<string, unknown>, key: string): number | undefined {
  const raw = payload[key];
  if (raw === undefined || raw === null || raw === "") {
    return undefined;
  }
  const value = typeof raw === "number"
    ? raw
    : typeof raw === "string" && raw.trim()
      ? Number(raw.trim())
      : Number.NaN;
  if (!Number.isFinite(value) || value < 0) {
    throw managementValidationError(`${key} must be a non-negative number.`, key);
  }
  return Math.floor(value);
}

function buildScheduleAnchor(payload: Record<string, unknown>): ScheduleAnchor | undefined {
  const afterSprintId = parseOptionalString(payload, "afterSprintId");
  const afterTaskId = parseOptionalString(payload, "afterTaskId");
  if (afterSprintId && afterTaskId) {
    throw managementValidationError("Provide only one of afterSprintId or afterTaskId.", "afterSprintId");
  }
  const offsetMinutes = parseNonNegativeInteger(payload, "offsetMinutes");
  if (offsetMinutes !== undefined && !afterSprintId && !afterTaskId) {
    throw managementValidationError("offsetMinutes requires afterSprintId or afterTaskId.", "offsetMinutes");
  }
  if (afterSprintId) {
    return { mode: "after_sprint_end", sourceSprintId: afterSprintId, offsetMinutes };
  }
  if (afterTaskId) {
    return { mode: "after_task_end", sourceTaskId: afterTaskId, offsetMinutes };
  }
  return undefined;
}

function normalizeScheduledFor(payload: Record<string, unknown>, now = new Date()): string {
  const scheduledFor = parseOptionalString(payload, "scheduledFor");
  const delaySeconds = parsePositiveDelaySeconds(payload);
  const wakeAfterReply = parseBoolean(payload, "wakeAfterReply");
  const scheduleAnchor = buildScheduleAnchor(payload);
  const timingModes = [
    scheduledFor ? "scheduledFor" : null,
    delaySeconds !== undefined ? "relative delay" : null,
    wakeAfterReply ? "wakeAfterReply" : null,
    scheduleAnchor ? "finish anchor" : null,
  ].filter(Boolean);
  if (timingModes.length > 1) {
    throw managementValidationError("Provide exactly one wakeup timing mode: scheduledFor, delaySeconds/delayMinutes, wakeAfterReply, afterSprintId, or afterTaskId.", "scheduledFor");
  }
  if (scheduledFor) {
    const parsed = new Date(scheduledFor);
    if (!Number.isFinite(parsed.getTime())) {
      throw managementValidationError("scheduledFor must be a valid ISO date.", "scheduledFor");
    }
    return parsed.toISOString();
  }
  if (delaySeconds !== undefined) {
    return new Date(now.getTime() + delaySeconds * 1000).toISOString();
  }
  if (wakeAfterReply || scheduleAnchor) {
    return now.toISOString();
  }
  throw managementValidationError("scheduledFor, delaySeconds, delayMinutes, wakeAfterReply, afterSprintId, or afterTaskId is required.", "scheduledFor");
}

function isOwnAgentSchedulerEntry(entry: SchedulerEntryRecord, agentId: string): boolean {
  if (entry.targetType === "agent_wakeup") {
    return entry.agentWakeupTarget?.origin === AGENT_SCHEDULER_SOURCE
      && entry.agentWakeupTarget.source === AGENT_SCHEDULER_SOURCE
      && entry.agentWakeupTarget.createdByAgentId === agentId;
  }
  return false;
}

function filterOwnSchedule(result: SchedulerCollectionResponse, agentId: string): SchedulerCollectionResponse {
  const entries = result.entries.filter((entry) => isOwnAgentSchedulerEntry(entry, agentId));
  const entryIds = new Set(entries.map((entry) => entry.id));
  return {
    ...result,
    entries,
    occurrences: result.occurrences.filter((occurrence) => entryIds.has(occurrence.entryId)),
  };
}

function buildBaseInput(payload: Record<string, unknown>, now?: Date): Omit<CreateSchedulerEntryInput, "targetType"> {
  const input: Omit<CreateSchedulerEntryInput, "targetType"> = {
    scheduledFor: normalizeScheduledFor(payload, now),
  };
  const scheduleAnchor = buildScheduleAnchor(payload);
  const title = parseOptionalString(payload, "title");
  const timezone = parseOptionalString(payload, "timezone");
  if (scheduleAnchor) input.scheduleAnchor = scheduleAnchor;
  if (title) input.title = title;
  if (timezone) input.timezone = timezone;
  return input;
}

export class AgentSchedulerActions {
  constructor(
    private readonly schedulerService: SchedulerService,
    private readonly getNow: () => Date = () => new Date(),
  ) {}

  handleSchedulerAction(args: SchedulerArgs, agentId: string | null): ManagementResponseEnvelope {
    if (!agentId) {
      throw managementValidationError("scheduler requires an authenticated MCP agent.", "agentId");
    }
    const payload = args as unknown as Record<string, unknown>;

    switch (args.action) {
      case "list": {
        const projectId = parseRequiredString(payload, "projectId");
        const result = this.schedulerService.listProjectSchedule(
          projectId,
          parseOptionalString(payload, "from") || defaultFrom(),
          parseOptionalString(payload, "to") || defaultTo(),
        );
        return { result: filterOwnSchedule(result, agentId) };
      }
      case "schedule_wakeup": {
        const projectId = parseRequiredString(payload, "projectId");
        const title = parseOptionalString(payload, "title");
        const agentWakeupTarget: ScheduleAgentWakeupTarget = {
          bodyMarkdown: parseRequiredString(payload, "bodyMarkdown"),
          origin: AGENT_SCHEDULER_SOURCE,
          source: AGENT_SCHEDULER_SOURCE,
          createdByAgentId: agentId,
        };
        const threadId = parseOptionalNullableString(payload, "threadId");
        const connectionId = parseOptionalNullableString(payload, "connectionId");
        if (title) agentWakeupTarget.title = title;
        if (threadId !== undefined) agentWakeupTarget.threadId = threadId;
        if (connectionId !== undefined) agentWakeupTarget.connectionId = connectionId;

        const entry = this.schedulerService.createEntry(projectId, {
          ...buildBaseInput(payload, this.getNow()),
          targetType: "agent_wakeup",
          agentWakeupTarget,
        });
        return { result: { entry } };
      }
      case "cancel": {
        const entryId = parseRequiredString(payload, "entryId");
        const entry = this.schedulerService.getEntry(entryId);
        if (!entry || !isOwnAgentSchedulerEntry(entry, agentId)) {
          throw managementValidationError("Only agent_scheduler wakeup entries created by the calling agent can be cancelled.", "entryId");
        }
        const updated = this.schedulerService.updateEntry(entryId, { status: "cancelled" });
        return { result: { status: "success", entry: updated } };
      }
      default:
        throw managementValidationError(`Unknown scheduler action: ${String(args.action)}`, "action");
    }
  }
}
