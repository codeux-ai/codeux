import type { FunctionComponent, ComponentProps } from "preact";
import { memo } from "preact/compat";
import { useRef } from "preact/hooks";
import { useScalePop } from "../hooks/use-scale-pop.js";
import { Loader2 } from "lucide-preact";
import { Tooltip } from "./ui/Tooltip.js";
import { SHARED_INTERACTION_CLASSES } from "./ui/Button.js";

interface IconButtonProps extends ComponentProps<"button"> {
    children: preact.ComponentChildren;
    title?: string;
    "aria-label"?: string;
    pending?: boolean;
}

export const IconButton: FunctionComponent<IconButtonProps> = memo(({ children, className = "", title, "aria-label": ariaLabel, pending = false, disabled, ...props }) => {
    const buttonRef = useRef<HTMLButtonElement>(null);
    useScalePop(buttonRef, Boolean(disabled) || Boolean(pending));
    const isPending = pending;

    const childrenOpacity = isPending ? "opacity-0" : "opacity-100";

    const button = (
        <button
            {...props}
            ref={buttonRef}
            disabled={disabled || isPending}
            aria-label={ariaLabel || title}
            className={`flex items-center justify-center p-2 rounded-xl relative ${SHARED_INTERACTION_CLASSES} ${className}`}
        >
            <div className={`flex items-center justify-center transition-opacity duration-200 ${childrenOpacity}`}>
                {children}
            </div>

            <div className={`absolute inset-0 flex items-center justify-center transition-opacity duration-200 ${isPending ? "opacity-100" : "opacity-0 pointer-events-none"}`}>
                <Loader2 className="w-5 h-5 animate-spin" />
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
