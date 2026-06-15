import type { FunctionComponent, ComponentProps } from "preact";
import { memo } from "preact/compat";
import { Loader2 } from "lucide-preact";
import { Tooltip } from "./ui/Tooltip.js";
import { Check, X } from "lucide-preact";
import { useActionFeedback } from "../hooks/use-action-feedback.js";
import { useReducedMotion } from "../hooks/use-reduced-motion.js";
import { useCallback } from "preact/hooks";
import { SHARED_INTERACTION_CLASSES } from "./ui/Button.js";

interface IconButtonProps extends ComponentProps<"button"> {
    children: preact.ComponentChildren;
    title?: string;
    "aria-label"?: string;
    pending?: boolean;
    onClick?: (e: any) => void | Promise<any>;
}

export const IconButton: FunctionComponent<IconButtonProps> = memo(({ children, className = "", title, "aria-label": ariaLabel, pending = false, disabled, onClick, ...props }) => {
    const { feedback, setPending, setSuccess, setError } = useActionFeedback(1500);
    const reducedMotion = useReducedMotion();

    const isPending = pending || feedback.status === "pending";
    const isSuccess = feedback.status === "success";
    const isError = feedback.status === "error";

    const childrenOpacity = isPending || isSuccess || isError ? "opacity-0" : "opacity-100";

    const handleClick = useCallback(
        (e: any) => {
            if (isPending) {
                e?.preventDefault();
                return;
            }
            if (!onClick) return;

            const result = onClick(e);
            if (result && typeof result === "object" && "then" in result && typeof result.then === "function") {
                setPending("");
                result
                    .then(() => setSuccess(""))
                    .catch((err: unknown) => {
                        setError("");
                        throw err;
                    });
            }
            return result;
        },
        [onClick, isPending, setPending, setSuccess, setError]
    );

    const button = (
        <button
            {...props}
            onClick={handleClick}
            disabled={disabled || isPending}
            aria-label={ariaLabel || title}
            aria-busy={isPending}
            className={`flex items-center justify-center p-2 rounded-xl relative hover:bg-black/5 dark:hover:bg-white/5 ${SHARED_INTERACTION_CLASSES} ${className}`}
        >
            <div className={`flex items-center justify-center transition-opacity duration-200 ${childrenOpacity}`}>
                {children}
            </div>

            <div className={`absolute inset-0 flex items-center justify-center transition-opacity duration-200 ${isPending ? "opacity-100" : "opacity-0 pointer-events-none"}`}>
                <Loader2 className={`w-5 h-5 ${reducedMotion ? "" : "animate-spin"}`} aria-hidden="true" />
            </div>

            <div className={`absolute inset-0 flex items-center justify-center transition-opacity duration-200 ${isSuccess ? "opacity-100" : "opacity-0 pointer-events-none"}`}>
                <Check className="w-5 h-5 text-status-green" strokeWidth={3} aria-hidden="true" />
            </div>

            <div className={`absolute inset-0 flex items-center justify-center transition-opacity duration-200 ${isError ? "opacity-100" : "opacity-0 pointer-events-none"}`}>
                <X className="w-5 h-5 text-status-red" strokeWidth={3} aria-hidden="true" />
            </div>
        </button>
    );
    if (title) {
        return (
            <Tooltip content={title} position="bottom">
                {button}
            </Tooltip>
        );
    }

    return button;
});
