import { h, FunctionComponent } from "preact";
import { ChatWidgetFrame } from "./ChatWidgetFrame";
import { ProviderLogo } from "../../ui/ProviderLogo";

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
  const frameStatus = routingStatus === "routing" ? "running" : routingStatus === "active" ? "running" : "completed";

  const providerKey = (provider || "").toLowerCase();
  let borderColor = "border-slate-300 dark:border-slate-700";
  let pulseColor = "bg-slate-400";

  if (providerKey.includes("claude")) {
    borderColor = "border-[#FF6B2B]";
    pulseColor = "bg-[#FF6B2B]";
  } else if (providerKey.includes("gemini")) {
    borderColor = "border-[#4285F4]";
    pulseColor = "bg-[#4285F4]";
  } else if (providerKey.includes("codex")) {
    borderColor = "border-[#10B981]";
    pulseColor = "bg-[#10B981]";
  }

  return (
    <ChatWidgetFrame status={frameStatus}>
      <div class={`-m-3 p-3 border-l-4 ${borderColor}`}>
        {routingStatus === "routing" ? (
          <div class="flex items-center gap-2 text-slate-600 dark:text-slate-400">
            <span class={`w-2 h-2 rounded-full animate-pulse ${pulseColor}`} />
            <span>Routing to provider...</span>
          </div>
        ) : (
          <div
            class="flex items-center gap-3 motion-safe:animate-[slide-in-up_300ms_ease-out_forwards]"
            style={{
              animationName: "slide-in-up",
              animationDuration: "300ms",
              animationTimingFunction: "ease-out",
              animationFillMode: "forwards"
            }}
          >
            <style>
              {`
                @keyframes slide-in-up {
                  0% { opacity: 0; transform: translateY(8px); }
                  100% { opacity: 1; transform: translateY(0); }
                }
                @media (prefers-reduced-motion: reduce) {
                  .motion-safe\\:animate-\\[slide-in-up_300ms_ease-out_forwards\\] {
                    animation: none !important;
                    opacity: 1 !important;
                    transform: none !important;
                  }
                }
              `}
            </style>
            <ProviderLogo provider={provider || ""} size={20} />
            <div class="flex items-center gap-2">
              <span class="font-medium text-slate-900 dark:text-slate-100">
                {cliName || provider || "Unknown Provider"}
              </span>
              {model && (
                <span class="px-2 py-0.5 text-xs font-mono bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 rounded-md">
                  {model}
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </ChatWidgetFrame>
  );
};
