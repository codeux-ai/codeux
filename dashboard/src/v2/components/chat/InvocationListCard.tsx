import type { FunctionComponent } from "preact";
import type { ExecutionInvocationRecord, AgentPreset } from "../../types.js";
import { formatRelativeChatTime } from "../../lib/chat-time.js";
import { Activity, Loader2, MessageSquare } from "lucide-preact";
import { ProviderLogo } from "../ui/ProviderLogo.js";
import { WaveFluid } from "../ui/WaveFluid.js";
import { BorderTrace } from "../ui/BorderTrace.js";
import { AgentSelectAvatarIcon } from "../agents/AgentSelectAvatarIcon.js";

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

const getInvocationAccent = (status: string): string => {
  switch (status) {
    case "running": return "#00E0A0";
    case "completed": return "#00AB84";
    case "failed": return "#E3000F";
    case "paused": return "#F59E0B";
    default: return "#94a3b8";
  }
};

const STATUS_STYLES: Record<string, { dot: string; text: string; bg: string; border: string }> = {
  running: { dot: "bg-signal-500 shadow-[0_0_8px_rgba(0,224,160,0.6)]", text: "text-signal-500", bg: "bg-signal-500/[0.08]", border: "border-signal-500/20" },
  completed: { dot: "bg-[#00AB84] shadow-[0_0_6px_rgba(0,171,132,0.4)]", text: "text-[#00AB84]", bg: "bg-[#00AB84]/[0.08]", border: "border-[#00AB84]/20" },
  failed: { dot: "bg-status-red shadow-[0_0_8px_rgba(227,0,15,0.5)]", text: "text-status-red", bg: "bg-status-red/[0.08]", border: "border-status-red/20" },
  cancelled: { dot: "bg-slate-400", text: "text-slate-400", bg: "bg-slate-500/[0.08]", border: "border-slate-500/20" },
  paused: { dot: "bg-status-amber shadow-[0_0_6px_rgba(245,158,11,0.4)]", text: "text-status-amber", bg: "bg-status-amber/[0.08]", border: "border-status-amber/20" },
};

const DEFAULT_STATUS_STYLE = { dot: "bg-slate-400", text: "text-slate-500", bg: "bg-slate-500/[0.08]", border: "border-slate-500/20" };

const formatInvocationType = (type: string): string =>
  type.replace(/_/g, " ");

