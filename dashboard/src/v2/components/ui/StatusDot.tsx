import type { FunctionComponent } from "preact";
import type { SourceStatus } from "../../types.js";
import { Play, XCircle, AlertCircle, Circle } from "lucide-preact";

const dotClasses: Record<SourceStatus, string> = {
    running:      "text-status-green",
    failed:       "text-status-red",
    intervention: "text-status-amber",
    idle:         "text-slate-400 dark:text-slate-600",
};

const StatusIcon: Record<SourceStatus, any> = {
    running:      Play,
    failed:       XCircle,
    intervention: AlertCircle,
    idle:         Circle,
};

interface StatusDotProps {
    status: SourceStatus;
    className?: string;
}

export const StatusDot: FunctionComponent<StatusDotProps> = ({ status, className = "w-3 h-3" }) => {
    const Icon = StatusIcon[status] ?? StatusIcon.idle;
    return (
        <span role="status" aria-label={`Status: ${status}`} className={`shrink-0 flex items-center justify-center ${className} ${dotClasses[status] ?? dotClasses.idle}`}>
            <Icon className="w-full h-full" strokeWidth={2.5} fill={status === 'running' ? 'currentColor' : 'none'} />
        </span>
    );
};
