import type { FunctionComponent } from "preact";
import type { SourceStatus } from "../../types.js";

const dotClasses: Record<SourceStatus, string> = {
    running:      "bg-status-green shadow-[0_0_8px_rgba(0,171,132,0.6)] rounded-full",
    failed:       "bg-status-red shadow-[0_0_8px_rgba(227,0,15,0.5)] rounded-sm",
    intervention: "bg-status-amber shadow-[0_0_8px_rgba(245,158,11,0.5)] [clip-path:polygon(50%_0,0_100%,100%_100%)]",
    idle:         "bg-slate-400 dark:bg-slate-600 rotate-45 rounded-sm",
};

interface StatusDotProps {
    status: SourceStatus;
    className?: string;
}

export const StatusDot: FunctionComponent<StatusDotProps> = ({ status, className = "w-2 h-2" }) => (
    <span className={`shrink-0 ${className} ${dotClasses[status] ?? dotClasses.idle}`} />
);
