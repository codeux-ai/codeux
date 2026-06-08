import type { ManageCodeUxArgs, ManagementResponseEnvelope } from "../../contracts/internal-management-types.js";
import type {
  CreateSchedulerEntryInput,
  ScheduleChatTarget,
  ScheduleQuicksprintTarget,
  ScheduleRecurrenceRule,
  ScheduleSprintTarget,
  ScheduleStatus,
  ScheduleTargetType,
  UpdateSchedulerEntryInput,
} from "../../contracts/scheduler-types.js";
import type { SchedulerService } from "../../services/scheduler-service.js";

const VALID_TARGET_TYPES: ScheduleTargetType[] = ["sprint", "quicksprint", "chat"];
const VALID_STATUSES: ScheduleStatus[] = ["scheduled", "paused", "completed", "failed", "cancelled"];

function readString(payload: Record<string, unknown>, key: string): string | undefined {
  return typeof payload[key] === "string" ? payload[key].trim() : undefined;
}

function readRequiredString(payload: Record<string, unknown>, key: string): string {
  const value = readString(payload, key);
  if (!value) {
    throw new Error(`${key} is required`);
  }
  return value;
}

function readNullableString(payload: Record<string, unknown>, key: string): string | null | undefined {
  if (!(key in payload)) {
    return undefined;
  }
  if (payload[key] === null) {
    return null;
  }
  return readString(payload, key);
}

function readObject(payload: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const value = payload[key];
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function readTargetType(payload: Record<string, unknown>, action: string): ScheduleTargetType {
  if (action === "schedule_sprint") return "sprint";
  if (action === "schedule_quicksprint") return "quicksprint";
  if (action === "schedule_chat") return "chat";
  const targetType = payload.targetType;
  if (typeof targetType === "string" && VALID_TARGET_TYPES.includes(targetType as ScheduleTargetType)) {
    return targetType as ScheduleTargetType;
  }
  throw new Error("targetType is required and must be sprint, quicksprint, or chat");
}

function readStatus(value: unknown): ScheduleStatus | undefined {
  return typeof value === "string" && VALID_STATUSES.includes(value as ScheduleStatus)
    ? value as ScheduleStatus
    : undefined;
}

function parsePositiveInteger(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(1, Math.floor(value));
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) {
      return Math.max(1, Math.floor(parsed));
    }
  }
  return undefined;
}

function readPositiveInteger(payload: Record<string, unknown>, key: string, fallback: number): number {
  return parsePositiveInteger(payload[key]) ?? fallback;
}

function readSubmitMode(value: unknown): ScheduleQuicksprintTarget["submitMode"] {
  return value === "plan_only" || value === "plan_and_start" ? value : "plan_and_start";
}

function readRecurrence(payload: Record<string, unknown>): Partial<ScheduleRecurrenceRule> | undefined {
  return readObject(payload, "recurrence") as Partial<ScheduleRecurrenceRule> | undefined;
}

function normalizeSprintTarget(payload: Record<string, unknown>): ScheduleSprintTarget {
  const nested = readObject(payload, "sprintTarget");
  const sprintId = readString(nested ?? payload, "sprintId");
  if (!sprintId) {
    throw new Error("sprintId or sprintTarget.sprintId is required");
  }
  return { sprintId };
}

function normalizeQuicksprintTarget(payload: Record<string, unknown>): ScheduleQuicksprintTarget {
  const nested = readObject(payload, "quicksprintTarget");
  const source = nested ?? payload;
  const templateId = readString(source, "templateId");
  if (!templateId) {
    throw new Error("templateId or quicksprintTarget.templateId is required");
  }
  const target: ScheduleQuicksprintTarget = {
    templateId,
    taskCount: readPositiveInteger(source, "taskCount", 5),
    submitMode: readSubmitMode(source.submitMode),
  };
  const additionalPrompt = readString(source, "additionalPrompt");
  const agentPresetId = readString(source, "agentPresetId");
  if (additionalPrompt) target.additionalPrompt = additionalPrompt;
  if (agentPresetId) target.agentPresetId = agentPresetId;
  if (typeof source.planningOverrides === "object" && source.planningOverrides !== null) {
    target.planningOverrides = source.planningOverrides as ScheduleQuicksprintTarget["planningOverrides"];
  }
  return target;
}

function normalizeChatTarget(payload: Record<string, unknown>): ScheduleChatTarget {
  const nested = readObject(payload, "chatTarget");
  const source = nested ?? payload;
  const bodyMarkdown = readString(source, "bodyMarkdown");
  if (!bodyMarkdown) {
    throw new Error("bodyMarkdown or chatTarget.bodyMarkdown is required");
  }
  const target: ScheduleChatTarget = { bodyMarkdown };
  const title = readString(source, "title");
  const threadId = readNullableString(source, "threadId");
  const connectionId = readNullableString(source, "connectionId");
  if (title) target.title = title;
  if (threadId !== undefined) target.threadId = threadId;
  if (connectionId !== undefined) target.connectionId = connectionId;
  return target;
}

