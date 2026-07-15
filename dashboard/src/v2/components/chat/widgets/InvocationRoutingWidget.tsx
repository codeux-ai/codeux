import { type FunctionComponent } from "preact";
import { ProviderLogo } from "../../ui/ProviderLogo.js";
import { useDashboardI18n } from "../../../i18n/context.js";
import { chatMessages } from "../../../i18n/messages/chat.js";

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
  const { translate } = useDashboardI18n();
  if (routingStatus === "routing") {
    return (
      <div
        class="flex items-center gap-2.5 rounded-xl bg-black/[0.02] dark:bg-white/[0.02] px-4 py-3"
        role="status"
        aria-label={translate(chatMessages, "routingToProvider")}
      >
        <span class="relative flex h-4 w-4 items-center justify-center">
          <span class="absolute inline-flex h-full w-full rounded-full bg-signal-500/30 motion-safe:animate-ping" />
          <span class="relative inline-flex h-2 w-2 rounded-full bg-signal-500" />
        </span>
        <span class="text-[11px] text-slate-400 dark:text-slate-500">
          {translate(chatMessages, "routingToNamedProvider", { provider: provider || translate(chatMessages, "providerFallback") })}
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
      class="flex items-center gap-3 rounded-xl bg-black/[0.02] dark:bg-white/[0.02] px-4 py-3"
      role="status"
      aria-label={translate(chatMessages, "providerLabel", { provider: cliName || provider || translate(chatMessages, "unknown") })}
    >
      <ProviderLogo provider={provider || ""} size={18} />
      <div class="flex items-center gap-2">
        <span class="font-medium text-[12px] text-slate-700 dark:text-slate-200">
          {cliName || provider || translate(chatMessages, "unknownProvider")}
        </span>
        {model && (
          <span class="px-1.5 py-0.5 text-[10px] font-mono text-slate-400 dark:text-slate-500 bg-black/[0.04] dark:bg-white/[0.04] rounded-md">
            {model}
          </span>
        )}
      </div>
    </div>
  );
};
