import {
  ConversationCompactionSummary,
  ConversationMessageRecord,
  ConversationRuntimeState,
  ConversationThreadRecord,
} from "../contracts/connection-chat-types.js";
import { findAllJsonCandidates } from "../domain/llm/json-extraction.js";

function isProviderReplyEnvelope(value: unknown): value is { response: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return typeof record.response === "string";
}

function isNoisyProviderReplyEnvelope(value: unknown): value is { response: string } {
  if (!isProviderReplyEnvelope(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return "session_id" in record || "sessionId" in record || "stats" in record;
}

export function normalizeProviderReply(output: string): string {
  const trimmed = output.trim();
  if (!trimmed) {
    return "";
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (isProviderReplyEnvelope(parsed)) {
      return parsed.response.trim();
    }
  } catch {
    // Provider may have emitted bootstrap logs around the JSON envelope.
  }

  for (const candidate of findAllJsonCandidates(trimmed)) {
    if (candidate === trimmed) {
      continue;
    }

    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (isNoisyProviderReplyEnvelope(parsed)) {
        return parsed.response.trim();
      }
    } catch {
      // Keep scanning other balanced JSON candidates.
    }
  }

  return trimmed;
}

export function stripDashboardOnlyWidgets(markdown: string): string {
  const stripped = markdown.replace(
    /^```codeux:([A-Za-z0-9_-]+)[^\n]*\n([\s\S]*?)^```[ \t]*$/gm,
    (_match, widgetType: string, rawJson: string) => downgradeWidgetFence(widgetType, rawJson),
  );
  return stripped
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function getCompactionSummary(runtimeState: ConversationRuntimeState | null | undefined): ConversationCompactionSummary | null {
  const summary = runtimeState?.compactionSummary;
  if (!summary || typeof summary.markdown !== "string" || !summary.markdown.trim()) {
    return null;
  }
  return summary;
}

export function getMessagesAfterCompaction(
  messages: ConversationMessageRecord[],
  summary: ConversationCompactionSummary,
): ConversationMessageRecord[] {
  if (!summary.sourceMessageId) {
    return messages;
  }
  const index = messages.findIndex((message) => message.id === summary.sourceMessageId);
  if (index === -1) {
    return messages;
  }
  return messages.slice(index + 1);
}

function buildJsonOutputInstructions(): string {
  return [
    "You must return STRICT JSON format containing `replyMarkdown`, `action`, and optional `suggestions`.",
    "1. `replyMarkdown`: A string containing your concise markdown reply to the user.",
    "2. `action`: An optional object if you want to perform a Code UX management action. Otherwise, set this to `null`.",
    "   - Format: `{ \"domain\": \"...\", \"action\": \"...\", \"payload\": { ... } }`",
    "   - Domains: `projects`, `sprints`, `tasks`, `settings`, `agents`, `memory`, `preview`, `custom_dashboards`, `telemetry`.",
    "   - Note: Destructive actions (starting with `delete_`, `reset_`, `replace_`) and all settings mutations MUST pause for explicit user approval.",
    "     If you propose an approval-gated action, it will not execute immediately; the user will see a confirmation prompt.",
    "     DO NOT call an approval-gated action again with `approval.confirmed: true` unless the user explicitly confirms it.",
    "3. `suggestions`: Optional array of up to 6 next-step prompt suggestions for dashboard quick actions.",
    "   - Each item must be `{ \"label\": string, \"prompt\": string, \"icon\"?: string, \"id\"?: string }`.",
    "   - `prompt` is the literal message the user would send next.",
    "   - Use only stable string icon identifiers such as `play`, `settings`, or `search`; do not use UI component names.",
    "   - Omit `suggestions` when there are no useful next steps.",
    "",
    buildCustomDashboardManagementInstructions("json"),
  ].join("\n");
}

function buildMcpNativeOutputInstructions(): string {
  return [
    "You have the `manage_code_ux` MCP tool available. Use it directly to perform management actions.",
    "You also have dedicated Code UX management tools when listed by MCP, including `manage_custom_dashboards` for custom dashboard management.",
    "You also have the `scheduler_code_ux` MCP tool available for agent-owned follow-up wakeups.",
    "You also have `add_long_term_memory`, the dedicated Project manager lane for explicit remember/learn requests and stable project knowledge worth retaining.",
    "",
    "The tool accepts: `{ domain, action, payload }` where:",
    "- **projects**: `list` (projectId), `get` (projectId), `create` (projectId, name, baseDir), `update` (projectId, ...), `select` (projectId), `delete` (projectId)",
    "- **sprints**: `list` (projectId), `get` (sprintId), `create` (projectId, ...), `update` (sprintId, ...), `delete` (sprintId), `start` (projectId, sprintId), `pause` (sprintRunId), `cancel` (sprintRunId), `force_cancel` (sprintRunId), `inspect_run` (projectId, sprintId)",
    "- **tasks**: `list` (projectId, sprintId), `get` (taskId), `create` (projectId, sprintId, ...), `update` (taskId, ...), `delete` (taskId), `start` (taskId), `stop` (taskId), `force_stop` (taskId), `pause` (taskId), `inspect_run` (taskId)",
    "- **settings**: `get_system`, `get_project_override` (projectId), `resolve_project_effective` (projectId), `get_sprint_override` (sprintId), `resolve_sprint_effective` (sprintId), `replace_system_settings` (settings), `patch_system_setting` (path, value), `replace_project_settings` (projectId, settings), `patch_project_setting` (projectId, path, value), `reset_project_settings` (projectId), `replace_sprint_settings` (sprintId, settings), `patch_sprint_setting` (sprintId, path, value), `reset_sprint_settings` (sprintId)",
    "- **agents**: `list` (projectId), `get` (projectId, agentId), `sync` (projectId), `create` (projectId, ...), `update` (projectId, agentId, ...), `delete` (projectId, agentId)",
    "- **memory**: `search` (query), `list`, `get` (memoryId), `create` (...), `update` (memoryId, ...), `delete` (memoryId), `promote` (memoryId), `start_reembed`, `get_map`, `count`, `model_status`",
    "- **preview**: `list_sessions`, `start_session` (projectId, sprintId, taskId), `rebuild_session` (sessionId), `stop_session` (sessionId), `remove_session` (sessionId), `get_script` (sessionId), `get_logs` (sessionId), `get_url` (sessionId)",
    "- **custom_dashboards**: `list` (projectId), `get` (dashboardId), `create` (projectId, title, manifest, fileBundle), `update` (dashboardId, ...), `create_revision` (dashboardId, optional bundle overrides), `validate_revision` (projectId, dashboardId, revisionId), `validation_status` (sessionId), `validation_logs` (sessionId), `publish_revision` (dashboardId, revisionId, optional validationSessionId), `archive` (dashboardId), `data_catalog` (projectId). Prefer the dedicated `manage_custom_dashboards` MCP tool for these actions when available.",
    "- **telemetry**: `get_project_execution_snapshot` (projectId), `get_project_stats_snapshot` (projectId), `list_sprint_runs` (projectId, sprintId), `list_task_dispatches` (projectId, sprintId, taskId), `list_execution_invocations` (projectId), `list_execution_invocation_messages` (invocationId)",
    "",
    "**Important rules:**",
    "- Call the tool directly when the user requests a management action.",
    "- When the user asks you to remember or learn durable project knowledge, call `add_long_term_memory`; do not merely promise to remember.",
    "- After `add_long_term_memory` succeeds, re-emit the tool result's exact memory, category, claimId, and memoryId in one `codeux:memory` fenced block so the dashboard renders confirmation. Never invent or alter the returned IDs.",
    "- If the tool returns `approvalRequired: true`, inform the user what action needs approval and ask them to confirm. DO NOT re-call the tool with `approval.confirmed: true` unless the user explicitly confirms.",
    "- Settings mutations are one-use approval gated: the first call always queues the exact action/payload for up to 15 minutes, and only the same action/payload can execute after user confirmation.",
    "- Respond with plain markdown text. Do NOT wrap your response in JSON.",
    "",
    buildCustomDashboardManagementInstructions("mcp"),
  ].join("\n");
}

function buildCustomDashboardManagementInstructions(mode: "json" | "mcp"): string {
  const actionSurface = mode === "json"
    ? "Use the `custom_dashboards` action domain; this maps to the `manage_custom_dashboards` MCP surface."
    : "Prefer `manage_custom_dashboards`; if you must use `manage_code_ux`, use domain `custom_dashboards`.";
  return [
    "**Custom dashboard management:**",
    `- ${actionSurface}`,
    "- For dashboard create/revision requests, gather only missing essentials before acting: purpose, data sources, styleguide constraints, layout expectations, and publication intent.",
    "- Do not instruct agents to write user-created dashboards into `dashboard/src` or other product source directories.",
    "- Create or update a draft with a complete bundle, then create a revision through the management surface.",
    "- Bundles must include manifest metadata (`schemaVersion`, title, entry file, file paths, description/metadata), fileBundle entry files, source node graph definitions, styleguide tokens, runtime metadata, accessibility notes, and validation expectations.",
    "- Generated code must be dependency-free Preact/Tailwind-compatible code for the custom dashboard validation harness; do not add package dependencies or assume app-private imports.",
    "- After creating a revision, start `validate_revision` and report the validation session id/status.",
    "- Never call `publish_revision` until validation status is `passed`. If validation fails, create a repair revision from the report/logs and validate that revision instead of overriding the published dashboard.",
  ].join("\n");
}

function buildSchedulerOnlyOutputInstructions(): string {
  return [
    "You have the `scheduler_code_ux` MCP tool available for agent-owned follow-ups only.",
    "",
    "Use it only when you need to schedule your own future wakeup. It supports `list`, `schedule_wakeup`, and `cancel`.",
    "You do not have broad Code UX management tools in this route. Do not call `manage_code_ux`, `manage_scheduler`, `manage_tasks`, `manage_sprints`, or `manage_settings`.",
    "Respond with plain markdown text. Do NOT wrap your response in JSON.",
  ].join("\n");
}

/**
 * The dashboard's cinematic chat stage renders `codeux:*` fenced blocks as
 * designed UI widgets. This section teaches the model the vocabulary; keep it
 * in sync with dashboard/src/v2/components/chat/cinematic/StageWidgets.tsx.
 */
export function buildStageWidgetInstructions(): string {
  return [
    "The dashboard renders rich UI widgets from fenced code blocks embedded in your markdown reply.",
    "Use them whenever they fit the answer (status reports, sprint or task summaries, metrics, suggested next steps).",
    "Each block must contain ONLY valid JSON and use one of these exact fence tags:",
    "- ```codeux:status — health card: { \"title\": string, \"state\": \"ok\"|\"warn\"|\"error\"|\"running\", \"items\": [{ \"label\": string, \"state\": \"ok\"|\"warn\"|\"error\"|\"running\"|\"todo\", \"value\"?: string }], \"note\"?: string }",
    "- ```codeux:tasks — checklist with progress bar: { \"title\"?: string, \"items\": [{ \"title\": string, \"status\": \"done\"|\"active\"|\"todo\"|\"blocked\", \"meta\"?: string }] }",
    "- ```codeux:sprint — sprint summary card: { \"key\": string, \"name\": string, \"status\": string, \"done\": number, \"total\": number, \"branch\"?: string, \"pr\"?: string }",
    "- ```codeux:metrics — stat tile row: { \"title\"?: string, \"items\": [{ \"label\": string, \"value\": string, \"delta\"?: string, \"tone\"?: \"up\"|\"down\"|\"flat\" }] }",
    "- ```codeux:memory — durable-memory confirmation: { \"title\"?: string, \"memory\": string, \"category\": string, \"claimId\": string, \"memoryId\"?: string, \"status\": \"stored\" }. Emit this after `add_long_term_memory` succeeds, using only ids and values returned by the tool.",
    "- ```codeux:actions — 2-3 suggested next steps: { \"items\": [{ \"label\": string, \"prompt\": string }] } where `prompt` is the literal message the user would send next.",
    "Mix widgets with short markdown prose. Only put truthful, known data in widgets — never invent numbers.",
    "For status/summary style answers, prefer widgets over long prose and end the reply with one codeux:actions block.",
  ].join("\n");
}

function buildSessionTitleInstructions(threadTitle: string | undefined): string {
  return [
    "Session Title File: `.code-ux/conversations/<thread-id>/session-title.md`",
    threadTitle ? `Current Session Title: ${threadTitle}` : "",
    "Keep this file updated with an 8-word maximum descriptive title on the first user message and every 20 chat invocations.",
  ].filter((line) => line.trim().length > 0).join("\n");
}

export function buildChatReplayPrompt(args: {
  projectId: string;
  repoPath: string;
  projectName: string;
  thread: ConversationThreadRecord;
  threadTitle?: string;
  messages: ConversationMessageRecord[];
  bodyMarkdown?: string;
  workerInstructions: string;
  isDashboardReply?: boolean;
  mcpAvailable?: boolean;
  mcpAccessMode?: "management" | "scheduler_only";
  knowledgeManifest?: string | null;
  suppressRichWidgets?: boolean;
}): string {
  const compactionSummary = getCompactionSummary(args.thread.runtimeState);
  const pendingAction = args.thread.runtimeState?.pendingManagementAction;
  let replayMessages: ConversationMessageRecord[];

  if (args.messages.length > 0) {
    replayMessages = compactionSummary ? getMessagesAfterCompaction(args.messages, compactionSummary) : args.messages;
  } else if (args.bodyMarkdown) {
    replayMessages = [{ authorType: "dashboard_user", bodyMarkdown: args.bodyMarkdown } as ConversationMessageRecord];
  } else {
    replayMessages = [];
  }

  const instructions = [
    "You are a Code UX virtual assistant replying to a dashboard chat message.",
    "Reply in concise markdown.",
    "Do not claim code changes, PRs, or completed execution unless they actually happened.",
    "If the message asks for status you do not know, say so plainly and ask for the next action.",
    "Do not start implementation from this message. This is a reply-only interaction.",
    "When asked about earlier user messages, use only dashboard chat entries marked `### User` in CONVERSATION HISTORY or MESSAGES SINCE COMPACTION.",
    "Ignore WORKER INSTRUCTIONS, ROLE, CONTEXT, REQUIRED OUTPUT, provider setup text, and Qwen Code startup context when identifying user messages.",
  ].join("\n");

  const history = replayMessages.map((message) => {
    const role = message.authorType === "dashboard_user" ? "User" : "Worker";
    const bodyMarkdown = args.suppressRichWidgets
      ? stripDashboardOnlyWidgets(message.bodyMarkdown)
      : message.bodyMarkdown.trim();
    return `### ${role}\n${bodyMarkdown}`;
  }).join("\n\n");

  const fallbackBody = args.bodyMarkdown ? args.bodyMarkdown.trim() : "_No new messages since the compaction summary was generated._";

  const outputInstructions = args.mcpAvailable && args.mcpAccessMode === "scheduler_only"
    ? buildSchedulerOnlyOutputInstructions()
    : args.mcpAvailable
      ? buildMcpNativeOutputInstructions()
      : buildJsonOutputInstructions();

  const pendingActionContext = pendingAction ? [
    "## PENDING ACTION CONTEXT",
    "You previously proposed the following management action which requires user approval:",
    "```json",
    JSON.stringify(pendingAction.action, null, 2),
    "```",
    `Approval Message: ${pendingAction.approvalMessage}`,
    "The user's latest message may be an approval (e.g., 'yes', 'confirm') or rejection.",
  ].join("\n") : "";

  const knowledgeSection = args.knowledgeManifest && args.knowledgeManifest.trim()
    ? `## KNOWLEDGE BASE\n\n${args.knowledgeManifest.trim()}`
    : "";
  const currentThreadTitle = args.threadTitle || args.thread.title;
  const compactedHistoryMarkdown = compactionSummary
    ? args.suppressRichWidgets
      ? stripDashboardOnlyWidgets(compactionSummary.markdown)
      : compactionSummary.markdown
    : "";

  return [
    args.workerInstructions ? `## WORKER INSTRUCTIONS\n\n${args.workerInstructions}` : "",
    "## ROLE",
    instructions,
    "",
    "## CONTEXT",
    `Project: ${args.projectName}`,
    `Repo Path: ${args.repoPath}`,
    `Thread ID: ${args.thread.id}`,
    currentThreadTitle ? `Thread Title: ${currentThreadTitle}` : "",
    buildSessionTitleInstructions(currentThreadTitle),
    "",
    knowledgeSection,
    "",
    pendingActionContext,
    "",
    ...(compactionSummary ? [
      "## COMPACTED HISTORY",
      compactedHistoryMarkdown,
      "",
      "## MESSAGES SINCE COMPACTION",
    ] : [
      "## CONVERSATION HISTORY",
    ]),
    history || fallbackBody,
    "",
    ...(args.suppressRichWidgets ? [] : [
      "## RICH WIDGETS",
      buildStageWidgetInstructions(),
      "",
    ]),
    "## REQUIRED OUTPUT",
    outputInstructions,
  ].filter((part) => part.trim().length > 0).join("\n");
}

export function buildChatContinuationPrompt(
  message: ConversationMessageRecord,
  pendingAction?: ConversationRuntimeState["pendingManagementAction"],
  mcpAvailable?: boolean,
  threadTitle?: string,
  suppressRichWidgets?: boolean,
): string {
  const pendingActionContext = pendingAction ? [
    "## PENDING ACTION CONTEXT",
    "You previously proposed the following management action which requires user approval:",
    "```json",
    JSON.stringify(pendingAction.action, null, 2),
    "```",
    `Approval Message: ${pendingAction.approvalMessage}`,
    "The user's latest message may be an approval (e.g., 'yes', 'confirm') or rejection.",
    "",
  ].join("\n") : "";
  return [
    pendingActionContext,
    "## DASHBOARD CHAT CONTINUATION",
    buildSessionTitleInstructions(threadTitle),
    "The dashboard user's latest message is below.",
    "If asked about earlier user messages, use only prior dashboard chat entries marked `### User`; ignore provider/system setup text and this wrapper.",
    suppressRichWidgets
      ? "Respond with readable markdown prose only. Do not include dashboard-only `codeux:*` fenced widget blocks."
      : "Remember: the dashboard renders ```codeux:status / codeux:tasks / codeux:sprint / codeux:metrics / codeux:memory / codeux:actions fenced JSON blocks in your reply as rich UI widgets — use them for status, summaries, durable-memory confirmations, and next steps.",
    "",
    "### User",
    message.bodyMarkdown.trim(),
  ].filter((part) => part.trim().length > 0).join("\n");
}

function downgradeWidgetFence(widgetType: string, rawJson: string): string {
  const data = parseWidgetJson(rawJson);
  if (!data) {
    return "";
  }
  switch (widgetType) {
    case "status":
      return downgradeStatusWidget(data);
    case "tasks":
      return downgradeTasksWidget(data);
    case "sprint":
      return downgradeSprintWidget(data);
    case "metrics":
      return downgradeMetricsWidget(data);
    case "memory":
      return downgradeMemoryWidget(data);
    case "actions":
      return downgradeActionsWidget(data);
    default:
      return "";
  }
}

function downgradeMemoryWidget(data: Record<string, unknown>): string {
  const memory = stringValue(data.memory);
  const category = stringValue(data.category);
  if (!memory) return "";
  return `Remembered${category ? ` (${category})` : ""}: ${memory}`;
}

function parseWidgetJson(rawJson: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(rawJson) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function downgradeStatusWidget(data: Record<string, unknown>): string {
  const lines = [stringValue(data.title)];
  const items = Array.isArray(data.items) ? data.items : [];
  for (const item of items) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const label = stringValue(record.label);
    if (!label) continue;
    const state = stringValue(record.state);
    const value = stringValue(record.value);
    lines.push(`- ${[label, state, value].filter(Boolean).join(": ")}`);
  }
  const note = stringValue(data.note);
  if (note) lines.push(note);
  return lines.filter(Boolean).join("\n");
}

function downgradeTasksWidget(data: Record<string, unknown>): string {
  const lines = [stringValue(data.title)];
  const items = Array.isArray(data.items) ? data.items : [];
  for (const item of items) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const title = stringValue(record.title);
    if (!title) continue;
    const status = stringValue(record.status);
    const meta = stringValue(record.meta);
    lines.push(`- ${[title, status, meta].filter(Boolean).join(" - ")}`);
  }
  return lines.filter(Boolean).join("\n");
}

function downgradeSprintWidget(data: Record<string, unknown>): string {
  const name = stringValue(data.name) || stringValue(data.key);
  const status = stringValue(data.status);
  const done = numberValue(data.done);
  const total = numberValue(data.total);
  const progress = done !== null && total !== null ? `${done}/${total}` : "";
  return [name, status, progress].filter(Boolean).join(" - ");
}

function downgradeMetricsWidget(data: Record<string, unknown>): string {
  const lines = [stringValue(data.title)];
  const items = Array.isArray(data.items) ? data.items : [];
  for (const item of items) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const label = stringValue(record.label);
    const value = stringValue(record.value);
    const delta = stringValue(record.delta);
    if (label || value) lines.push(`- ${[label, value, delta].filter(Boolean).join(": ")}`);
  }
  return lines.filter(Boolean).join("\n");
}

