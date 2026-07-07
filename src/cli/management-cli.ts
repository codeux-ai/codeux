import type { ReadStream, WriteStream } from "node:tty";
import { inspect } from "node:util";
import type { AppConfig } from "../config/app-config.js";
import { createRuntimeDependencies, type ServerContext } from "../app/dependency-factory.js";
import { DefaultRuntimeContext } from "../app/runtime-context.js";
import type { ManagementApproval, ManageCodeUxArgs, ManagementResponseEnvelope, ManageProjectsArgs, ManageSprintsArgs, ManageTasksArgs, ManageQuicksprintsArgs, ManageSchedulerArgs, ManageAgentsArgs, ManageMemoryArgs, ManageSettingsArgs, ManagePreviewArgs, ManageTelemetryArgs, SearchKnowledgeArgs } from "../contracts/internal-management-types.js";
import type { GitTrackingStatus, JulesActivity, JulesSession, Subtask, DashboardSettings, GetCiStatusForScopeArgs, AutoMergeFeaturePrArgs, AutoMergeFeaturePrResult, PersistTaskMergedFlagArgs } from "../contracts/app-types.js";
import type { ResolvePullRequestResult } from "../services/git-status-service.js";
import type { ParsedCliInvocation, ParsedManagementCommand, ManagementDomain } from "./cli-args.js";
import { buildDomainHelpText, buildGenericManageHelpText, buildHelpText, getManagementActionSpec } from "./cli-args.js";
import { promptForValues } from "./interactive-prompts.js";

export interface ManagementCliIO {
  stdin: NodeJS.ReadStream & { isTTY?: boolean };
  stdout: NodeJS.WriteStream;
  stderr: NodeJS.WriteStream;
}

interface ManagementCliOptions {
  invocation: ParsedCliInvocation;
  projectRoot: string;
  appConfig: AppConfig;
  io?: Partial<ManagementCliIO>;
  createDependencies?: typeof createRuntimeDependencies;
}

interface DomainActionRequest {
  domain: Exclude<ManagementDomain, "manage">;
  action: string;
  payload: Record<string, unknown>;
  approval?: ManagementApproval;
  jsonOutput: boolean;
}

const FLAG_DISPLAY_NAMES: Record<string, string> = {
  projectId: "--project",
  sprintId: "--sprint",
  sprintRunId: "--sprint-run",
  taskId: "--task",
  templateId: "--template",
  entryId: "--entry",
  presetId: "--preset",
  memoryId: "--memory",
  invocationId: "--invocation",
  name: "--name",
  title: "--title",
  goal: "--goal",
  goalMarkdown: "--goal",
  promptMarkdown: "--prompt",
  description: "--description",
  query: "--query",
  limit: "--limit",
  taskCount: "--tasks",
  autoStart: "--auto-start",
  replan: "--replan",
  scheduledFor: "--at",
  bodyMarkdown: "--body-markdown",
  path: "--path",
  value: "--value",
  settings: "--settings-json",
  settingsJson: "--settings-json",
  bundle: "--bundle-json",
  bundleJson: "--bundle-json",
  payloadJson: "--payload-json",
  scope: "--scope",
  content: "--content",
  memoryIds: "--memory-ids",
  project: "--project",
  sprint: "--sprint",
  template: "--template",
  task: "--task",
  memory: "--memory",
  preset: "--preset",
  entry: "--entry",
  sessionId: "--session",
  jsonOutput: "--json",
};

