import { h } from "preact";
import { getStatusConfig } from "../../lib/status-labels";

export interface TaskStatusBadgeProps {
  status: string;
  className?: string;
}

export function TaskStatusBadge({ status, className = "" }: TaskStatusBadgeProps) {
  const config = getStatusConfig(status);
  const Icon = config.icon;

  const variantStyles = {
    default: "bg-gray-100 text-gray-800 border-gray-200",
    success: "bg-green-100 text-green-800 border-green-200",
    warning: "bg-yellow-100 text-yellow-800 border-yellow-200",
    danger: "bg-red-100 text-red-800 border-red-200",
    muted: "bg-gray-50 text-gray-500 border-gray-100",
  };

  return (
    <div
      data-testid="task-status-badge"
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border ${variantStyles[config.variant]} ${className}`}
    >
      <Icon className="w-3.5 h-3.5" />
      <span>{config.label}</span>
    </div>
  );
}
