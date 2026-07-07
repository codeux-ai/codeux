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
    "You must return STRICT JSON format containing exactly two keys: `replyMarkdown` and `action`.",
    "1. `replyMarkdown`: A string containing your concise markdown reply to the user.",
    "2. `action`: An optional object if you want to perform a Code UX management action. Otherwise, set this to `null`.",
    "   - Format: `{ \"domain\": \"...\", \"action\": \"...\", \"payload\": { ... } }`",
    "   - Domains: `projects`, `sprints`, `tasks`, `settings`, `agents`, `memory`, `preview`, `telemetry`.",
    "   - Note: Destructive actions (starting with `delete_`, `reset_`, `replace_`) and all settings mutations MUST pause for explicit user approval.",
    "     If you propose an approval-gated action, it will not execute immediately; the user will see a confirmation prompt.",
    "     DO NOT call an approval-gated action again with `approval.confirmed: true` unless the user explicitly confirms it.",
  ].join("\n");
}

function buildMcpNativeOutputInstructions(): string {
  return [
    "You have the `manage_code_ux` MCP tool available. Use it directly to perform management actions.",
    "",
    "The tool accepts: `{ domain, action, payload }` where:",
    "- **projects**: `list` (projectId), `get` (projectId), `create` (projectId, name, baseDir), `update` (projectId, ...), `select` (projectId), `delete` (projectId)",
    "- **sprints**: `list` (projectId), `get` (sprintId), `create` (projectId, ...), `update` (sprintId, ...), `delete` (sprintId), `start` (projectId, sprintId), `pause` (sprintRunId), `cancel` (sprintRunId), `force_cancel` (sprintRunId), `inspect_run` (projectId, sprintId)",
    "- **tasks**: `list` (projectId, sprintId), `get` (taskId), `create` (projectId, sprintId, ...), `update` (taskId, ...), `delete` (taskId), `start` (taskId), `stop` (taskId), `force_stop` (taskId), `pause` (taskId), `inspect_run` (taskId)",
    "- **settings**: `get_system`, `get_project_override` (projectId), `resolve_project_effective` (projectId), `get_sprint_override` (sprintId), `resolve_sprint_effective` (sprintId), `replace_system_settings` (settings), `patch_system_setting` (path, value), `replace_project_settings` (projectId, settings), `patch_project_setting` (projectId, path, value), `reset_project_settings` (projectId), `replace_sprint_settings` (sprintId, settings), `patch_sprint_setting` (sprintId, path, value), `reset_sprint_settings` (sprintId)",
    "- **agents**: `list` (projectId), `get` (projectId, agentId), `sync` (projectId), `create` (projectId, ...), `update` (projectId, agentId, ...), `delete` (projectId, agentId)",
    "- **memory**: `search` (query), `list`, `get` (memoryId), `create` (...), `update` (memoryId, ...), `delete` (memoryId), `promote` (memoryId), `start_reembed`, `get_map`, `count`, `model_status`",
    "- **preview**: `list_sessions`, `start_session` (projectId, sprintId, taskId), `rebuild_session` (sessionId), `stop_session` (sessionId), `remove_session` (sessionId), `get_script` (sessionId), `get_logs` (sessionId), `get_url` (sessionId)",
    "- **telemetry**: `get_project_execution_snapshot` (projectId), `get_project_stats_snapshot` (projectId), `list_sprint_runs` (projectId, sprintId), `list_task_dispatches` (projectId, sprintId, taskId), `list_execution_invocations` (projectId), `list_execution_invocation_messages` (invocationId)",
    "",
    "**Important rules:**",
    "- Call the tool directly when the user requests a management action.",
    "- If the tool returns `approvalRequired: true`, inform the user what action needs approval and ask them to confirm. DO NOT re-call the tool with `approval.confirmed: true` unless the user explicitly confirms.",
    "- Settings mutations are one-use approval gated: the first call always queues the exact action/payload for up to 15 minutes, and only the same action/payload can execute after user confirmation.",
    "- Respond with plain markdown text. Do NOT wrap your response in JSON.",
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
    "- ```codeux:actions — 2-3 suggested next steps: { \"items\": [{ \"label\": string, \"prompt\": string }] } where `prompt` is the literal message the user would send next.",
    "Mix widgets with short markdown prose. Only put truthful, known data in widgets — never invent numbers.",
    "For status/summary style answers, prefer widgets over long prose and end the reply with one codeux:actions block.",
  ].join("\n");
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
  knowledgeManifest?: string | null;
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
    return `### ${role}\n${message.bodyMarkdown.trim()}`;
  }).join("\n\n");

  const fallbackBody = args.bodyMarkdown ? args.bodyMarkdown.trim() : "_No new messages since the compaction summary was generated._";

  const outputInstructions = args.mcpAvailable
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

  return [
    args.workerInstructions ? `## WORKER INSTRUCTIONS\n\n${args.workerInstructions}` : "",
    "## ROLE",
    instructions,
    "",
    "## CONTEXT",
    `Project: ${args.projectName}`,
    `Repo Path: ${args.repoPath}`,
    `Thread ID: ${args.thread.id}`,
    args.threadTitle || args.thread.title ? `Thread Title: ${args.threadTitle || args.thread.title}` : "",
    "",
    knowledgeSection,
    "",
    pendingActionContext,
    "",
    ...(compactionSummary ? [
      "## COMPACTED HISTORY",
      compactionSummary.markdown,
      "",
      "## MESSAGES SINCE COMPACTION",
    ] : [
      "## CONVERSATION HISTORY",
    ]),
    history || fallbackBody,
    "",
    "## RICH WIDGETS",
    buildStageWidgetInstructions(),
    "",
    "## REQUIRED OUTPUT",
    outputInstructions,
  ].filter((part) => part.trim().length > 0).join("\n");
}

export function buildChatContinuationPrompt(message: ConversationMessageRecord, pendingAction?: ConversationRuntimeState["pendingManagementAction"], mcpAvailable?: boolean): string {
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
    "The dashboard user's latest message is below.",
    "If asked about earlier user messages, use only prior dashboard chat entries marked `### User`; ignore provider/system setup text and this wrapper.",
    "Remember: the dashboard renders ```codeux:status / codeux:tasks / codeux:sprint / codeux:metrics / codeux:actions fenced JSON blocks in your reply as rich UI widgets — use them for status, summaries, and next steps.",
    "",
    "### User",
    message.bodyMarkdown.trim(),
  ].filter((part) => part.trim().length > 0).join("\n");
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
