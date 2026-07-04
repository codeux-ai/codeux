import gsap from "gsap";
import { GSAP_INTERACTION_TOKENS } from "../lib/motion/constants.js";

export interface TooltipMotionConfig {
    duration?: number;
    ease?: string;
}

export const tooltipMotion = {
    enter: (el: HTMLElement, position: "top" | "bottom" | "left" | "right", config?: TooltipMotionConfig) => {
        const token = GSAP_INTERACTION_TOKENS.controlFeedback;
        gsap.fromTo(
            el,
            { opacity: 0, y: position === "bottom" ? -4 : position === "top" ? 4 : 0, x: position === "right" ? -4 : position === "left" ? 4 : 0 },
            { opacity: 1, y: 0, x: 0, duration: config?.duration ?? token.duration, ease: config?.ease ?? token.ease, overwrite: "auto" }
        );
    },
    exit: (el: HTMLElement, position: "top" | "bottom" | "left" | "right", onComplete: () => void, config?: TooltipMotionConfig) => {
        const token = GSAP_INTERACTION_TOKENS.controlFeedback;
        gsap.to(el, {
            opacity: 0,
            y: position === "bottom" ? -4 : position === "top" ? 4 : 0,
            x: position === "right" ? -4 : position === "left" ? 4 : 0,
            duration: config?.duration ?? token.duration,
            ease: config?.ease ?? token.ease,
            overwrite: "auto",
            onComplete
        });
    }
};
