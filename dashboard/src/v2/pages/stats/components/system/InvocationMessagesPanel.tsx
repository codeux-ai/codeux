import type { FunctionComponent, JSX } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import {
  Bot,
  Code2,
  ExternalLink,
  Loader2,
  MessageSquare,
  Settings,
  User,
} from "lucide-preact";
import type { ExecutionInvocationMessageRecord, ExecutionInvocationRecord } from "../../../../types.js";
import { fetchInvocationMessages } from "../../../../lib/invocation-api.js";
import { formatDateTime, formatDuration, formatTokens } from "../../stats-utils.js";

interface InvocationMessagesPanelProps {
  invocation: ExecutionInvocationRecord;
  id?: string;
}

const ROLE_CARD_CLASS: Record<ExecutionInvocationMessageRecord["role"], string> = {
  system: "rounded-xl bg-slate-900/70 border border-white/[0.06] p-3",
  user: "rounded-xl bg-void-800/60 p-3",
  assistant: "rounded-xl bg-void-700/50 p-3",
  tool: "rounded-xl bg-void-900/80 border border-white/[0.04] p-3 font-mono text-xs",
};

const ROLE_ICON_CLASS: Record<ExecutionInvocationMessageRecord["role"], string> = {
  system: "bg-slate-800 text-slate-200",
  user: "bg-sky-500/10 text-sky-300",
  assistant: "bg-emerald-500/10 text-emerald-300",
  tool: "bg-violet-500/10 text-violet-300",
};

function formatDurationLabel(invocation: ExecutionInvocationRecord): string {
  if (!invocation.finishedAt) {
    return "running";
  }

  const startedAtMs = Date.parse(invocation.startedAt);
  const finishedAtMs = Date.parse(invocation.finishedAt);
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(finishedAtMs)) {
    return "running";
  }

  return formatDuration(Math.max(0, finishedAtMs - startedAtMs));
}

function renderStatusChip(status: ExecutionInvocationRecord["status"]): JSX.Element {
  const baseClass = "inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.16em]";

  switch (status) {
    case "running":
      return <span className={`${baseClass} bg-blue-500/15 text-blue-300`}>Running</span>;
    case "completed":
      return <span className={`${baseClass} bg-emerald-500/15 text-emerald-300`}>Completed</span>;
    case "failed":
      return <span className={`${baseClass} bg-red-500/15 text-red-300`}>Failed</span>;
    case "cancelled":
      return <span className={`${baseClass} bg-slate-500/15 text-slate-300`}>Cancelled</span>;
    case "paused":
      return <span className={`${baseClass} bg-amber-500/15 text-amber-300`}>Paused</span>;
    default:
      return <span className={`${baseClass} bg-white/10 text-slate-300`}>{status}</span>;
  }
}

export const InvocationMessagesPanel: FunctionComponent<InvocationMessagesPanelProps> = ({ invocation, id }) => {
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

  const headingId = id ? `${id}-heading` : undefined;

  return (
    <div id={id} role={id ? "region" : undefined} aria-labelledby={headingId} className="mt-2 rounded-2xl bg-slate-950/70 border border-white/[0.05] p-4 space-y-3">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 id={headingId} className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400 m-0">
            Message transcript
          </h3>
          <div className="text-[11px] text-slate-500">
            {formatDateTime(invocation.lastMessageAt)}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-sm">
          <div className="rounded-full border border-white/[0.06] bg-white/[0.03] px-2.5 py-1 text-slate-200">
            {invocation.model || "Unknown model"}
          </div>
          {renderStatusChip(invocation.status)}
          <div className="rounded-full border border-white/[0.06] bg-white/[0.03] px-2.5 py-1 text-slate-300">
            {formatDurationLabel(invocation)}
          </div>
          <div className="rounded-full border border-white/[0.06] bg-white/[0.03] px-2.5 py-1 text-slate-300">
            {formatTokens(invocation.totalTokens ?? 0)} total tokens
          </div>
          <div className="rounded-full border border-white/[0.06] bg-white/[0.03] px-2.5 py-1 text-slate-300">
            {messageCount.toLocaleString()} messages
          </div>
        </div>

        {invocation.lastErrorMessage ? (
          <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {invocation.lastErrorMessage}
          </div>
        ) : null}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 rounded-xl border border-white/[0.05] bg-white/[0.03] px-3 py-3 text-sm text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading messages
        </div>
      ) : error ? (
        <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-3 text-sm text-red-300">
          Failed to load invocation messages — {error}
        </div>
      ) : messages.length === 0 ? (
        <div className="rounded-xl border border-white/[0.05] bg-white/[0.03] px-3 py-4 text-sm text-slate-400">
          No messages recorded for this invocation
        </div>
      ) : (
        <div className="space-y-3">
          {visibleMessages.map((message) => {
            const isSystem = message.role === "system";
            const isExpanded = Boolean(expandedSystemMessages[message.id]);
            const contentStyle = isSystem && !isExpanded
              ? ({
                display: "-webkit-box",
                WebkitBoxOrient: "vertical",
                WebkitLineClamp: 5,
                overflow: "hidden",
              } as JSX.CSSProperties)
              : undefined;

            return (
              <div key={message.id} className={ROLE_CARD_CLASS[message.role]}>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className={`inline-flex h-7 w-7 items-center justify-center rounded-full ${ROLE_ICON_CLASS[message.role]}`}>
                      {message.role === "system" ? <Settings className="h-3.5 w-3.5" /> : null}
                      {message.role === "user" ? <User className="h-3.5 w-3.5" /> : null}
                      {message.role === "assistant" ? <Bot className="h-3.5 w-3.5" /> : null}
                      {message.role === "tool" ? <Code2 className="h-3.5 w-3.5" /> : null}
                    </span>
                    <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
                      {message.role === "assistant" ? (invocation.model || "ASSISTANT") : message.role.toUpperCase()}
                    </div>
                  </div>

                  <div className="text-[10px] text-slate-500">
                    {formatDateTime(message.createdAt)}
                  </div>
                </div>

                <pre className="whitespace-pre-wrap text-xs text-slate-300 mt-2" style={contentStyle}>
                  {message.contentMarkdown}
                </pre>

                {isSystem ? (
                  <button
                    type="button"
                    onClick={() => toggleSystemMessage(message.id)}
                    className="mt-2 inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400 transition-colors hover:text-white"
                  >
                    {isExpanded ? "Show less" : "Show more"}
                  </button>
                ) : null}
              </div>
            );
          })}

          {messages.length > 20 && !showAllMessages ? (
            <button
              type="button"
              onClick={() => setShowAllMessages(true)}
              className="inline-flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-300 transition-colors hover:bg-white/[0.08] hover:text-white"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Show all {messages.length} messages
            </button>
          ) : null}

          <div className="flex items-center gap-2 text-[11px] text-slate-500">
            <MessageSquare className="h-3.5 w-3.5" />
            Transcript rendered as plain text for readability and safety.
          </div>
        </div>
      )}
    </div>
  );
};
