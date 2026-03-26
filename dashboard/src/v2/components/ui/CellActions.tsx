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
    <div className="absolute bottom-5 flex items-center justify-center gap-3 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-all duration-300 translate-y-2 group-hover:translate-y-0 group-focus-within:translate-y-0 w-full">
        <button
            className={`flex items-center justify-center w-9 h-9 rounded-full text-slate-800 dark:text-white transition-all duration-300 ${
                isRunning
                    ? "bg-status-red/[0.12] hover:bg-status-red/[0.18] shadow-[0_0_18px_rgba(227,0,15,0.16)]"
                    : "bg-signal-500/[0.12] hover:bg-signal-500/[0.18] shadow-[0_0_18px_rgba(0,224,160,0.16)]"
            } focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50 disabled:opacity-60 disabled:cursor-not-allowed`}
            aria-label={isRunning ? "Stop" : "Play"}
            disabled={!onPrimaryAction || primaryBusy}
            onClick={(e: any) => {
                e.stopPropagation();
                onPrimaryAction?.();
            }}
        >
            {isRunning
                ? <Square className={`w-3.5 h-3.5 ${primaryBusy ? "animate-pulse" : ""}`} fill="currentColor" />
                : <Play className={`w-3.5 h-3.5 ${primaryBusy ? "animate-pulse" : ""}`} fill="currentColor" />
            }
        </button>
        <Link 
            to={to}
            onClick={(e: any) => e.stopPropagation()}
            className="flex items-center gap-1.5 px-5 h-9 bg-slate-900 dark:bg-white hover:opacity-85 rounded-full text-white dark:text-void-900 font-bold text-[10px] uppercase tracking-[0.1em] transition-all shadow-[0_4px_12px_rgba(0,0,0,0.15)] focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50"
        >
            {label} <Maximize2 className="w-2.5 h-2.5" />
        </Link>
        <button
            className="flex items-center justify-center w-11 h-11 bg-black/[0.06] dark:bg-white/[0.07] hover:bg-black/10 dark:hover:bg-white/10 rounded-full text-slate-800 dark:text-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50"
            aria-label="Settings"
            onClick={(e: any) => e.stopPropagation()}
        >
            <Settings className="w-3.5 h-3.5" />
        </button>
    </div>
);
