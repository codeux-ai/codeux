import type { FunctionComponent } from "preact";
import type { SourceStatus } from "../../types.js";

interface StatusDotProps {
    status: SourceStatus;
    className?: string;
}

export const StatusDot: FunctionComponent<StatusDotProps> = ({ status, className = "w-2 h-2" }) => {
    switch (status) {
        case "running":
            return (
                <div role="status" aria-label={`Status: ${status}`} className={`shrink-0 relative ${className}`}>
                    <div className="w-full h-full rounded-full bg-status-green shadow-[0_0_10px_rgba(0,171,132,0.7)] z-10 relative" />
                    <div className="absolute inset-[-4px] bg-status-green rounded-full motion-safe:animate-ping opacity-30 pointer-events-none" />
                    <div className="absolute inset-[-2px] bg-status-green rounded-full motion-safe:animate-pulse opacity-50 pointer-events-none" />
                </div>
            );
        case "failed":
            return (
                <div role="status" aria-label={`Status: ${status}`} className={`shrink-0 relative ${className}`}>
                    <div className="w-full h-full rounded-full bg-status-red shadow-[0_0_10px_rgba(227,0,15,0.7)]" />
                    <div className="absolute inset-0 bg-status-red rounded-full animate-ping opacity-60" />
                </div>
            );
        case "intervention":
            return (
                <span
                    role="status"
                    aria-label={`Status: ${status}`}
                    className={`shrink-0 ${className} rounded-full bg-status-amber shadow-[0_0_8px_rgba(245,158,11,0.5)] animate-pulse-slow`}
                />
            );
        case "idle":
        default:
            return (
                <span
                    role="status"
                    aria-label={`Status: ${status}`}
                    className={`shrink-0 ${className} rounded-full bg-void-500 shadow-[0_0_8px_rgba(61,55,48,0.3)]`}
                />
            );
    }
};
