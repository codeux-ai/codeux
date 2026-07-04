import { type FunctionComponent } from "preact";
import { Terminal, CheckCircle2, AlertCircle } from "lucide-preact";

export interface InvocationContainerWidgetProps {
  containerPhase: 'starting' | 'working' | 'completed' | 'failed';
  providerName?: string | null;
  agentName?: string | null;
}

export const InvocationContainerWidget: FunctionComponent<InvocationContainerWidgetProps> = ({
  containerPhase,
  providerName,
  agentName
}) => {
  if (containerPhase === "starting") {
    return (
      <div
        class="flex items-center gap-3 rounded-xl transition-all duration-300 bg-black/[0.02] dark:bg-white/[0.02] px-4 py-3"
        role="status"
        aria-label="Initializing container"
      >
        <span class="relative flex h-4 w-4 items-center justify-center">
          <span class="absolute inline-flex h-full w-full rounded-full bg-signal-500/25 motion-safe:animate-ping" />
          <span class="relative inline-flex h-2 w-2 rounded-full bg-signal-500" />
        </span>
        <span class="text-[11px] text-slate-400 dark:text-slate-500">
          Initializing...
        </span>
      </div>
    );
  }

  if (containerPhase === "working") {
    return (
      <div
        class="flex items-center gap-3 rounded-xl transition-all duration-300 bg-black/[0.02] dark:bg-white/[0.02] px-4 py-3"
        role="status"
        aria-label="Container working"
      >
        <div class="flex h-7 w-7 items-center justify-center rounded-lg bg-signal-500/[0.08]">
          <Terminal size={16} class="text-signal-600 dark:text-signal-400" />
        </div>
        <div class="flex items-center gap-2">
          <span class="text-[12px] font-medium text-slate-600 dark:text-slate-300">
            Working
          </span>
          <span class="flex items-center gap-[3px]">
            <span class="h-1 w-1 rounded-full bg-signal-500/60 motion-safe:animate-bounce [animation-delay:0ms]" />
            <span class="h-1 w-1 rounded-full bg-signal-500/60 motion-safe:animate-bounce [animation-delay:120ms]" />
            <span class="h-1 w-1 rounded-full bg-signal-500/60 motion-safe:animate-bounce [animation-delay:240ms]" />
          </span>
          {providerName && (
            <span class="text-[11px] text-slate-400 dark:text-slate-500">
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
