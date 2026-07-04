import { type FunctionComponent } from "preact";
import { ProviderLogo } from "../../ui/ProviderLogo.js";

export interface InvocationRoutingWidgetProps {
  provider: string | null;
  model: string | null;
  cliName?: string | null;
  routingStatus: "routing" | "active" | "done";
}

export const InvocationRoutingWidget: FunctionComponent<InvocationRoutingWidgetProps> = ({
  provider,
  model,
  cliName,
  routingStatus,
}) => {
  if (routingStatus === "routing") {
    return (
      <div
        class="flex min-w-0 items-center gap-2.5 rounded-[1.1rem] border border-black/[0.05] bg-white/62 px-4 py-3 shadow-[0_10px_26px_rgba(15,23,42,0.045)] backdrop-blur-xl dark:border-white/[0.06] dark:bg-white/[0.035] dark:shadow-[0_12px_34px_rgba(0,0,0,0.18)]"
        role="status"
        aria-label="Routing to provider"
      >
        <span class="relative flex h-4 w-4 items-center justify-center">
          <span class="absolute inline-flex h-full w-full rounded-full bg-signal-500/30 motion-safe:animate-ping" />
          <span class="relative inline-flex h-2 w-2 rounded-full bg-signal-500" />
        </span>
        <span class="min-w-0 truncate text-[11px] text-slate-500 dark:text-slate-400">
          Routing to {provider || "provider"}
          <span class="inline-flex ml-0.5 gap-[2px] align-middle">
            <span class="inline-block h-[3px] w-[3px] rounded-full bg-slate-400/60 motion-safe:animate-bounce [animation-delay:0ms]" />
            <span class="inline-block h-[3px] w-[3px] rounded-full bg-slate-400/60 motion-safe:animate-bounce [animation-delay:150ms]" />
            <span class="inline-block h-[3px] w-[3px] rounded-full bg-slate-400/60 motion-safe:animate-bounce [animation-delay:300ms]" />
          </span>
        </span>
      </div>
    );
  }

  return (
    <div
      class="flex min-w-0 items-center gap-3 rounded-[1.1rem] border border-black/[0.05] bg-white/62 px-4 py-3 shadow-[0_10px_26px_rgba(15,23,42,0.045)] backdrop-blur-xl dark:border-white/[0.06] dark:bg-white/[0.035] dark:shadow-[0_12px_34px_rgba(0,0,0,0.18)]"
      role="status"
      aria-label={`Provider: ${cliName || provider || "Unknown"}`}
    >
      <ProviderLogo provider={provider || ""} size={18} />
      <div class="flex min-w-0 items-center gap-2">
        <span class="min-w-0 truncate font-medium text-[12px] text-slate-700 dark:text-slate-200">
          {cliName || provider || "Unknown Provider"}
        </span>
        {model && (
          <span class="min-w-0 max-w-[16rem] truncate px-1.5 py-0.5 text-[10px] font-mono text-slate-400 dark:text-slate-500 bg-black/[0.04] dark:bg-white/[0.04] rounded-md">
            {model}
          </span>
        )}
      </div>
    </div>
  );
};