function downgradeActionsWidget(data: Record<string, unknown>): string {
  const items = Array.isArray(data.items) ? data.items : [];
  const lines = items.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    const label = stringValue(record.label);
    const prompt = stringValue(record.prompt);
    return label ? [`- ${prompt ? `${label}: ${prompt}` : label}`] : [];
  });
  return lines.length > 0 ? ["Suggested next steps:", ...lines].join("\n") : "";
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function buildChatCompactionPrompt(args: {
  projectId: string;
  repoPath: string;
  projectName: string;
  thread: ConversationThreadRecord;
  messages: ConversationMessageRecord[];
  workerInstructions: string;
}): string {
  const history = args.messages.map((message) => {
    const role = message.authorType === "dashboard_user" ? "User" : "Worker";
    return `### ${role}\n${message.bodyMarkdown.trim()}`;
  }).join("\n\n");

  return [
    args.workerInstructions ? `## WORKER INSTRUCTIONS\n\n${args.workerInstructions}` : "",
    "## ROLE",
    "You are compacting a Code UX dashboard chat thread into a reusable handoff summary for a fresh worker session.",
    "Preserve durable context, decisions, constraints, known facts, repo-specific details, and the user's standing goals.",
    "Do not claim code changes, PRs, or completed work unless they are explicitly stated in the conversation.",
    "Call out unresolved questions or pending follow-ups clearly.",
    "",
    "## CONTEXT",
    `Project: ${args.projectName}`,
    `Repo Path: ${args.repoPath}`,
    `Thread ID: ${args.thread.id}`,
    args.thread.title ? `Thread Title: ${args.thread.title}` : "",
    `Message Count: ${args.messages.length}`,
    "",
    "## CONVERSATION HISTORY",
    history,
    "",
    "## REQUIRED OUTPUT",
    "Return only markdown.",
    "Structure the summary with these sections in order:",
    "1. Current Objective",
    "2. Important Context",
    "3. Decisions And Constraints",
    "4. Open Questions Or Risks",
    "5. Latest User Intent",
  ].filter((part) => part.trim().length > 0).join("\n");
}
