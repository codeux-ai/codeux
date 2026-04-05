import {
  ConversationCompactionSummary,
  ConversationMessageRecord,
  ConversationRuntimeState,
  ConversationThreadRecord,
} from "../contracts/connection-chat-types.js";

export function normalizeProviderReply(output: string): string {
  const trimmed = output.trim();
  if (!trimmed) {
    return "";
  }

  try {
    const parsed = JSON.parse(trimmed) as { response?: unknown };
    if (typeof parsed?.response === "string") {
      return parsed.response.trim();
    }
  } catch {
    // Provider returned plain text; keep it as-is.
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
    "You are a Sprint OS connected worker replying to a dashboard chat message.",
    "Reply in concise markdown.",
    "Do not claim code changes, PRs, or completed execution unless they actually happened.",
    "If the message asks for status you do not know, say so plainly and ask for the next action.",
    "Do not start implementation from this message. This is a reply-only interaction.",
  ].join("\n");

  const history = replayMessages.map((message) => {
    const role = message.authorType === "dashboard_user" ? "User" : "Worker";
    return `### ${role}\n${message.bodyMarkdown.trim()}`;
  }).join("\n\n");

  const fallbackBody = args.bodyMarkdown ? args.bodyMarkdown.trim() : "_No new messages since the compaction summary was generated._";

  const jsonInstructions = [
    "You must return STRICT JSON format containing exactly two keys: `replyMarkdown` and `action`.",
    "1. `replyMarkdown`: A string containing your concise markdown reply to the user.",
    "2. `action`: An optional object if you want to perform a Sprint OS management action. Otherwise, set this to `null`.",
    "   - Format: `{ \"domain\": \"...\", \"action\": \"...\", \"payload\": { ... } }`",
    "   - Domains: `projects`, `sprints`, `tasks`, `settings`, `agents`, `memory`, `preview`, `telemetry`.",
    "   - Note: Destructive actions (starting with `delete_`, `reset_`, `replace_`) and bulk settings updates MUST pause for explicit user approval.",
    "     If you propose an approval-gated action, it will not execute immediately; the user will see a confirmation prompt.",
  ].join("\n");

  const pendingActionContext = pendingAction ? [
    "## PENDING ACTION CONTEXT",
    "You previously proposed the following management action which requires user approval:",
    "```json",
    JSON.stringify(pendingAction.action, null, 2),
    "```",
    `Approval Message: ${pendingAction.approvalMessage}`,
    "The user's latest message may be an approval (e.g., 'yes', 'confirm') or rejection.",
  ].join("\n") : "";

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
    "## REQUIRED OUTPUT",
    jsonInstructions,
  ].filter((part) => part.trim().length > 0).join("\n");
}

export function buildChatContinuationPrompt(message: ConversationMessageRecord, pendingAction?: ConversationRuntimeState["pendingManagementAction"]): string {
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
  return `${pendingActionContext}### User\n${message.bodyMarkdown.trim()}`;
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
    "You are compacting a Sprint OS dashboard chat thread into a reusable handoff summary for a fresh worker session.",
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
