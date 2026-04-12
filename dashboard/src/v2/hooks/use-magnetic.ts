import { useEffect } from "preact/hooks";
import gsap from "gsap";
import type { RefObject } from "preact";
import { useReducedMotion } from "./use-reduced-motion.js";

interface UseMagneticOptions {
    enabled?: boolean;
    maxDisplacement?: number;
}

export function useMagnetic(
    triggerRef: RefObject<HTMLElement>,
    targetRef: RefObject<HTMLElement>,
    options: UseMagneticOptions = {}
) {
    const { enabled = true, maxDisplacement = 6 } = options;
    const prefersReducedMotion = useReducedMotion();

    useEffect(() => {
        const trigger = triggerRef.current;
        const target = targetRef.current;

        if (!trigger || !target || prefersReducedMotion || !enabled) {
            // Reset position if disabled
            if (target) {
                gsap.to(target, { x: 0, y: 0, duration: 0.3, ease: "power2.out" });
            }
            return;
        }

        const handleMouseMove = (e: MouseEvent) => {
            const rect = trigger.getBoundingClientRect();
            // Calculate center of the trigger element
            const centerX = rect.left + rect.width / 2;
            const centerY = rect.top + rect.height / 2;

            // Calculate distance from center (-1 to 1)
            const distX = (e.clientX - centerX) / (rect.width / 2);
            const distY = (e.clientY - centerY) / (rect.height / 2);

            // Clamp to -1 to 1 just in case
            const clampedX = Math.max(-1, Math.min(1, distX));
            const clampedY = Math.max(-1, Math.min(1, distY));

            gsap.to(target, {
                x: clampedX * maxDisplacement,
                y: clampedY * maxDisplacement,
                duration: 0.3,
                ease: "power2.out",
                overwrite: "auto",
            });
        };

        const handleMouseLeave = () => {
            gsap.to(target, { x: 0, y: 0, duration: 0.55, ease: "elastic.out(1, 0.5)", overwrite: "auto" });
        };

        trigger.addEventListener("mousemove", handleMouseMove);
        trigger.addEventListener("mouseleave", handleMouseLeave);

        return () => {
            trigger.removeEventListener("mousemove", handleMouseMove);
            trigger.removeEventListener("mouseleave", handleMouseLeave);
        };
    }, [triggerRef, targetRef, prefersReducedMotion, enabled, maxDisplacement]);
}
