import type { FunctionComponent } from "preact";
import { CheckCircle, AlertCircle, Loader2, X } from "lucide-preact";
import type { ActionFeedbackState } from "../../hooks/use-action-feedback.js";

interface ActionFeedbackRegionProps {
    feedback: ActionFeedbackState;
    onDismiss: () => void;
}

export const ActionFeedbackRegion: FunctionComponent<ActionFeedbackRegionProps> = ({ feedback, onDismiss }) => {
    if (feedback.status === "idle") {
        return null;
    }

    const isError = feedback.status === "error";
    const role = isError ? "alert" : "status";
    const ariaLive = isError ? "assertive" : "polite";

    return (
        <div
            role={role}
            aria-live={ariaLive}
            className={`flex items-center gap-3 px-4 py-3 rounded-2xl border text-sm shadow-sm motion-safe:transition-all motion-safe:duration-300 w-full ${
                feedback.status === "error"
                    ? "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-900/50 text-red-800 dark:text-red-200"
                    : feedback.status === "success"
                    ? "bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-900/50 text-green-800 dark:text-green-200"
                    : "bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-900/50 text-blue-800 dark:text-blue-200"
            }`}
        >
            <div className="shrink-0 flex">
                {feedback.status === "pending" && <Loader2 className="w-5 h-5 animate-spin motion-reduce:animate-none" />}
                {feedback.status === "success" && <CheckCircle className="w-5 h-5" />}
                {feedback.status === "error" && <AlertCircle className="w-5 h-5" />}
            </div>
            <div className="flex-1 font-medium leading-tight">
                {feedback.message}
            </div>
            {feedback.status !== "pending" && (
                <button
                    type="button"
                    onClick={onDismiss}
                    aria-label="Dismiss feedback"
                    className="shrink-0 p-1.5 rounded-full hover:bg-black/5 dark:hover:bg-white/5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30"
                >
                    <X className="w-4 h-4" />
                </button>
            )}
        </div>
    );
};
