import type { FunctionComponent, ComponentProps } from "preact";
import { memo } from "preact/compat";
import { Tooltip } from "./ui/Tooltip.js";

interface IconButtonProps extends ComponentProps<"button"> {
    children: preact.ComponentChildren;
    title?: string;
    "aria-label"?: string;
}

export const IconButton: FunctionComponent<IconButtonProps> = memo(({ children, className = "", title, "aria-label": ariaLabel, ...props }) => {
    const button = (
        <button
            {...props}
            aria-label={ariaLabel || title}
            className={`flex items-center justify-center p-2 rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 active:scale-95 touch-target ${className}`}
        >
            {children}
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
