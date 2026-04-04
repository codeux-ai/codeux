import type { FunctionComponent } from "preact";
import { Play, Square, Maximize2, Settings } from "lucide-preact";
import { Link } from "@tanstack/react-router";

interface CellActionsProps {
    isRunning: boolean;
    label?: string;
    to?: string;
    primaryBusy?: boolean;
    onPrimaryAction?: () => void;
}

/**
 * Shared bottom action bar for organic blob cells (SourceCell, SprintBubble).
 * Appears on hover: [play/stop circle] [Action pill] [settings circle]
 */
export const CellActions: FunctionComponent<CellActionsProps> = ({
    isRunning,
    label = "Open",
    to = "#",
    primaryBusy = false,
    onPrimaryAction,
}) => (
    <div className="absolute bottom-5 flex items-center justify-center gap-3 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity duration-[50ms] w-full">
        <button
            className={`touch-target flex items-center justify-center w-9 h-9 rounded-full text-slate-800 dark:text-white transition-all duration-300 bg-transparent hover:bg-slate-100 dark:hover:bg-void-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50 disabled:opacity-60 disabled:cursor-not-allowed active:scale-90`}
            aria-label={isRunning ? "Stop" : "Play"}
            disabled={!onPrimaryAction || primaryBusy}
            onClick={(e: any) => {
                e.stopPropagation();
                onPrimaryAction?.();
            }}
        >
            {isRunning
                ? <Square className={`w-3.5 h-3.5 ${primaryBusy ? "animate-pulse" : ""} text-status-red`} fill="currentColor" />
                : <Play className={`w-3.5 h-3.5 ${primaryBusy ? "animate-pulse" : ""} text-signal-600`} fill="currentColor" />
            }
        </button>
        <Link 
            to={to}
            onClick={(e: any) => e.stopPropagation()}
            className="flex items-center gap-1.5 px-5 h-9 bg-transparent text-slate-800 dark:text-white hover:bg-slate-900 hover:text-white dark:hover:bg-white dark:hover:text-void-900 hover:underline rounded-full font-bold text-[10px] uppercase tracking-[0.1em] transition-all shadow-[0_4px_12px_rgba(0,0,0,0.15)] focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50 active:scale-95"
        >
            {label} <Maximize2 className="w-2.5 h-2.5" />
        </Link>
        <button
            className="touch-target flex items-center justify-center w-11 h-11 bg-transparent hover:bg-slate-100 dark:hover:bg-void-600 rounded-full text-slate-800 dark:text-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50 active:scale-90"
            aria-label="Settings"
            onClick={(e: any) => e.stopPropagation()}
        >
            <Settings className="w-3.5 h-3.5" />
        </button>
    </div>
);
