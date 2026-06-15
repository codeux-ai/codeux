import type { FunctionComponent } from "preact";
import { Play, Square, Maximize2, Settings, Loader2, Check, X } from "lucide-preact";
import { useActionFeedback } from "../../hooks/use-action-feedback.js";
import { useReducedMotion } from "../../hooks/use-reduced-motion.js";
import { useCallback } from "preact/hooks";
import { Link } from "@tanstack/react-router";
import { SHARED_INTERACTION_CLASSES } from "./Button.js";

interface CellActionsProps {
    isRunning: boolean;
    label?: string;
    to?: string;
    primaryBusy?: boolean;
    onPrimaryAction?: () => void | Promise<any>;
    onSprintsClick?: () => void | Promise<void>;
    onSettingsClick?: () => void | Promise<void>;
}

/**
 * Shared bottom action bar for organic blob cells (SourceCell, SprintCell).
 * Appears on hover: [play/stop circle] [Action pill] [settings circle]
 */
export const CellActions: FunctionComponent<CellActionsProps> = ({
    isRunning,
    label = "Sprints",
    to = "#",
    primaryBusy = false,
    onPrimaryAction,
    onSprintsClick,
    onSettingsClick,
}) => {
    const { feedback: primaryFeedback, setPending: setPrimaryPending, setSuccess: setPrimarySuccess, setError: setPrimaryError } = useActionFeedback(1500);
    const reducedMotion = useReducedMotion();

    const isPrimaryPending = primaryBusy || primaryFeedback.status === "pending";
    const isPrimarySuccess = primaryFeedback.status === "success";
    const isPrimaryError = primaryFeedback.status === "error";

    const handlePrimaryClick = useCallback((e: MouseEvent) => {
        e.stopPropagation();
        if (isPrimaryPending) return;
        if (!onPrimaryAction) return;

        const result = onPrimaryAction();
        if (result && typeof result === "object" && "then" in result && typeof result.then === "function") {
            setPrimaryPending("");
            (result as Promise<any>)
                .then(() => setPrimarySuccess(""))
                .catch((err: unknown) => {
                    setPrimaryError("");
                    throw err;
                });
        }
    }, [onPrimaryAction, isPrimaryPending, setPrimaryPending, setPrimarySuccess, setPrimaryError]);

    return (
        <div className="absolute bottom-5 flex items-center justify-center gap-3 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity duration-[50ms] w-full">
            <button
                className={`flex items-center justify-center w-9 h-9 rounded-full text-slate-800 dark:text-white bg-transparent hover:bg-slate-100 dark:hover:bg-void-600 relative overflow-hidden ${SHARED_INTERACTION_CLASSES}`}
                aria-label={isRunning ? "Stop" : "Play"}
                aria-busy={isPrimaryPending}
                disabled={!onPrimaryAction || isPrimaryPending}
                onClick={handlePrimaryClick as any}
            >
                <div className={`absolute inset-0 flex items-center justify-center transition-opacity duration-200 ${isPrimaryPending || isPrimarySuccess || isPrimaryError ? "opacity-0" : "opacity-100"}`}>
                    {isRunning ? (
                        <Square className="w-3.5 h-3.5 text-status-red" fill="currentColor" aria-hidden="true" />
                    ) : (
                        <Play className="w-3.5 h-3.5 text-signal-600" fill="currentColor" aria-hidden="true" />
                    )}
                </div>

                <div className={`absolute inset-0 flex items-center justify-center transition-opacity duration-200 ${isPrimaryPending ? "opacity-100" : "opacity-0 pointer-events-none"}`}>
                    <Loader2 className={`w-3.5 h-3.5 text-slate-400 ${reducedMotion ? "" : "animate-spin"}`} aria-hidden="true" />
                </div>

                <div className={`absolute inset-0 flex items-center justify-center transition-opacity duration-200 ${isPrimarySuccess ? "opacity-100" : "opacity-0 pointer-events-none"}`}>
                    <Check className="w-3.5 h-3.5 text-status-green" strokeWidth={3} aria-hidden="true" />
                </div>

                <div className={`absolute inset-0 flex items-center justify-center transition-opacity duration-200 ${isPrimaryError ? "opacity-100" : "opacity-0 pointer-events-none"}`}>
                    <X className="w-3.5 h-3.5 text-status-red" strokeWidth={3} aria-hidden="true" />
                </div>
            </button>
            <Link
                to={to}
                onClick={(e: MouseEvent) => {
                    e.stopPropagation();
                    void onSprintsClick?.();
                }}
                className={`flex items-center gap-1.5 px-5 h-9 bg-transparent text-slate-800 dark:text-white hover:bg-slate-900 hover:text-white dark:hover:bg-white dark:hover:text-void-900 rounded-full font-bold text-[10px] uppercase tracking-[0.1em] shadow-[0_4px_12px_rgba(0,0,0,0.15)] ${SHARED_INTERACTION_CLASSES}`}
            >
                {label} <Maximize2 className="w-2.5 h-2.5" aria-hidden="true" />
            </Link>
            <Link
                to="/config"
                onClick={(e: MouseEvent) => {
                    e.stopPropagation();
                    void onSettingsClick?.();
                }}
                className={`flex items-center justify-center w-11 h-11 bg-transparent hover:bg-slate-100 dark:hover:bg-void-600 rounded-full text-slate-800 dark:text-white ${SHARED_INTERACTION_CLASSES}`}
                aria-label="Settings"
            >
                <button
                    type="button"
                    aria-hidden="true"
                    tabIndex={-1}
                    className="pointer-events-none"
                >
                    <Settings className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
            </Link>
        </div>
    );
};
