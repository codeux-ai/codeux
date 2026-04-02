import type { FunctionComponent } from "preact";
import type { ExecutionInvocationRecord } from "../../types.js";
import { formatRelativeChatTime } from "../../lib/chat-time.js";
import { ChatAvatar } from "./ChatAvatar.js";
import { ChatRuntimeBadge } from "./ChatRuntimeBadge.js";

const formatErrorCategory = (value: ExecutionInvocationRecord["lastErrorCategory"]): string | null => {
  switch (value) {
    case "RATE_LIMITED":
      return "Rate limit";
    case "QUOTA_EXHAUSTED":
      return "Quota";
    case "AUTH_FAILURE":
      return "Auth";
    case "PROVIDER_NOT_FOUND":
      return "Provider";
    case "UNKNOWN":
      return "Error";
    default:
      return null;
  }
};

export const InvocationListCard: FunctionComponent<{
  invocations: ExecutionInvocationRecord[];
  selectedInvocationId: string | null;
  onSelect: (invocationId: string) => void;
}> = ({ invocations, selectedInvocationId, onSelect }) => (
  <div className="space-y-3">
    {invocations.map((invocation) => (
      <div key={invocation.id} className="relative overflow-hidden rounded-[1.25rem]">
        <button
          type="button"
          onClick={() => onSelect(invocation.id)}
          className={`w-full rounded-[1.25rem] border px-4 py-3 text-left transition-colors duration-150 ${
            selectedInvocationId === invocation.id
              ? "border-signal-500/30 bg-signal-500/10"
              : "border-black/[0.05] bg-black/[0.03] hover:border-slate-300 hover:bg-black/[0.05] dark:border-white/[0.05] dark:bg-white/[0.03] dark:hover:border-white/[0.12] dark:hover:bg-white/[0.05]"
          }`}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-1 items-start gap-3 min-w-0">
              <div className="relative shrink-0">
                <ChatAvatar role="system" />
                <div className="absolute -bottom-1 -right-1 rounded-full bg-white dark:bg-void-900 p-[2px]">
                  <ChatRuntimeBadge status={invocation.status === "failed" ? "failed" : invocation.status === "completed" ? "completed" : "running"} />
                </div>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <div className="truncate font-display text-lg font-black tracking-tight text-slate-900 dark:text-white capitalize">
                    {invocation.type}
                  </div>
                  {(invocation.sprintId || invocation.taskId) && (
                    <div className="shrink-0 rounded border border-black/[0.06] bg-black/[0.03] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-slate-400">
                      {invocation.taskId ? "Task" : "Sprint"}
                    </div>
                  )}
                  {formatErrorCategory(invocation.lastErrorCategory) && (
                    <div className="shrink-0 rounded border border-status-amber/30 bg-status-amber/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-status-amber">
                      {formatErrorCategory(invocation.lastErrorCategory)}
                    </div>
                  )}
                </div>
                <div className="mt-1 line-clamp-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400 capitalize">
                  {invocation.provider} {invocation.model && `· ${invocation.model}`}
                </div>
              </div>
            </div>
            <div className="shrink-0 text-right">
            <div className={`text-[10px] font-bold uppercase tracking-[0.14em] ${invocation.status === "failed" ? "text-status-red" : invocation.status === "completed" ? "text-signal-500" : "text-slate-500"}`}>
                {invocation.status}
              </div>
              <div className="mt-1 text-[10px] font-mono text-slate-400">{formatRelativeChatTime(invocation.lastMessageAt || invocation.createdAt)}</div>
            </div>
          </div>
        </button>
      </div>
    ))}
  </div>
);