const FIELD_PROMPTS: Record<string, { label: string; defaultValue?: string }> = {
  projectId: { label: "Project ID" },
  sprintId: { label: "Sprint ID" },
  sprintRunId: { label: "Sprint run ID" },
  taskId: { label: "Task ID" },
  templateId: { label: "Template ID" },
  entryId: { label: "Entry ID" },
  presetId: { label: "Preset ID" },
  memoryId: { label: "Memory ID" },
  invocationId: { label: "Invocation ID" },
  name: { label: "Name" },
  title: { label: "Title" },
  goal: { label: "Goal" },
  query: { label: "Search query" },
  scheduledFor: { label: "Scheduled for (ISO)" },
  bodyMarkdown: { label: "Body markdown" },
  path: { label: "Path" },
  value: { label: "Value" },
  settingsJson: { label: "Settings JSON" },
  bundleJson: { label: "Settings bundle JSON" },
  payloadJson: { label: "Payload JSON" },
  scope: { label: "Scope" },
  content: { label: "Content" },
  memoryIds: { label: "Memory IDs (JSON array)" },
  description: { label: "Description" },
  limit: { label: "Limit" },
  taskCount: { label: "Task count" },
  autoStart: { label: "Auto start", defaultValue: "false" },
  replan: { label: "Replan", defaultValue: "false" },
};

function getIo(io?: Partial<ManagementCliIO>): ManagementCliIO {
  return {
    stdin: io?.stdin ?? process.stdin,
    stdout: io?.stdout ?? process.stdout,
    stderr: io?.stderr ?? process.stderr,
  };
}