export const InvocationListCard: FunctionComponent<{
  invocations: ExecutionInvocationRecord[];
  selectedInvocationId: string | null;
  onSelect: (invocationId: string) => void;
  agentPresets?: AgentPreset[];
}> = ({ invocations, selectedInvocationId, onSelect, agentPresets }) => (
  <div className="space-y-3">
    {invocations.map((invocation) => {
      const accentHex = getInvocationAccent(invocation.status);
      const ss = STATUS_STYLES[invocation.status] || DEFAULT_STATUS_STYLE;
      const isSelected = selectedInvocationId === invocation.id;
      const isRunning = invocation.status === "running";
      const isOptimistic = invocation.id.startsWith("optimistic:");
      const agentPreset = invocation.agentPresetId
        ? agentPresets?.find(p => p.id === invocation.agentPresetId)
        : undefined;

      return (
        <div key={invocation.id} className="group relative overflow-hidden rounded-[1.75rem]">
          <button
            type="button"
            onClick={() => onSelect(invocation.id)}
            className={`w-full rounded-[1.75rem] p-5 text-left transition-all duration-200
              bg-white/70 dark:bg-void-800/60 backdrop-blur-2xl
              shadow-[0_2px_20px_rgba(0,0,0,0.04)] dark:shadow-[0_4px_24px_rgba(0,0,0,0.2)]
              ${isOptimistic ? "opacity-70" : ""}
              ${isSelected
                ? "border-2 border-signal-500/30 shadow-[0_0_24px_rgba(0,224,160,0.08)]"
                : "border-2 border-black/[0.06] dark:border-white/[0.06] hover:border-slate-300 dark:hover:border-white/[0.12]"
              }`}
          >
            <WaveFluid accentHex={accentHex} isActive={isRunning} />
            <BorderTrace accentHex={accentHex} />

            {/* Ghost ID watermark */}
            <div
              aria-hidden
              className="absolute -right-2 -top-4 font-black font-display text-[5rem] leading-none tracking-tighter text-black/[0.02] dark:text-white/[0.015] pointer-events-none select-none"
            >
              {invocation.id.slice(0, 6)}
            </div>

            <div className="relative z-10">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3.5 min-w-0 flex-1">
                  {/* Icon blob */}
                  <div
                    className="w-10 h-10 rounded-[0.875rem] flex items-center justify-center shrink-0 mt-0.5"
                    style={{ backgroundColor: `${accentHex}14` }}
                  >
                    {agentPreset ? (
                      <AgentSelectAvatarIcon avatarConfig={agentPreset.avatarConfig} seed={`${agentPreset.id}:${agentPreset.name}`} />
                    ) : (
                      <ProviderLogo provider={invocation.provider || ""} size={20} />
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    {/* Badges row */}
                    <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                      <span className="font-mono text-[10px] font-bold px-2 py-0.5 rounded-lg bg-black/[0.04] dark:bg-white/[0.04] text-slate-400">
                        {invocation.id.slice(0, 8)}
                      </span>
                      {/* Status pill */}
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-[0.14em] ${ss.bg} ${ss.text} border ${ss.border}`}>
                        <span className={`inline-block w-1.5 h-1.5 rounded-full ${ss.dot} ${isRunning ? "animate-pulse" : ""}`} />
                        {invocation.status}
                      </span>
                      {isOptimistic && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-slate-500/20 bg-slate-500/[0.08] px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-slate-400">
                          <Loader2 className="h-2.5 w-2.5 animate-spin" />
                          Pending
                        </span>
                      )}
                      {(invocation.sprintId || invocation.taskId) && (
                        <span className="rounded-full border border-black/[0.06] bg-black/[0.03] px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-slate-400">
                          {invocation.taskId ? "Task" : "Sprint"}
                        </span>
                      )}
                      {formatErrorCategory(invocation.lastErrorCategory) && (
                        <span className="rounded-full border border-status-amber/30 bg-status-amber/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-status-amber">
                          {formatErrorCategory(invocation.lastErrorCategory)}
                        </span>
                      )}
                      {invocation.invocationSource === "EXTERNAL_API" && (
                        <span className="rounded-full bg-signal-500/10 px-1.5 py-0.5" title="External API">
                          <Activity className="h-3 w-3 text-signal-500" />
                        </span>
                      )}
                    </div>

                    {/* Title */}
                    <h3 className="font-display text-lg font-black tracking-tight text-slate-900 dark:text-white leading-snug capitalize">
                      {formatInvocationType(invocation.type)}
                    </h3>

                    {/* Provider + agent line */}
                    <div className="mt-2 flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                      <ProviderLogo provider={invocation.provider || ""} size={16} />
                      <span className="font-medium">{invocation.provider}</span>
                      {invocation.model && (
                        <span className="text-slate-400 dark:text-slate-500">{invocation.model}</span>
                      )}
                      {agentPreset && (
                        <>
                          <span className="text-slate-300 dark:text-slate-600">|</span>
                          <span className="font-medium truncate max-w-[120px]">{agentPreset.name}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/* Right column */}
                <div className="shrink-0 flex flex-col items-end gap-1.5 pt-0.5">
                  <div className="text-[10px] font-mono text-slate-400 dark:text-slate-500">
                    {formatRelativeChatTime(invocation.lastMessageAt || invocation.createdAt)}
                  </div>
                  {invocation.messageCount > 0 && (
                    <div className="flex items-center gap-1 text-[10px] font-mono text-slate-400 dark:text-slate-500">
                      <MessageSquare className="w-3 h-3" strokeWidth={2} />
                      {invocation.messageCount}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </button>
        </div>
      );
    })}
  </div>
);
