import gsap from "gsap";

export interface TooltipMotionConfig {
    duration?: number;
    ease?: string;
}

export const tooltipMotion = {
    enter: (el: HTMLElement, position: "top" | "bottom" | "left" | "right", config?: TooltipMotionConfig) => {
        gsap.fromTo(
            el,
            { opacity: 0, scale: 0, y: position === "bottom" ? -4 : position === "top" ? 4 : 0, x: position === "right" ? -4 : position === "left" ? 4 : 0 },
            { opacity: 1, scale: 1, y: 0, x: 0, duration: config?.duration ?? 0.2, ease: config?.ease ?? "power2.inOut", overwrite: "auto" }
        );
    },
    exit: (el: HTMLElement, position: "top" | "bottom" | "left" | "right", onComplete: () => void, config?: TooltipMotionConfig) => {
        gsap.to(el, {
            opacity: 0,
            scale: 0,
            y: position === "bottom" ? -4 : position === "top" ? 4 : 0,
            x: position === "right" ? -4 : position === "left" ? 4 : 0,
            duration: config?.duration ?? 0.2,
            ease: config?.ease ?? "power2.inOut",
            overwrite: "auto",
            onComplete
        });
    }
};
