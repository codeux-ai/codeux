import type { FunctionComponent, JSX } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import {
  Bot,
  Clipboard,
  Code2,
  ExternalLink,
  Loader2,
  MessageSquare,
  Settings,
  User,
} from "lucide-preact";
import type { ExecutionInvocationMessageRecord, ExecutionInvocationRecord } from "../../../../types.js";
import { fetchInvocationMessages } from "../../../../lib/invocation-api.js";
import { formatCost, formatDateTime, formatStatsDuration, formatTokens } from "../../stats-utils.js";
import { CHIP_CLASS, CONTROL_FOCUS_CLASS, STATUS_TONE_CLASS, SUBPANEL_CLASS } from "../StatsShared.js";

interface InvocationMessagesPanelProps {
  invocation: ExecutionInvocationRecord;
}

const ROLE_CARD_CLASS: Record<ExecutionInvocationMessageRecord["role"], string> = {
  system: `${SUBPANEL_CLASS} p-3`,
  user: `${SUBPANEL_CLASS} p-3`,
  assistant: `${SUBPANEL_CLASS} p-3`,
  tool: `${SUBPANEL_CLASS} p-3 font-mono text-xs`,
};

const ROLE_ICON_CLASS: Record<ExecutionInvocationMessageRecord["role"], string> = {
  system: STATUS_TONE_CLASS.neutral,
  user: STATUS_TONE_CLASS.cyan,
  assistant: STATUS_TONE_CLASS.positive,
  tool: STATUS_TONE_CLASS.signal,
};

function formatStatsDurationLabel(invocation: ExecutionInvocationRecord): string {
  if (!invocation.finishedAt) {
    return "running";
  }

  const startedAtMs = Date.parse(invocation.startedAt);
  const finishedAtMs = Date.parse(invocation.finishedAt);
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(finishedAtMs)) {
    return "running";
  }

  return formatStatsDuration(Math.max(0, finishedAtMs - startedAtMs));
}

function renderStatusChip(status: ExecutionInvocationRecord["status"]): JSX.Element {
  const baseClass = "inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.16em]";

  switch (status) {
    case "running":
      return <span className={`${baseClass} ${STATUS_TONE_CLASS.signal}`}>Running</span>;
    case "completed":
      return <span className={`${baseClass} ${STATUS_TONE_CLASS.positive}`}>Completed</span>;
    case "failed":
      return <span className={`${baseClass} ${STATUS_TONE_CLASS.negative}`}>Failed</span>;
    case "cancelled":
      return <span className={`${baseClass} ${STATUS_TONE_CLASS.neutral}`}>Cancelled</span>;
    case "paused":
      return <span className={`${baseClass} ${STATUS_TONE_CLASS.warning}`}>Paused</span>;
    default:
      return <span className={`${baseClass} ${STATUS_TONE_CLASS.neutral}`}>{status}</span>;
  }
}

function getNumberMetadata(metadata: Record<string, unknown> | null | undefined, keys: string[]): number | null {
  if (!metadata) {
    return null;
  }

  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }

  return null;
}

function getStringMetadata(metadata: Record<string, unknown> | null | undefined, keys: string[]): string | null {
  if (!metadata) {
    return null;
  }

  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }

  return null;
}

function buildMessageMetadata(message: ExecutionInvocationMessageRecord): string[] {
  const metadata = message.metadata;
  const tokens = getNumberMetadata(metadata, ["totalTokens", "tokens", "tokenCount"]);
  const inputTokens = getNumberMetadata(metadata, ["inputTokens", "promptTokens"]);
  const outputTokens = getNumberMetadata(metadata, ["outputTokens", "completionTokens"]);
  const costUsd = getNumberMetadata(metadata, ["costUsd", "cost"]);
  const costCents = getNumberMetadata(metadata, ["costCents"]);
  const kind = getStringMetadata(metadata, ["kind", "type"]);
  const toolName = getStringMetadata(metadata, ["toolName", "tool"]);
  const labels: string[] = [];

  if (kind) {
    labels.push(kind);
  }
  if (toolName) {
    labels.push(toolName);
  }
  if (tokens !== null) {
    labels.push(`${formatTokens(tokens)} tokens`);
  } else if (inputTokens !== null || outputTokens !== null) {
    labels.push(`${formatTokens(inputTokens ?? 0)} in / ${formatTokens(outputTokens ?? 0)} out`);
  }
  if (costUsd !== null) {
    labels.push(formatCost(costUsd));
  } else if (costCents !== null) {
    labels.push(formatCost(costCents / 100));
  }

  return labels;
}

