import type { FunctionComponent } from "preact";
import type { SourceStatus } from "../../types.js";

const dotClasses: Record<SourceStatus, string> = {
    running:      "bg-status-green shadow-[0_0_8px_rgba(0,171,132,0.6)]",
    failed:       "bg-status-red shadow-[0_0_8px_rgba(227,0,15,0.5)]",
    intervention: "bg-status-amber shadow-[0_0_8px_rgba(245,158,11,0.5)]",
    idle:         "bg-slate-400 dark:bg-slate-600",
};

interface StatusDotProps {
    status: SourceStatus;
    className?: string;
}

export const StatusDot: FunctionComponent<StatusDotProps> = ({ status, className = "w-1.5 h-1.5" }) => (
    <span className={`rounded-full shrink-0 ${className} ${dotClasses[status] ?? dotClasses.idle}`}>
        <span className="sr-only">{status}</span>
    </span>
);
