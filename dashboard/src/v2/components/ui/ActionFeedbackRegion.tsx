import { h, type FunctionComponent } from "preact";
import { X, CheckCircle, AlertTriangle, XCircle, Loader2 } from "lucide-preact";
import type { ActionFeedbackStatus } from "../../hooks/use-action-feedback.js";

interface ActionFeedbackRegionProps {
  status: ActionFeedbackStatus;
  message: string | null;
  onDismiss?: () => void;
  className?: string;
}

const statusConfig: Record<Exclude<ActionFeedbackStatus, "idle">, { icon: FunctionComponent<any>, colors: string }> = {
  pending: { icon: Loader2, colors: "bg-signal-500/10 text-signal-700 border-signal-500/20 dark:text-signal-400" },
  success: { icon: CheckCircle, colors: "bg-status-green/10 text-status-green border-status-green/20" },
  warning: { icon: AlertTriangle, colors: "bg-status-amber/10 text-status-amber border-status-amber/20" },
  error: { icon: XCircle, colors: "bg-status-red/10 text-status-red border-status-red/20" },
};

export function ActionFeedbackRegion({ status, message, onDismiss, className = "" }: ActionFeedbackRegionProps) {
  if (status === "idle" || !message) return null;

  const config = statusConfig[status];
  const Icon = config.icon;

  const ariaLive = status === "error" ? "assertive" : "polite";

  return (
    <div
      role="status"
      aria-live={ariaLive}
      className={`flex items-start gap-3 p-3 rounded-xl border ${config.colors} ${className}`}
    >
      <Icon className={`w-5 h-5 shrink-0 ${status === "pending" ? "animate-spin" : ""}`} />
      <div className="flex-1 text-sm font-medium mt-0.5">
        {message}
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 p-1 rounded-md opacity-70 hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30 focus-visible:ring-offset-2"
          aria-label="Dismiss message"
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}