export const InvocationMessagesPanel: FunctionComponent<InvocationMessagesPanelProps> = ({ invocation }) => {
  const [messages, setMessages] = useState<ExecutionInvocationMessageRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAllMessages, setShowAllMessages] = useState(false);
  const [expandedSystemMessages, setExpandedSystemMessages] = useState<Record<string, boolean>>({});
  const messageCount = invocation.messageCount ?? 0;

  useEffect(() => {
    let active = true;

    setLoading(true);
    setError(null);
    setMessages([]);
    setShowAllMessages(false);
    setExpandedSystemMessages({});

    void fetchInvocationMessages(invocation.id)
      .then((nextMessages) => {
        if (!active) {
          return;
        }
        setMessages(nextMessages);
      })
      .catch((fetchError: unknown) => {
        if (!active) {
          return;
        }
        setError(fetchError instanceof Error ? fetchError.message : String(fetchError));
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [invocation.id]);

  const visibleMessages = useMemo(
    () => (showAllMessages ? messages : messages.slice(0, 20)),
    [messages, showAllMessages],
  );

  const toggleSystemMessage = (messageId: string) => {
    setExpandedSystemMessages((current) => ({
      ...current,
      [messageId]: !current[messageId],
    }));
  };

  return (
    <div
      id={`invocation-messages-${invocation.id}`}
      role="region"
      aria-label={`Invocation ${invocation.id} message transcript`}
      aria-busy={loading ? "true" : undefined}
      className={`${SUBPANEL_CLASS} mt-2 max-h-[560px] w-full min-w-0 max-w-full space-y-4 overflow-y-auto p-3 text-[color:var(--stats-detail-color)] sm:p-4`}
    >
      {invocation.lastErrorMessage ? (
        <details className="mb-4 group">
          <summary className={`cursor-pointer list-none rounded px-1 text-sm font-bold uppercase tracking-[0.16em] text-[color:var(--stats-negative-text)] transition-colors ${CONTROL_FOCUS_CLASS}`}>
            Error Summary
          </summary>
          <div className={`mt-2 whitespace-pre-wrap break-words rounded-2xl p-4 text-sm leading-relaxed [overflow-wrap:anywhere] ${STATUS_TONE_CLASS.negative}`}>
            {invocation.lastErrorMessage}
          </div>
        </details>
      ) : null}

      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-[color:var(--stats-label-color)]">
              Message transcript
            </div>
            <div className="text-[11px] text-[color:var(--stats-detail-color)]">
              {formatDateTime(invocation.lastMessageAt)}
            </div>
          </div>
          <button
            type="button"
            onClick={() => navigator.clipboard.writeText(JSON.stringify(messages, null, 2))}
            aria-label="Copy as JSON"
            className={`rounded p-1 text-[color:var(--stats-label-color)] hover:text-[color:var(--stats-value-color)] ${CONTROL_FOCUS_CLASS}`}
          >
            <Clipboard className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-sm">
          <div className={`${CHIP_CLASS} rounded-full px-2.5 py-1 text-[color:var(--stats-value-color)]`}>
            {invocation.model || "Unknown model"}
          </div>
          {renderStatusChip(invocation.status)}
          <div className={`${CHIP_CLASS} rounded-full px-2.5 py-1 text-[color:var(--stats-detail-color)]`}>
            {formatStatsDurationLabel(invocation)}
          </div>
          <div className={`${CHIP_CLASS} rounded-full px-2.5 py-1 text-[color:var(--stats-detail-color)]`}>
            {formatTokens(invocation.totalTokens ?? 0)} total tokens
          </div>
          <div className={`${CHIP_CLASS} rounded-full px-2.5 py-1 text-[color:var(--stats-detail-color)]`}>
            {formatTokens(invocation.inputTokens ?? 0)} in / {formatTokens(invocation.outputTokens ?? 0)} out
          </div>
          {invocation.cachedInputTokens && invocation.cachedInputTokens > 0 ? (
            <div className={`${CHIP_CLASS} rounded-full px-2.5 py-1 text-[color:var(--stats-detail-color)]`}>
              {formatTokens(invocation.cachedInputTokens)} cached
            </div>
          ) : null}
          <div className={`${CHIP_CLASS} rounded-full px-2.5 py-1 text-[color:var(--stats-detail-color)]`}>
            {messageCount.toLocaleString()} messages
          </div>
        </div>

        {invocation.lastErrorMessage ? (
          <div className={`whitespace-pre-wrap break-words rounded-xl px-3 py-2 text-sm leading-relaxed [overflow-wrap:anywhere] ${STATUS_TONE_CLASS.negative}`}>
            {invocation.lastErrorMessage}
          </div>
        ) : null}
      </div>

      {loading ? (
        <div role="status" aria-live="polite" aria-busy="true" className={`${SUBPANEL_CLASS} flex items-center gap-2 px-3 py-3 text-sm text-[color:var(--stats-label-color)]`}>
          <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />
          Loading messages
        </div>
      ) : error ? (
        <div role="alert" className={`rounded-xl px-3 py-3 text-sm ${STATUS_TONE_CLASS.negative}`}>
          Failed to load invocation messages — {error}
        </div>
      ) : messages.length === 0 ? (
        <div role="status" aria-live="polite" className={`${SUBPANEL_CLASS} px-3 py-4 text-sm text-[color:var(--stats-label-color)]`}>
          No messages recorded for this invocation
        </div>
      ) : (
        <div className="space-y-3">
          {visibleMessages.map((message, index) => {
            const isSystem = message.role === "system";
            const isExpanded = Boolean(expandedSystemMessages[message.id]);
            const metadataLabels = buildMessageMetadata(message);
            const isErrorMessage = /\berror\b|\bfailed\b|\bexception\b/i.test(message.contentMarkdown);
            const contentStyle = isSystem && !isExpanded
              ? ({
                display: "-webkit-box",
                WebkitBoxOrient: "vertical",
                WebkitLineClamp: 5,
                overflow: "hidden",
                overflowWrap: "anywhere",
              } as JSX.CSSProperties)
              : undefined;

            return (
              <article
                key={message.id}
                aria-label={`${message.role} message ${index + 1}`}
                className={`${ROLE_CARD_CLASS[message.role]} min-w-0 break-words [overflow-wrap:anywhere] ${isErrorMessage ? "border-l-2 border-l-[color:var(--stats-negative-text)] text-[color:var(--stats-negative-text)]" : ""}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className={`inline-flex h-7 w-7 items-center justify-center rounded-full ${ROLE_ICON_CLASS[message.role]}`} aria-hidden="true">
                      {message.role === "system" ? <Settings className="h-3.5 w-3.5" /> : null}
                      {message.role === "user" ? <User className="h-3.5 w-3.5" /> : null}
                      {message.role === "assistant" ? <Bot className="h-3.5 w-3.5" /> : null}
                      {message.role === "tool" ? <Code2 className="h-3.5 w-3.5" /> : null}
                    </span>
                    <div className="min-w-0">
                      <div className="truncate text-[10px] font-bold uppercase tracking-[0.18em] text-[color:var(--stats-label-color)]">
                        {message.role === "assistant" ? (invocation.model || "ASSISTANT") : message.role.toUpperCase()}
                      </div>
                      <div className="mt-1 text-[10px] text-[color:var(--stats-detail-color)]">{formatDateTime(message.createdAt)}</div>
                    </div>
                  </div>

                  {metadataLabels.length > 0 ? (
                    <div className="flex min-w-0 flex-wrap justify-end gap-1.5">
                      {metadataLabels.map((label) => (
                        <span key={label} className={`${CHIP_CLASS} max-w-full px-2 py-0.5 text-[10px] text-[color:var(--stats-label-color)]`}>
                          <span className="block truncate">{label}</span>
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>

                <pre className={`mt-3 max-w-full whitespace-pre-wrap break-words font-mono text-xs leading-relaxed [overflow-wrap:anywhere] ${isErrorMessage ? "text-[color:var(--stats-negative-text)]" : "text-[color:var(--stats-detail-color)]"}`} style={contentStyle}>
                  {message.contentMarkdown}
                </pre>

                {isSystem ? (
                  <button
                    type="button"
                    onClick={() => toggleSystemMessage(message.id)}
                    aria-expanded={isExpanded}
                    aria-label={`${isExpanded ? "Collapse" : "Expand"} system message ${index + 1}`}
                    className={`mt-2 inline-flex items-center gap-1.5 rounded px-1 text-[10px] font-bold uppercase tracking-[0.16em] text-[color:var(--stats-label-color)] transition-colors hover:text-[color:var(--stats-value-color)] ${CONTROL_FOCUS_CLASS}`}
                  >
                    {isExpanded ? "Show less" : "Show more"}
                  </button>
                ) : null}
              </article>
            );
          })}

          {messages.length > 20 && !showAllMessages ? (
            <button
              type="button"
              onClick={() => setShowAllMessages(true)}
              className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-[11px] font-bold uppercase tracking-[0.18em] text-[color:var(--stats-detail-color)] transition-colors hover:text-[color:var(--stats-value-color)] ${CHIP_CLASS} ${CONTROL_FOCUS_CLASS}`}
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Show all {messages.length} messages
            </button>
          ) : null}

          <div className="flex items-center gap-2 text-[11px] text-[color:var(--stats-detail-color)]">
            <MessageSquare className="h-3.5 w-3.5" />
            Transcript rendered as plain text for readability and safety.
          </div>
        </div>
      )}
    </div>
  );
};
