import type { SchedulerArgs, ManagementResponseEnvelope } from "../../contracts/internal-management-types.js";
import type { ProviderId } from "../../contracts/app-types.js";
import type {
  CreateSchedulerEntryInput,
  ScheduleAgentWakeupTarget,
  ScheduleTaskTarget,
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
const VALID_PROVIDER_IDS = new Set<ProviderId>([
  "jules",
  "gemini",
  "codex",
  "claude-code",
  "qwen-code",
  "opencode",
  "antigravity",
  "mockup-cli",
]);

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

function normalizeScheduledFor(payload: Record<string, unknown>, now = new Date()): string {
  const scheduledFor = parseOptionalString(payload, "scheduledFor");
  const delaySeconds = parsePositiveDelaySeconds(payload);
  if (scheduledFor && delaySeconds !== undefined) {
    throw managementValidationError("Provide scheduledFor or a relative delay, not both.", "scheduledFor");
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
  throw managementValidationError("scheduledFor, delaySeconds, or delayMinutes is required.", "scheduledFor");
}

function isOwnAgentSchedulerEntry(entry: SchedulerEntryRecord, agentId: string): boolean {
  if (entry.targetType === "agent_wakeup") {
    return entry.agentWakeupTarget?.origin === AGENT_SCHEDULER_SOURCE
      && entry.agentWakeupTarget.source === AGENT_SCHEDULER_SOURCE
      && entry.agentWakeupTarget.createdByAgentId === agentId;
  }
  if (entry.targetType === "task") {
    return entry.taskTarget?.origin === AGENT_SCHEDULER_SOURCE
      && entry.taskTarget.source === AGENT_SCHEDULER_SOURCE
      && entry.taskTarget.createdByAgentId === agentId;
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
  const title = parseOptionalString(payload, "title");
  const timezone = parseOptionalString(payload, "timezone");
  if (title) input.title = title;
  if (timezone) input.timezone = timezone;
  return input;
}

function readProvider(payload: Record<string, unknown>): ProviderId | undefined {
  const provider = parseOptionalString(payload, "provider");
  if (!provider) {
    return undefined;
  }
  if (!VALID_PROVIDER_IDS.has(provider as ProviderId)) {
    throw managementValidationError("Invalid value for provider.", "provider");
  }
  return provider as ProviderId;
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
      case "schedule_task": {
        const projectId = parseRequiredString(payload, "projectId");
        const taskTarget: ScheduleTaskTarget = {
          taskId: parseRequiredString(payload, "taskId"),
          origin: AGENT_SCHEDULER_SOURCE,
          source: AGENT_SCHEDULER_SOURCE,
          createdByAgentId: agentId,
        };
        const provider = readProvider(payload);
        if (provider) taskTarget.provider = provider;

        const entry = this.schedulerService.createEntry(projectId, {
          ...buildBaseInput(payload, this.getNow()),
          targetType: "task",
          taskTarget,
        });
        return { result: { entry } };
      }
      case "cancel": {
        const entryId = parseRequiredString(payload, "entryId");
        const entry = this.schedulerService.getEntry(entryId);
        if (!entry || !isOwnAgentSchedulerEntry(entry, agentId)) {
          throw managementValidationError("Only agent_scheduler entries created by the calling agent can be cancelled.", "entryId");
        }
        const updated = this.schedulerService.updateEntry(entryId, { status: "cancelled" });
        return { result: { status: "success", entry: updated } };
      }
      default:
        throw managementValidationError(`Unknown scheduler action: ${String(args.action)}`, "action");
    }
  }
}
