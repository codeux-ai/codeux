import type { FunctionComponent, ComponentProps } from "preact";
import { memo } from "preact/compat";
import { useCallback } from "preact/hooks";
import { Loader2 } from "lucide-preact";
import { Tooltip } from "./ui/Tooltip.js";
import { SHARED_INTERACTION_CLASSES } from "./ui/Button.js";

interface IconButtonProps extends ComponentProps<"button"> {
    children: preact.ComponentChildren;
    title?: string;
    "aria-label"?: string;
    pending?: boolean;
}

export const IconButton: FunctionComponent<IconButtonProps> = memo(({ children, className = "", title, "aria-label": ariaLabel, pending = false, disabled, onClick, ...props }) => {
    const isPending = pending;

    const childrenOpacity = isPending ? "opacity-0" : "opacity-100";

    const handleClick = useCallback(
        (e: any) => {
            if (isPending) {
                e?.preventDefault();
                return;
            }
            if (onClick) {
                return (onClick as any)(e);
            }
        },
        [onClick, isPending]
    );

    const button = (
        <button
            {...props}
            onClick={handleClick}
            disabled={disabled}
            aria-disabled={disabled || isPending}
            aria-busy={isPending}
            aria-label={ariaLabel || title}
            className={`flex items-center justify-center p-2 rounded-xl relative hover:bg-black/5 dark:hover:bg-white/5 ${SHARED_INTERACTION_CLASSES} ${className}`}
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
