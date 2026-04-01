import type { FunctionComponent, ComponentProps } from "preact";
import { memo } from "preact/compat";

interface IconButtonProps extends ComponentProps<"button"> {
    children: preact.ComponentChildren;
    title?: string;
    "aria-label"?: string;
}

export const IconButton: FunctionComponent<IconButtonProps> = memo(({ children, className = "", ...props }) => {
    return (
        <button
            {...props}
            className={`flex items-center justify-center p-2 rounded-xl transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50 touch-target ${className}`}
        >
            {children}
        </button>
    );
});
