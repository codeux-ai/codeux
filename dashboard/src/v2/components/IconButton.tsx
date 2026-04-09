import type { FunctionComponent, ComponentProps } from "preact";
import { memo } from "preact/compat";
import { useRef } from "preact/hooks";
import gsap from "gsap";
import { Tooltip } from "./ui/Tooltip.js";
import { useReducedMotion } from "../hooks/use-reduced-motion.js";
import { MAGNETIC_RADIUS, HAPTIC_PRESS_SCALE, HOVER_EASE, RELEASE_EASE } from "../lib/motion/interactions.js";

interface IconButtonProps extends ComponentProps<"button"> {
    children: preact.ComponentChildren;
    title?: string;
    "aria-label"?: string;
}

export const IconButton: FunctionComponent<IconButtonProps> = memo(({ children, className = "", title, "aria-label": ariaLabel, ...props }) => {
    const ref = useRef<HTMLButtonElement>(null);
    const prefersReducedMotion = useReducedMotion();

    const handleMouseMove = (e: MouseEvent) => {
        if (!ref.current || prefersReducedMotion) return;
        const rect = ref.current.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const dist = Math.abs(e.clientX - centerX);

        if (dist < MAGNETIC_RADIUS) {
            const ratio = 1 - Math.pow(dist / MAGNETIC_RADIUS, 1.5);
            gsap.to(ref.current, {
                scale: 1 + 0.15 * ratio,
                y: -4 * ratio,
                duration: 0.35,
                ease: RELEASE_EASE,
                overwrite: "auto",
            });
        } else {
            gsap.to(ref.current, { scale: 1, y: 0, duration: 0.35, ease: RELEASE_EASE, overwrite: "auto" });
        }
    };

    const handleMouseLeave = () => {
        if (!ref.current) return;
        gsap.to(ref.current, { scale: 1, y: 0, duration: 0.55, ease: HOVER_EASE, overwrite: "auto" });
    };

    const handlePointerDown = () => {
        if (!ref.current || prefersReducedMotion) return;
        gsap.to(ref.current, { scale: HAPTIC_PRESS_SCALE, duration: 0.15, ease: RELEASE_EASE, overwrite: "auto" });
    };

    const handlePointerUp = () => {
        if (!ref.current || prefersReducedMotion) return;
        gsap.to(ref.current, { scale: 1, duration: 0.35, ease: HOVER_EASE, overwrite: "auto" });
    };
    const button = (
        <button
            {...props}
            aria-label={ariaLabel || title}
            ref={ref}
            onMouseMove={handleMouseMove as any}
            onMouseLeave={handleMouseLeave}
            onPointerDown={handlePointerDown}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            className={`flex items-center justify-center p-2 rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 touch-target ${className}`}
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
