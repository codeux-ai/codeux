import type { FunctionComponent, ComponentProps } from "preact";
import { memo } from "preact/compat";
import { Loader2 } from "lucide-preact";
import { Tooltip } from "./ui/Tooltip.js";
import { Check, X } from "lucide-preact";
import { useActionFeedback } from "../hooks/use-action-feedback.js";
import { useReducedMotion } from "../hooks/use-reduced-motion.js";
import { useCallback } from "preact/hooks";
import { SHARED_INTERACTION_CLASSES } from "./ui/Button.js";
import { useInteractionTokens } from "../lib/motion/tokens.js";

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
    const tokens = useInteractionTokens();

    const isPending = pending || feedback.status === "pending";
    const isSuccess = feedback.status === "success";
    const isError = feedback.status === "error";
    const isAriaDisabled = props["aria-disabled"] === true || props["aria-disabled"] === "true";

    const childrenOpacity = isPending || isSuccess || isError ? "opacity-0" : "opacity-100";
    const feedbackTransitionStyle = {
        transitionDuration: tokens.controlFeedback.duration,
        transitionTimingFunction: tokens.controlFeedback.ease,
    };

    const handleClick = useCallback(
        (e: any) => {
            if (disabled || isPending || isAriaDisabled) {
                e?.preventDefault();
                e?.stopPropagation();
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
        [disabled, isPending, isAriaDisabled, onClick, setPending, setSuccess, setError]
    );

    const button = (
        <button
            {...props}
            style={{ transitionDuration: tokens.controlFeedback.duration, transitionTimingFunction: tokens.controlFeedback.ease, ...(typeof props.style === "object" ? props.style : {}) }}
            onClick={handleClick}
            disabled={disabled}
            aria-label={ariaLabel || title}
            aria-busy={isPending}
            aria-disabled={disabled || isPending || isAriaDisabled}
            className={`relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl hover:bg-black/5 dark:hover:bg-white/5 ${SHARED_INTERACTION_CLASSES} ${className}`}
        >
            <div className={`flex items-center justify-center transition-opacity motion-reduce:duration-0 motion-reduce:ease-none ${childrenOpacity}`} style={feedbackTransitionStyle}>
                {children}
            </div>

            <div className={`absolute inset-0 flex items-center justify-center transition-opacity motion-reduce:duration-0 motion-reduce:ease-none ${isPending ? "opacity-100" : "opacity-0 pointer-events-none"}`} style={feedbackTransitionStyle}>
                <Loader2 className={`w-5 h-5 ${reducedMotion ? "" : "animate-spin"}`} aria-hidden="true" />
            </div>

            <div className={`absolute inset-0 flex items-center justify-center transition-opacity motion-reduce:duration-0 motion-reduce:ease-none ${isSuccess ? "opacity-100" : "opacity-0 pointer-events-none"}`} style={feedbackTransitionStyle}>
                <Check className="w-5 h-5 text-status-green" strokeWidth={3} aria-hidden="true" />
            </div>

            <div className={`absolute inset-0 flex items-center justify-center transition-opacity motion-reduce:duration-0 motion-reduce:ease-none ${isError ? "opacity-100" : "opacity-0 pointer-events-none"}`} style={feedbackTransitionStyle}>
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
