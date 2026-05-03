import gsap from "gsap";

export const tooltipMotion = {
    enter: (el: HTMLElement, position: "top" | "bottom" | "left" | "right") => {
        gsap.fromTo(
            el,
            { opacity: 0, y: position === "bottom" ? -4 : position === "top" ? 4 : 0, x: position === "right" ? -4 : position === "left" ? 4 : 0 },
            { opacity: 1, y: 0, x: 0, duration: 0.2, ease: "power2.inOut", overwrite: "auto" }
        );
    },
    exit: (el: HTMLElement, position: "top" | "bottom" | "left" | "right", onComplete: () => void) => {
        gsap.to(el, {
            opacity: 0,
            y: position === "bottom" ? -4 : position === "top" ? 4 : 0,
            x: position === "right" ? -4 : position === "left" ? 4 : 0,
            duration: 0.2,
            ease: "power2.inOut",
            overwrite: "auto",
            onComplete
        });
    }
};
