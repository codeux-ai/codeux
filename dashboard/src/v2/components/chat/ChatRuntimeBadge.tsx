import { type FunctionComponent } from "preact";

export type ExecutionStatus = "queued" | "running" | "completed" | "failed";

export interface ChatRuntimeBadgeProps {
  status: ExecutionStatus;
  label?: string;
}

export const ChatRuntimeBadge: FunctionComponent<ChatRuntimeBadgeProps> = ({ status, label }) => {
  const getStatusColor = () => {
    switch (status) {
      case "queued":
        return "bg-slate-400";
      case "running":
        return "bg-signal-500 animate-pulse";
      case "completed":
        return "bg-slate-600 dark:bg-slate-50";
      case "failed":
        return "bg-red-500";
      default:
        return "bg-slate-500";
    }
  };

  const getAriaLabel = () => {
    return label ? `${label}: ${status}` : status;
  };

  return (
    <div
      class={`w-2 h-2 rounded-full ${getStatusColor()}`}
      role="status"
      aria-label={getAriaLabel()}
      title={getAriaLabel()}
    />
  );
};
