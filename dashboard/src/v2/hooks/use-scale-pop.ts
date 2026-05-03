import { useEffect } from "preact/hooks";
import type { RefObject } from "preact";
import gsap from "gsap";
import { useReducedMotion } from "./use-reduced-motion.js";

export function useScalePop(ref: RefObject<HTMLElement>, disabled: boolean = false) {
    const reducedMotion = useReducedMotion();

    useEffect(() => {
        const el = ref.current;
        if (!el || reducedMotion || disabled) return;

        const handlePointerDown = () => {
            gsap.to(el, { scale: 0.95, duration: 0.15, ease: "power2.out", overwrite: "auto" });
        };

        const handlePointerUp = () => {
            gsap.to(el, { scale: 1, duration: 0.3, ease: "elastic.out(1, 0.4)", overwrite: "auto" });
        };

        el.addEventListener("mousedown", handlePointerDown);
        el.addEventListener("mouseup", handlePointerUp);
        el.addEventListener("mouseleave", handlePointerUp);

        return () => {
            el.removeEventListener("mousedown", handlePointerDown);
            el.removeEventListener("mouseup", handlePointerUp);
            el.removeEventListener("mouseleave", handlePointerUp);
        };
    }, [ref, reducedMotion, disabled]);
}
