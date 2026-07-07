import { type FunctionComponent } from "preact";
import { useEffect, useState } from "preact/hooks";
import { Terminal, CheckCircle2, AlertCircle } from "lucide-preact";
import { STATUS_MESSAGE_MIN_INTERVAL_MS, selectAgentHumorMessage } from "../../../lib/agent-humor-messages.js";

export interface InvocationContainerWidgetProps {
  containerPhase: 'starting' | 'working' | 'completed' | 'failed';
  providerName?: string | null;
  modelName?: string | null;
  agentName?: string | null;
  nowMs?: number | null;
}

const getCurrentNowMs = (): number => (
  typeof window === "undefined" ? 0 : Date.now()
);

const useStatusMessageNowMs = (nowMs: number | null | undefined): number => {
  const [currentNowMs, setCurrentNowMs] = useState(getCurrentNowMs);

  useEffect(() => {
    if (nowMs !== null && nowMs !== undefined) {
      return;
    }
    const interval = window.setInterval(() => {
      setCurrentNowMs(Date.now());
    }, STATUS_MESSAGE_MIN_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [nowMs]);

  return nowMs ?? currentNowMs;
};

export const InvocationContainerWidget: FunctionComponent<InvocationContainerWidgetProps> = ({
  containerPhase,
  providerName,
  modelName,
  agentName,
  nowMs,
}) => {
  const statusNowMs = useStatusMessageNowMs(nowMs);
  const activeStatusMessage = containerPhase === "starting" || containerPhase === "working"
    ? selectAgentHumorMessage({
      category: containerPhase,
      seed: ["invocation-container", agentName ?? "", providerName ?? "", modelName ?? "", containerPhase].join("|"),
      nowMs: statusNowMs,
    })
    : null;

  if (containerPhase === "starting") {
    return (
      <div
        class="flex min-w-0 items-center gap-3 rounded-xl transition-all duration-300 bg-black/[0.02] dark:bg-white/[0.02] px-4 py-3"
        role="status"
        aria-label="Initializing container"
      >
        <span class="relative flex h-4 w-4 items-center justify-center">
          <span class="absolute inline-flex h-full w-full rounded-full bg-signal-500/25 motion-safe:animate-ping" />
          <span class="relative inline-flex h-2 w-2 rounded-full bg-signal-500" />
        </span>
        <span class="min-w-0 max-w-full break-words text-[11px] leading-snug text-slate-400 dark:text-slate-500">
          {activeStatusMessage}
        </span>
      </div>
    );
  }

  if (containerPhase === "working") {
    return (
      <div
        class="flex min-w-0 items-center gap-3 rounded-xl transition-all duration-300 bg-black/[0.02] dark:bg-white/[0.02] px-4 py-3"
        role="status"
        aria-label="Container working"
      >
        <div class="flex h-7 w-7 items-center justify-center rounded-lg bg-signal-500/[0.08]">
          <Terminal size={16} class="text-signal-600 dark:text-signal-400" />
        </div>
        <div class="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <span class="min-w-0 max-w-full break-words text-[12px] font-medium leading-snug text-slate-600 dark:text-slate-300">
            {activeStatusMessage}
          </span>
          <span class="flex items-center gap-[3px]">
            <span class="h-1 w-1 rounded-full bg-signal-500/60 motion-safe:animate-bounce [animation-delay:0ms]" />
            <span class="h-1 w-1 rounded-full bg-signal-500/60 motion-safe:animate-bounce [animation-delay:120ms]" />
            <span class="h-1 w-1 rounded-full bg-signal-500/60 motion-safe:animate-bounce [animation-delay:240ms]" />
          </span>
          {providerName && (
            <span class="min-w-0 max-w-full truncate text-[11px] text-slate-400 dark:text-slate-500">
              via {providerName}
            </span>
          )}
        </div>
      </div>
    );
  }

  if (containerPhase === "completed") {
    return (
      <div
        class="flex items-center gap-3 rounded-xl transition-all duration-300 bg-black/[0.02] dark:bg-white/[0.02] px-4 py-3"
        role="status"
        aria-label="Container completed"
      >
        <div class="flex h-7 w-7 items-center justify-center rounded-lg bg-status-green/[0.08]">
          <CheckCircle2 size={16} class="text-status-green" />
        </div>
        <div class="flex items-center gap-2">
          <span class="text-[12px] font-medium text-slate-600 dark:text-slate-300">
            Completed
          </span>
          {agentName && (
            <span class="text-[11px] text-slate-400 dark:text-slate-500">
              by {agentName}
            </span>
          )}
        </div>
      </div>
    );
  }

  // failed
  return (
    <div
      class="flex items-center gap-3 rounded-xl transition-all duration-300 bg-black/[0.02] dark:bg-white/[0.02] px-4 py-3"
      role="status"
      aria-label="Container failed"
    >
      <div class="flex h-7 w-7 items-center justify-center rounded-lg bg-status-red/[0.08]">
        <AlertCircle size={16} class="text-status-red" />
      </div>
      <span class="text-[12px] font-medium text-slate-600 dark:text-slate-300">
        Failed
      </span>
    </div>
  );
};