function createCliServerContext(projectRoot: string, appConfig: AppConfig, runtimeContext: DefaultRuntimeContext): ServerContext {
  return {
    runtimeContext,
    getProjectRoot: () => projectRoot,
    getAppConfig: () => appConfig,
    getEffectiveJulesApiKey: () => appConfig.apiKey ?? process.env.JULES_API_KEY?.trim() ?? process.env.JULES_KEY?.trim() ?? undefined,
    getEffectiveGithubToken: () => process.env.GITHUB_TOKEN?.trim() || process.env.GH_TOKEN?.trim() || undefined,
    getDashboardPort: () => appConfig.dashboardPort,
    isJulesApiConfigured: () => Boolean(appConfig.apiKey || process.env.JULES_API_KEY || process.env.JULES_KEY),
    getMissingJulesApiKeyInstruction: () => "Set JULES_API_KEY in your environment or dashboard settings.",
    isActionRequiredState: () => false,
    resolveSessionName: () => undefined,
    extractSessionId: () => undefined,
    fetchRecentActivities: async () => [],
    listSessionsForSync: async () => ({}),
    getCiStatusForScope: async (_args: GetCiStatusForScopeArgs) => null,
    autoMergeFeaturePr: async (_args: AutoMergeFeaturePrArgs) => ({ ok: false } as AutoMergeFeaturePrResult),
    resolveOrCreateMainBranchPr: async () => ({ created: false, prNumber: null, prUrl: null } as ResolvePullRequestResult),
    resolveSessionNameFromTask: () => undefined,
    resolveGitStatusRepoPath: () => projectRoot,
    fetchGitStatusForRepo: async () => ({ } as GitTrackingStatus),
    invalidateGitStatusCache: () => undefined,
    persistTaskMergedFlag: async (_args: PersistTaskMergedFlagArgs) => undefined,
    normalizeName: (type: string, id: string) => `${type}-${id}`,
    isTrackedCliSession: () => false,
    getMcpConnectionInfo: () => null,
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonObject(text: string | null | undefined): Record<string, unknown> | null {
  if (!text) {
    return null;
  }

  try {
    const parsed = JSON.parse(text);
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function displayFlagForField(field: string): string {
  return FLAG_DISPLAY_NAMES[field] ?? `--${field.replace(/([A-Z])/g, "-$1").toLowerCase()}`;
}

function payloadKeyFromDisplayFlag(flag: string): string {
  const normalized = flag.replace(/^--/, "");
  switch (normalized) {
    case "project":
      return "projectId";
    case "sprint":
      return "sprintId";
    case "sprint-run":
      return "sprintRunId";
    case "task":
      return "taskId";
    case "template":
      return "templateId";
    case "entry":
      return "entryId";
    case "preset":
      return "presetId";
    case "memory":
      return "memoryId";
    case "invocation":
      return "invocationId";
    case "at":
      return "scheduledFor";
    case "body-markdown":
      return "bodyMarkdown";
    case "goal":
      return "goal";
    case "prompt":
      return "promptMarkdown";
    case "settings-json":
      return "settingsJson";
    case "payload-json":
      return "payloadJson";
    case "memory-ids":
      return "memoryIds";
    default:
      return normalized.replace(/-([a-z0-9])/g, (_match, letter: string) => letter.toUpperCase());
  }
}

function normalizeActionName(action: string): string {
  return action.trim().toLowerCase().replace(/-/g, "_");
}

function getRequiredFlags(domain: Exclude<ManagementDomain, "manage">, action: string): string[] {
  return getManagementActionSpec(domain, action)?.requiredFlags ?? [];
}

function getMissingFlags(payload: Record<string, unknown>, requiredFlags: string[]): string[] {
  const missing: string[] = [];
  for (const flag of requiredFlags) {
    const key = payloadKeyFromDisplayFlag(flag);
    const value = payload[key];
    if (flag === "--bundle-json" && isPlainObject(payload.bundle)) {
      continue;
    }
    if (value === undefined || value === null || value === "") {
      missing.push(flag);
    }
  }
  return missing;
}

function buildPromptQueue(missingFlags: string[]): Array<{ key: string; label: string; defaultValue?: string }> {
  return missingFlags.map((flag) => {
    const key = payloadKeyFromDisplayFlag(flag);
    const prompt = FIELD_PROMPTS[key] ?? { label: flag };
    return { key, label: prompt.label, defaultValue: prompt.defaultValue };
  });
}

function mergePayload(basePayload: Record<string, unknown>, flagPayload: Record<string, unknown>): Record<string, unknown> {
  const payload = { ...basePayload };
  for (const [key, value] of Object.entries(flagPayload)) {
    if (key === "domain" || key === "action") {
      continue;
    }
    if (value !== undefined) {
      payload[key] = value;
    }
  }
  return payload;
}

function normalizePayloadJson(invocation: ParsedManagementCommand): {
  domain: Exclude<ManagementDomain, "manage"> | null;
  action: string | null;
  payload: Record<string, unknown>;
  approval: ManagementApproval | undefined;
} {
  const jsonObject = parseJsonObject(invocation.payloadJson);
  const basePayload = isPlainObject(jsonObject?.payload) ? { ...jsonObject.payload } : {};
  const rawPayload = jsonObject && !("domain" in jsonObject) && !("action" in jsonObject) && !("payload" in jsonObject) ? jsonObject : basePayload;
  const mergedPayload = mergePayload(rawPayload, invocation.payloadFlags);
  const settingsJson = mergedPayload.settingsJson;
  if (typeof settingsJson === "string") {
    try {
      const parsedSettings = JSON.parse(settingsJson);
      if (isPlainObject(parsedSettings)) {
        mergedPayload.settings = parsedSettings;
      }
    } catch {
      // Leave the raw string for the handler to reject with a clear error if needed.
    }
  }
  const bundleJson = mergedPayload.bundleJson;
  if (typeof bundleJson === "string") {
    try {
      const parsedBundle = JSON.parse(bundleJson);
      if (isPlainObject(parsedBundle)) {
        mergedPayload.bundle = parsedBundle;
      }
    } catch {
      // Leave the raw string for the handler to reject with a clear error if needed.
    }
  }
  const approval = isPlainObject(jsonObject?.approval) && typeof jsonObject.approval.confirmed === "boolean"
    ? { confirmed: jsonObject.approval.confirmed }
    : undefined;

  const flagDomain = typeof invocation.payloadFlags.domain === "string" && invocation.payloadFlags.domain.trim().length > 0
    ? invocation.payloadFlags.domain.trim().toLowerCase()
    : null;
  const flagAction = typeof invocation.payloadFlags.action === "string" && invocation.payloadFlags.action.trim().length > 0
    ? normalizeActionName(invocation.payloadFlags.action)
    : null;
  const jsonDomain = typeof jsonObject?.domain === "string" && jsonObject.domain.trim().length > 0
    ? jsonObject.domain.trim().toLowerCase()
    : null;
  const jsonAction = typeof jsonObject?.action === "string" && jsonObject.action.trim().length > 0
    ? normalizeActionName(jsonObject.action)
    : null;

  const invocationDomain = invocation.command === "manage" ? null : invocation.domain;
  const resolvedDomain = invocationDomain
    ? invocationDomain
    : (flagDomain && flagDomain !== "manage"
      ? flagDomain as Exclude<ManagementDomain, "manage">
      : (jsonDomain && jsonDomain !== "manage" ? jsonDomain as Exclude<ManagementDomain, "manage"> : null));

  const resolvedAction = invocation.action ?? flagAction ?? jsonAction;

  return {
    domain: resolvedDomain,
    action: resolvedAction,
    payload: mergedPayload,
    approval,
  };
}

function formatEntitySummary(label: string, entity: unknown): string {
  if (!isPlainObject(entity)) {
    return `${label}: ${inspect(entity, { depth: 2, colors: false })}`;
  }

  const parts: string[] = [];
  const id = typeof entity.id === "string" ? entity.id : typeof entity.slug === "string" ? entity.slug : undefined;
  const name = typeof entity.name === "string" ? entity.name : typeof entity.title === "string" ? entity.title : undefined;
  if (id) {
    parts.push(id);
  }
  if (name && name !== id) {
    parts.push(name);
  }
  if (typeof entity.status === "string") {
    parts.push(entity.status);
  }
  if (parts.length === 0) {
    return `${label}: ${inspect(entity, { depth: 2, colors: false })}`;
  }
  return `${label}: ${parts.join(" | ")}`;
}

function formatListSummary(label: string, items: unknown[]): string {
  if (items.length === 0) {
    return `No ${label.toLowerCase()} found.`;
  }

  const entries = items.slice(0, 5).map((item) => {
    if (isPlainObject(item)) {
      const id = typeof item.id === "string" ? item.id : undefined;
      const name = typeof item.name === "string" ? item.name : typeof item.title === "string" ? item.title : undefined;
      return name && id ? `${name} (${id})` : name || id || inspect(item, { depth: 1, colors: false });
    }
    return inspect(item, { depth: 1, colors: false });
  });

  const suffix = items.length > entries.length ? ` and ${items.length - entries.length} more` : "";
  return `${label} (${items.length}): ${entries.join(", ")}${suffix}`;
}

function formatReadableEnvelope(envelope: ManagementResponseEnvelope, domain?: string, action?: string): string {
  if (envelope.approvalRequired) {
    return `Approval required${envelope.approvalMessage ? `: ${envelope.approvalMessage}` : "."}`;
  }

  if (!("result" in envelope) || envelope.result === undefined) {
    return "No result returned.";
  }

  const result = envelope.result;
  if (!isPlainObject(result)) {
    return typeof result === "string" ? result : inspect(result, { depth: 6, colors: false });
  }

  if (typeof result.message === "string" && !("data" in result) && !("projects" in result) && !("sprints" in result) && !("tasks" in result)) {
    return result.message;
  }

  if (typeof result.url === "string") {
    return result.url;
  }

  if (typeof result.deletedProjectId === "string") {
    return `Deleted project ${result.deletedProjectId}.`;
  }
  if (typeof result.deletedSprintId === "string") {
    return `Deleted sprint ${result.deletedSprintId}.`;
  }
  if (typeof result.deletedTaskId === "string") {
    return `Deleted task ${result.deletedTaskId}.`;
  }
  if (typeof result.deletedTemplateId === "string") {
    return `Deleted template ${result.deletedTemplateId}.`;
  }
  if (typeof result.deletedEntryId === "string") {
    return `Deleted scheduler entry ${result.deletedEntryId}.`;
  }

  if (typeof result.selectedProjectId === "string") {
    return `Selected project: ${result.selectedProjectId}`;
  }

  if (isPlainObject(result.project)) {
    return formatEntitySummary("Project", result.project);
  }
  if (isPlainObject(result.sprint)) {
    return formatEntitySummary("Sprint", result.sprint);
  }
  if (isPlainObject(result.task)) {
    return formatEntitySummary("Task", result.task);
  }
  if (isPlainObject(result.template)) {
    return formatEntitySummary("Template", result.template);
  }
  if (isPlainObject(result.entry)) {
    return formatEntitySummary("Entry", result.entry);
  }
  if (isPlainObject(result.agent)) {
    return formatEntitySummary("Agent", result.agent);
  }
  if (isPlainObject(result.memory)) {
    return formatEntitySummary("Memory", result.memory);
  }

  const listKeys: Array<[string, string]> = [
    ["projects", "Projects"],
    ["sprints", "Sprints"],
    ["tasks", "Tasks"],
    ["templates", "Templates"],
    ["agents", "Agents"],
    ["memories", "Memories"],
    ["entries", "Entries"],
    ["sessions", "Sessions"],
    ["runs", "Runs"],
    ["dispatches", "Dispatches"],
    ["messages", "Messages"],
    ["results", "Results"],
    ["occurrences", "Occurrences"],
  ];

  for (const [key, label] of listKeys) {
    const value = result[key];
    if (Array.isArray(value)) {
      return formatListSummary(label, value);
    }
  }

  if (typeof result.count === "number") {
    return `Count: ${result.count}${typeof result.staleCount === "number" ? ` (stale embeddings: ${result.staleCount})` : ""}`;
  }

  if (Array.isArray(result.data)) {
    return formatListSummary("Items", result.data);
  }

  if (isPlainObject(result.data)) {
    return inspect(result.data, { depth: 6, colors: false });
  }

  if (result.status === "success") {
    return `Success${domain ? ` for ${domain}` : ""}${action ? ` ${action}` : ""}.`;
  }

  return inspect(result, { depth: 6, colors: false });
}

function printLine(stream: NodeJS.WriteStream, text: string): void {
  stream.write(`${text}\n`);
}

function assertDomainAndAction(invocation: ParsedManagementCommand): { domain: Exclude<ManagementDomain, "manage">; action: string } {
  if (invocation.command === "manage") {
    const { domain, action } = normalizePayloadJson(invocation);
    if (!domain) {
      throw new Error("Missing required flags: --domain");
    }
    if (!action) {
      throw new Error("Missing required flags: --action");
    }
    return { domain, action };
  }

  if (!invocation.domain || invocation.action === null) {
    throw new Error(`Usage: codeux ${invocation.command} <action>`);
  }

  return { domain: invocation.domain, action: invocation.action };
}

async function callManagementHandler(
  invocation: ParsedManagementCommand,
  payload: Record<string, unknown>,
  approval: ManagementApproval | undefined,
  createDependencies: typeof createRuntimeDependencies,
  projectRoot: string,
  appConfig: AppConfig,
): Promise<ManagementResponseEnvelope> {
  const runtimeContext = new DefaultRuntimeContext();
  const context = createCliServerContext(projectRoot, appConfig, runtimeContext);
  const deps = createDependencies({ projectRoot, appConfig }, context);
  const handler = deps.managementToolHandler;

  const argsBase = {
    action: invocation.action ?? "",
    payload,
    approval,
  } as const;

  if (invocation.command === "manage") {
    return JSON.parse((await handler.handleManageCodeUx({
      domain: normalizePayloadJson(invocation).domain ?? "",
      action: normalizePayloadJson(invocation).action ?? "",
      payload,
      approval,
    })).content[0].text) as ManagementResponseEnvelope;
  }

  switch (invocation.domain) {
    case "projects":
      return JSON.parse((await handler.handleManageProjects(argsBase as ManageProjectsArgs)).content[0].text) as ManagementResponseEnvelope;
    case "sprints":
      return JSON.parse((await handler.handleManageSprints(argsBase as ManageSprintsArgs)).content[0].text) as ManagementResponseEnvelope;
    case "tasks":
      return JSON.parse((await handler.handleManageTasks(argsBase as ManageTasksArgs)).content[0].text) as ManagementResponseEnvelope;
    case "quicksprints":
      return JSON.parse((await handler.handleManageQuicksprints(argsBase as ManageQuicksprintsArgs)).content[0].text) as ManagementResponseEnvelope;
    case "scheduler":
      return JSON.parse((await handler.handleManageScheduler(argsBase as ManageSchedulerArgs)).content[0].text) as ManagementResponseEnvelope;
    case "settings":
      return JSON.parse((await handler.handleManageSettings(argsBase as ManageSettingsArgs)).content[0].text) as ManagementResponseEnvelope;
    case "agents":
      return JSON.parse((await handler.handleManageAgents(argsBase as ManageAgentsArgs)).content[0].text) as ManagementResponseEnvelope;
    case "memory":
      return JSON.parse((await handler.handleManageMemory(argsBase as ManageMemoryArgs)).content[0].text) as ManagementResponseEnvelope;
    case "preview":
      return JSON.parse((await handler.handleManagePreview(argsBase as ManagePreviewArgs)).content[0].text) as ManagementResponseEnvelope;
    case "telemetry":
      return JSON.parse((await handler.handleManageTelemetry(argsBase as ManageTelemetryArgs)).content[0].text) as ManagementResponseEnvelope;
    default:
      throw new Error(`Unknown management domain: ${invocation.domain}`);
  }
}

function getInvokedDomainAndAction(invocation: ParsedManagementCommand): { domain: Exclude<ManagementDomain, "manage">; action: string } {
  if (invocation.command === "manage") {
    const normalized = normalizePayloadJson(invocation);
    if (!normalized.domain || !normalized.action) {
      throw new Error("Missing required flags: --domain, --action");
    }
    return { domain: normalized.domain, action: normalized.action };
  }

  if (!invocation.domain || !invocation.action) {
    throw new Error(`Usage: codeux ${invocation.command} <action>`);
  }

  return { domain: invocation.domain, action: invocation.action };
}

export async function runManagementCli(options: ManagementCliOptions): Promise<boolean> {
  const io = getIo(options.io);
  const invocation = options.invocation.management;
  if (!invocation) {
    return false;
  }

  const manageDetails = invocation.command === "manage" ? normalizePayloadJson(invocation) : null;
  const missingManageShape = invocation.command === "manage" && (!manageDetails?.domain || !manageDetails?.action);

  if (invocation.helpRequested || missingManageShape || (!invocation.action && invocation.command !== "manage")) {
    if (invocation.command === "manage") {
      printLine(io.stdout, buildGenericManageHelpText());
    } else if (invocation.domain) {
      printLine(io.stdout, buildDomainHelpText(invocation.domain));
    } else {
      printLine(io.stdout, buildHelpText(options.appConfig));
    }
    return true;
  }

  let domain: Exclude<ManagementDomain, "manage">;
  let action: string;
  try {
    ({ domain, action } = getInvokedDomainAndAction(invocation));
  } catch (error) {
    printLine(io.stderr, error instanceof Error ? error.message : String(error));
    return true;
  }

  let normalizedInvocation = invocation;
  let normalizedPayload = normalizePayloadJson(normalizedInvocation).payload;
  let approval = normalizePayloadJson(normalizedInvocation).approval;

  const requiredFlags = getRequiredFlags(domain, action);
  let missingFlags = getMissingFlags(normalizedPayload, requiredFlags);

  if (missingFlags.length > 0) {
    if (!io.stdin.isTTY) {
      throw new Error(`Missing required flags: ${missingFlags.join(", ")}`);
    }

    const prompts = buildPromptQueue(missingFlags);
    const answers = await promptForValues({ stdin: io.stdin, stdout: io.stdout }, prompts);
    normalizedPayload = { ...normalizedPayload, ...answers };
    missingFlags = getMissingFlags(normalizedPayload, requiredFlags);
  }

  if (missingFlags.length > 0) {
    throw new Error(`Missing required flags: ${missingFlags.join(", ")}`);
  }

  const createDependencies = options.createDependencies ?? createRuntimeDependencies;
  const response = await callManagementHandler(
    {
      ...normalizedInvocation,
      domain,
      action,
    } as ParsedManagementCommand,
    normalizedPayload,
    approval,
    createDependencies,
    options.projectRoot,
    options.appConfig,
  );

  if (invocation.jsonOutput) {
    printLine(io.stdout, JSON.stringify(response, null, 2));
    return true;
  }

  printLine(io.stdout, formatReadableEnvelope(response, domain, action));
  return true;
}
