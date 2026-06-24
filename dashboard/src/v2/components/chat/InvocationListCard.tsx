import type { ComponentChildren, FunctionComponent } from "preact";
import { useState } from "preact/hooks";
import type { ExecutionInvocationRecord, AgentPreset } from "../../types.js";
import { formatRelativeChatTime } from "../../lib/chat-time.js";
import { Loader2, BarChart3 } from "lucide-preact";
import { ProviderLogo } from "../ui/ProviderLogo.js";
import { WaveFluid } from "../ui/WaveFluid.js";
import { BorderTrace } from "../ui/BorderTrace.js";
import { AgentSelectAvatarIcon } from "../agents/AgentSelectAvatarIcon.js";
import { useInteractionTokens } from "../../lib/motion/tokens.js";
import { formatTokenCount } from "../../lib/chat-widget-view-models.js";
import { formatInvocationPurpose, formatInvocationDuration, InvocationContextChips } from "./invocation-display.js";

const formatErrorCategory = (value: ExecutionInvocationRecord["lastErrorCategory"]): string | null => {
  switch (value) {
    case "RATE_LIMITED": return "Rate limited";
    case "QUOTA_EXHAUSTED": return "Quota exhausted";
    case "AUTH_FAILURE": return "Auth failure";
    case "PROVIDER_NOT_FOUND": return "Provider missing";
    case "UNKNOWN": return "Error";
    default: return null;
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

const STATUS_STYLES: Record<string, { dot: string; text: string }> = {
  running: { dot: "bg-signal-500 shadow-[0_0_8px_rgba(0,224,160,0.6)]", text: "text-signal-500" },
  completed: { dot: "bg-[#00AB84] shadow-[0_0_6px_rgba(0,171,132,0.4)]", text: "text-[#00AB84]" },
  failed: { dot: "bg-status-red shadow-[0_0_8px_rgba(227,0,15,0.5)]", text: "text-status-red" },
  cancelled: { dot: "bg-slate-400", text: "text-slate-400" },
  paused: { dot: "bg-status-amber shadow-[0_0_6px_rgba(245,158,11,0.4)]", text: "text-status-amber" },
};

const DEFAULT_STATUS_STYLE = { dot: "bg-slate-400", text: "text-slate-500" };

const STATS_VISIBILITY_KEY = "code-ux:invocation-stats-visible";

const readStoredStatsVisibility = (): boolean => {
  try {
    return localStorage.getItem(STATS_VISIBILITY_KEY) !== "false";
  } catch {
    return true;
  }
};

const persistStatsVisibility = (visible: boolean): void => {
  try {
    localStorage.setItem(STATS_VISIBILITY_KEY, visible ? "true" : "false");
  } catch {
    // ignore storage failures (private mode, quota, …)
  }
};

interface StatCell {
  label: string;
  value: ComponentChildren;
  /** Optional value-text color override (e.g. token accents). */
  tone?: string;
  /** Render across both columns (used for the error row). */
  full?: boolean;
}

export const InvocationListCard: FunctionComponent<{
  invocations: ExecutionInvocationRecord[];
  selectedInvocationId: string | null;
  onSelect: (invocationId: string) => void;
  agentPresets?: AgentPreset[];
  sprintKeyPrefix?: string;
}> = ({ invocations, selectedInvocationId, onSelect, agentPresets, sprintKeyPrefix = "SPR" }) => {
  const [showStats, setShowStats] = useState(readStoredStatsVisibility);
  const interactionTokens = useInteractionTokens();

  const toggleStats = () => {
    setShowStats((current) => {
      const next = !current;
      persistStatsVisibility(next);
      return next;
    });
  };

  return (
  <div className="space-y-3">
    {/* List toolbar — toggle the per-card stat tables on/off */}
    <div className="flex items-center justify-end px-1">
      <button
        type="button"
        onClick={toggleStats}
        aria-pressed={showStats}
        title={showStats ? "Hide stats" : "Show stats"}
        style={{
          transitionProperty: "color, background-color, border-color, text-decoration-color, fill, stroke",
          transitionDuration: interactionTokens.controlFeedback.duration,
          transitionTimingFunction: interactionTokens.controlFeedback.ease,
        }}
        className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] ${
          showStats
            ? "border-signal-500/30 bg-signal-500/[0.08] text-signal-600 dark:text-signal-400"
            : "border-black/[0.07] bg-black/[0.02] text-slate-400 hover:text-slate-600 dark:border-white/[0.07] dark:bg-white/[0.02] dark:hover:text-slate-200"
        }`}
      >
        <BarChart3 className="h-3.5 w-3.5" />
        Stats
      </button>
    </div>
    {invocations.map((invocation) => {
      const accentHex = getInvocationAccent(invocation.status);
      const ss = STATUS_STYLES[invocation.status] || DEFAULT_STATUS_STYLE;
      const isSelected = selectedInvocationId === invocation.id;
      const isRunning = invocation.status === "running";
      const isOptimistic = invocation.id.startsWith("optimistic:");
      const agentPreset = invocation.agentPresetId
        ? agentPresets?.find((p) => p.id === invocation.agentPresetId)
        : undefined;

      const errorLabel = formatErrorCategory(invocation.lastErrorCategory);
      const duration = formatInvocationDuration(invocation.startedAt || invocation.createdAt, invocation.finishedAt);
      const totalTokens = invocation.totalTokens
        ?? ((invocation.inputTokens ?? 0) + (invocation.outputTokens ?? 0));

      // The stat table — only meaningful rows are shown. Status leads, then the
      // token breakdown, run size and timing. Kept to clean label/value pairs.
      const cells: StatCell[] = [
        {
          label: "Status",
          value: (
            <span className={`flex items-center gap-1.5 ${ss.text}`}>
              <span className={`inline-block h-1.5 w-1.5 rounded-full ${ss.dot} ${isRunning ? "animate-pulse" : ""}`} />
              <span className="capitalize">{isOptimistic ? "Pending" : invocation.status}</span>
            </span>
          ),
        },
        { label: "Messages", value: invocation.messageCount ?? 0 },
      ];
      if ((invocation.inputTokens ?? 0) > 0) {
        cells.push({ label: "Input", value: formatTokenCount(invocation.inputTokens), tone: "text-signal-600 dark:text-signal-400" });
      }
      if ((invocation.outputTokens ?? 0) > 0) {
        cells.push({ label: "Output", value: formatTokenCount(invocation.outputTokens), tone: "text-purple-600 dark:text-purple-400" });
      }
      if ((invocation.cachedInputTokens ?? 0) > 0) {
        cells.push({ label: "Cached", value: formatTokenCount(invocation.cachedInputTokens), tone: "text-teal-600 dark:text-teal-400" });
      }
      if (totalTokens > 0) {
        cells.push({ label: "Total", value: formatTokenCount(totalTokens) });
      }
      if (duration) {
        cells.push({ label: "Duration", value: duration });
      }
      if (errorLabel) {
        cells.push({ label: "Error", value: errorLabel, tone: "text-status-amber", full: true });
      }
      // Balance the grid: a lone trailing cell stretches across both columns.
      const lastIndex = cells.length - 1;
      const stretchLast = cells.length % 2 === 1 && !cells[lastIndex].full;

      return (
        <div key={invocation.id} className="group relative overflow-hidden rounded-[1.5rem]">
          {/* Rendered as a clickable div (not a button) so the sprint/task links
              below can be real anchors without nesting interactive elements. */}
          <div
            role="button"
            tabIndex={0}
            aria-selected={isSelected ? "true" : "false"}
            onClick={() => onSelect(invocation.id)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelect(invocation.id);
              }
            }}
            style={{
              transitionProperty: "all",
              transitionDuration: interactionTokens.controlFeedback.duration,
              transitionTimingFunction: interactionTokens.controlFeedback.ease,
            }}
            className={`w-full cursor-pointer rounded-[1.5rem] p-4 text-left
              bg-white/70 dark:bg-void-800/60 backdrop-blur-2xl
              shadow-[0_2px_20px_rgba(0,0,0,0.04)] dark:shadow-[0_4px_24px_rgba(0,0,0,0.2)]
              ${isOptimistic ? "opacity-70" : ""}
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500
              ${isSelected
                ? "border-2 border-signal-500/30 shadow-[0_0_24px_rgba(0,224,160,0.08)]"
                : "border-2 border-black/[0.06] dark:border-white/[0.06] hover:border-slate-400 dark:hover:border-white/[0.2]"
              }`}
          >
            <WaveFluid accentHex={accentHex} isActive={isRunning} />
            <BorderTrace accentHex={accentHex} />

            <div className="relative z-10">
              {/* Header: icon + purpose/model, plus relative time */}
              <div className="flex items-start gap-3">
                <div
                  className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
                  style={{ backgroundColor: `${accentHex}14` }}
                >
                  {agentPreset ? (
                    <AgentSelectAvatarIcon avatarConfig={agentPreset.avatarConfig} seed={`${agentPreset.id}:${agentPreset.name}`} />
                  ) : (
                    <ProviderLogo provider={invocation.provider || ""} size={18} />
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <h3 className="truncate font-display text-[15px] font-bold leading-tight tracking-tight text-slate-900 dark:text-white">
                    {formatInvocationPurpose(invocation.type)}
                  </h3>
                  <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                    {isOptimistic && <Loader2 className="h-3 w-3 animate-spin" />}
                    <span className="truncate font-medium">
                      {invocation.provider || "—"}
                      {invocation.model ? <span className="text-slate-400 dark:text-slate-500"> · {invocation.model}</span> : null}
                    </span>
                    {agentPreset && (
                      <>
                        <span className="text-slate-300 dark:text-slate-600">·</span>
                        <span className="truncate font-medium">{agentPreset.name}</span>
                      </>
                    )}
                  </div>
                </div>

                <span className="shrink-0 pt-0.5 font-mono text-[10px] text-slate-400 dark:text-slate-500">
                  {formatRelativeChatTime(invocation.lastMessageAt || invocation.createdAt)}
                </span>
              </div>

              {/* Sprint key / task number — linked to their respective pages */}
              <div className="mt-2.5 empty:hidden">
                <InvocationContextChips invocation={invocation} sprintKeyPrefix={sprintKeyPrefix} />
              </div>

              {/* Stat table — clean 2-column label/value grid */}
              <div
                style={{
                  display: "grid",
                  gridTemplateRows: showStats ? "1fr" : "0fr",
                  transitionProperty: "grid-template-rows",
                  transitionDuration: interactionTokens.expansionCollapse.duration,
                  transitionTimingFunction: interactionTokens.expansionCollapse.ease,
                }}
              >
                <div className="overflow-hidden">
                  <div className={`mt-3 grid grid-cols-2 overflow-hidden rounded-xl border border-black/[0.05] bg-black/[0.015] dark:border-white/[0.06] dark:bg-white/[0.02] ${!showStats ? "invisible" : ""}`}>
                    {cells.map((cell, idx) => {
                      const full = cell.full || (stretchLast && idx === lastIndex);
                      return (
                        <div
                          key={cell.label}
                          className={`flex items-center justify-between gap-2 px-2.5 py-1.5
                            ${full ? "col-span-2" : ""}
                            ${!full && idx % 2 === 1 ? "border-l border-black/[0.05] dark:border-white/[0.06]" : ""}
                            ${idx >= 2 ? "border-t border-black/[0.05] dark:border-white/[0.06]" : ""}`}
                        >
                          <span className="truncate text-[8px] font-semibold uppercase tracking-[0.1em] text-slate-400 dark:text-slate-500">
                            {cell.label}
                          </span>
                          <span className={`shrink-0 whitespace-nowrap font-mono text-[10px] font-semibold tabular-nums ${cell.tone || "text-slate-700 dark:text-slate-200"}`}>
                            {cell.value}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Invocation id — tiny, bottom-right */}
              <div className="mt-2 text-right font-mono text-[10px] text-slate-300 dark:text-slate-600">
                {invocation.id}
              </div>
            </div>
          </div>
        </div>
      );
    })}
  </div>
  );
};
