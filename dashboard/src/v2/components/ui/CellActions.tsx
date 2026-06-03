import type { FunctionComponent } from "preact";
import { Play, Square, Maximize2, Settings, Loader2 } from "lucide-preact";
import { Link } from "@tanstack/react-router";
import { SHARED_INTERACTION_CLASSES } from "./Button.js";

interface CellActionsProps {
    isRunning: boolean;
    label?: string;
    to?: string;
    primaryBusy?: boolean;
    onPrimaryAction?: () => void;
    onOpen?: () => void | Promise<void>;
    onSettings?: () => void | Promise<void>;
}

/**
 * Shared bottom action bar for organic blob cells (SourceCell, SprintCell).
 * Appears on hover: [play/stop circle] [Action pill] [settings circle]
 */
export const CellActions: FunctionComponent<CellActionsProps> = ({
    isRunning,
    label = "Open",
    to = "#",
    primaryBusy = false,
    onPrimaryAction,
    onOpen,
    onSettings,
}) => (
    <div className="absolute bottom-5 flex items-center justify-center gap-3 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity duration-[50ms] w-full">
        <button
            type="button"
            className={`flex items-center justify-center w-9 h-9 rounded-full text-slate-800 dark:text-white bg-transparent hover:bg-slate-100 dark:hover:bg-void-600 ${SHARED_INTERACTION_CLASSES}`}
            aria-label={isRunning ? "Stop" : "Play"}
            disabled={!onPrimaryAction || primaryBusy}
            onClick={(event) => {
                event.stopPropagation();
                onPrimaryAction?.();
            }}
        >
            {primaryBusy ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400" />
            ) : isRunning ? (
                <Square className="w-3.5 h-3.5 text-status-red" fill="currentColor" />
            ) : (
                <Play className="w-3.5 h-3.5 text-signal-600" fill="currentColor" />
            )}
        </button>
        {onOpen ? (
            <button
                type="button"
                onClick={(event) => {
                    event.stopPropagation();
                    void onOpen?.();
                }}
                className={`flex items-center gap-1.5 px-5 h-9 bg-transparent text-slate-800 dark:text-white hover:bg-slate-900 hover:text-white dark:hover:bg-white dark:hover:text-void-900 hover:underline rounded-full font-bold text-[10px] uppercase tracking-[0.1em] shadow-[0_4px_12px_rgba(0,0,0,0.15)] ${SHARED_INTERACTION_CLASSES}`}
            >
                {label} <Maximize2 className="w-2.5 h-2.5" />
            </button>
        ) : (
            <Link 
                to={to}
                onClick={(event: MouseEvent) => event.stopPropagation()}
                className={`flex items-center gap-1.5 px-5 h-9 bg-transparent text-slate-800 dark:text-white hover:bg-slate-900 hover:text-white dark:hover:bg-white dark:hover:text-void-900 hover:underline rounded-full font-bold text-[10px] uppercase tracking-[0.1em] shadow-[0_4px_12px_rgba(0,0,0,0.15)] ${SHARED_INTERACTION_CLASSES}`}
            >
                {label} <Maximize2 className="w-2.5 h-2.5" />
            </Link>
        )}
        <button
            type="button"
            className={`flex items-center justify-center w-11 h-11 bg-transparent hover:bg-slate-100 dark:hover:bg-void-600 rounded-full text-slate-800 dark:text-white ${SHARED_INTERACTION_CLASSES}`}
            aria-label="Settings"
            onClick={(event) => {
                event.stopPropagation();
                void onSettings?.();
            }}
        >
            <Settings className="w-3.5 h-3.5" />
        </button>
    </div>
);
