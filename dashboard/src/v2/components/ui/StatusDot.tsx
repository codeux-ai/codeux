import type { FunctionComponent } from "preact";
import type { SourceStatus, TaskStatus, SprintStatus } from "../../types.js";
import type { DashboardStatus } from "../../../types.js";

interface StatusDotProps {
    status: SourceStatus | TaskStatus | SprintStatus | DashboardStatus;
    className?: string;
}

export const StatusDot: FunctionComponent<StatusDotProps> = ({ status, className = "w-2 h-2" }) => {
    switch (status) {
        case "running":
            return (
                <div role="img" aria-label={`Status: ${status}`} className={`shrink-0 relative ${className}`}>
                    <div className="w-full h-full rounded-full bg-status-green shadow-[0_0_10px_var(--status-static-running-ring)] z-10 relative" />
                    <div className="absolute inset-[-4px] bg-status-green rounded-full motion-safe:animate-ping motion-reduce:animate-none opacity-30 motion-reduce:opacity-100 motion-reduce:ring-2 motion-reduce:ring-[color:var(--status-static-running-aura)] pointer-events-none" />
                    <div className="absolute inset-[-2px] bg-status-green rounded-full motion-safe:animate-pulse motion-reduce:animate-none opacity-50 motion-reduce:opacity-75 pointer-events-none" />
                </div>
            );
        case "failed":
            return (
                <div role="img" aria-label={`Status: ${status}`} className={`shrink-0 relative ${className}`}>
                    <div className="w-full h-full rounded-full bg-status-red shadow-[0_0_10px_var(--status-static-failed-ring)]" />
                    <div className="absolute inset-[-3px] bg-status-red rounded-full motion-safe:animate-ping motion-reduce:animate-none opacity-50 motion-reduce:opacity-100 motion-reduce:ring-2 motion-reduce:ring-[color:var(--status-static-failed-aura)]" />
                </div>
            );
        case "intervention":
            return (
                <span
                    role="img"
                    aria-label={`Status: ${status}`}
                    className={`shrink-0 ${className} rounded-full bg-status-amber shadow-[0_0_8px_var(--status-static-intervention-ring)] motion-safe:animate-pulse-slow motion-reduce:animate-none motion-reduce:ring-2 motion-reduce:ring-[color:var(--status-static-intervention-aura)]`}
                />
            );
        case "idle":
        default:
            return (
                <span
                    role="img"
                    aria-label={`Status: ${status}`}
                    className={`shrink-0 ${className} rounded-full bg-[var(--text-metadata)] opacity-70`}
                />
            );
    }
};
