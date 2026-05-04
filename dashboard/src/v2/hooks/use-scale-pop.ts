import { useEffect } from "preact/hooks";
import type { RefObject } from "preact";
import gsap from "gsap";
import { useReducedMotion } from "./use-reduced-motion.js";

export interface ScalePopConfig {
  scaleDown?: number;
  durationDown?: number;
  durationUp?: number;
  easeDown?: string;
  easeUp?: string;
}

export function useScalePop(ref: RefObject<HTMLElement>, disabled: boolean = false, config?: ScalePopConfig) {
    const reducedMotion = useReducedMotion();

    useEffect(() => {
        const el = ref.current;
        if (!el || reducedMotion || disabled) return;

        const handlePointerDown = () => {
            gsap.to(el, { scale: config?.scaleDown ?? 0.95, duration: config?.durationDown ?? 0.15, ease: config?.easeDown ?? "power2.out", overwrite: "auto" });
        };

        const handlePointerUp = () => {
            gsap.to(el, { scale: 1, duration: config?.durationUp ?? 0.3, ease: config?.easeUp ?? "elastic.out(1, 0.4)", overwrite: "auto" });
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