function assignTarget(input: CreateSchedulerEntryInput | UpdateSchedulerEntryInput, targetType: ScheduleTargetType, payload: Record<string, unknown>): void {
  if (targetType === "sprint") {
    input.sprintTarget = normalizeSprintTarget(payload);
  } else if (targetType === "quicksprint") {
    input.quicksprintTarget = normalizeQuicksprintTarget(payload);
  } else {
    input.chatTarget = normalizeChatTarget(payload);
  }
}

function normalizeCreateInput(payload: Record<string, unknown>, action: string): CreateSchedulerEntryInput {
  const targetType = readTargetType(payload, action);
  const input: CreateSchedulerEntryInput = {
    targetType,
    scheduledFor: readRequiredString(payload, "scheduledFor"),
  };
  const title = readString(payload, "title");
  const timezone = readString(payload, "timezone");
  const recurrence = readRecurrence(payload);
  if (title) input.title = title;
  if (timezone) input.timezone = timezone;
  if (recurrence) input.recurrence = recurrence;
  assignTarget(input, targetType, payload);
  return input;
}

function normalizeUpdateInput(payload: Record<string, unknown>): UpdateSchedulerEntryInput {
  const input: UpdateSchedulerEntryInput = {};
  const title = readString(payload, "title");
  const status = readStatus(payload.status);
  const scheduledFor = readString(payload, "scheduledFor");
  const timezone = readString(payload, "timezone");
  const recurrence = readRecurrence(payload);

  if ("title" in payload) input.title = title;
  if (status) input.status = status;
  if (scheduledFor) input.scheduledFor = scheduledFor;
  if (timezone) input.timezone = timezone;
  if (recurrence) input.recurrence = recurrence;

  if ("sprintTarget" in payload || "sprintId" in payload) {
    input.sprintTarget = normalizeSprintTarget(payload);
  }
  if ("quicksprintTarget" in payload || "templateId" in payload) {
    input.quicksprintTarget = normalizeQuicksprintTarget(payload);
  }
  if ("chatTarget" in payload || "bodyMarkdown" in payload || "threadId" in payload || "connectionId" in payload) {
    input.chatTarget = normalizeChatTarget(payload);
  }

  return input;
}

function defaultFrom(): string {
  const date = new Date();
  date.setDate(date.getDate() - 7);
  return date.toISOString();
}

function defaultTo(): string {
  const date = new Date();
  date.setDate(date.getDate() + 35);
  return date.toISOString();
}

export class SchedulerActions {
  constructor(private readonly schedulerService: SchedulerService) {}

  async handleSchedulerAction(args: ManageCodeUxArgs): Promise<ManagementResponseEnvelope> {
    const payload = args.payload || {};

    switch (args.action) {
      case "list": {
        const projectId = readRequiredString(payload, "projectId");
        const result = this.schedulerService.listProjectSchedule(
          projectId,
          readString(payload, "from") || defaultFrom(),
          readString(payload, "to") || defaultTo(),
        );
        return { result };
      }
      case "create":
      case "schedule_sprint":
      case "schedule_quicksprint":
      case "schedule_chat": {
        const projectId = readRequiredString(payload, "projectId");
        const entry = this.schedulerService.createEntry(projectId, normalizeCreateInput(payload, args.action));
        return { result: { entry } };
      }
      case "update": {
        const entryId = readRequiredString(payload, "entryId");
        const entry = this.schedulerService.updateEntry(entryId, normalizeUpdateInput(payload));
        return { result: { entry } };
      }
      case "delete": {
        const entryId = readRequiredString(payload, "entryId");
        if (args.approval?.confirmed !== true) {
          return {
            approvalRequired: true,
            approvalMessage: `Deleting scheduler entry '${entryId}' requires explicit human confirmation. Ask the user to confirm, then call this exact action again with approval.confirmed set to true.`,
          };
        }
        this.schedulerService.deleteEntry(entryId);
        return { result: { status: "success", deletedEntryId: entryId } };
      }
      case "run_due": {
        const nowString = readString(payload, "now");
        const now = nowString ? new Date(nowString) : undefined;
        if (now && !Number.isFinite(now.getTime())) {
          throw new Error("now must be a valid ISO date");
        }
        await this.schedulerService.runDueEntries(now);
        return { result: { status: "success", message: "Due scheduler entries were evaluated." } };
      }
      default:
        throw new Error(`Unknown scheduler action: ${args.action}`);
    }
  }
}
