import { useLayoutEffect, useRef } from "preact/hooks";
import type { RefObject } from "preact";
import gsap from "gsap";
import { Flip } from "gsap/Flip";
import { useReducedMotion } from "../../hooks/use-reduced-motion.js";
import { GSAP_DURATIONS, GSAP_EASINGS } from "./constants.js";

if (typeof window !== "undefined") {
    gsap.registerPlugin(Flip);
}

import { INTERACTION_TOKENS } from "./tokens.js";

export interface UseListReorderOptions {
    flipIdSelector?: string;
    stagger?: number;
    duration?: number;
    ease?: string;
}

export function useListReorder(
    containerRef: RefObject<HTMLElement>,
    dependencies: any[],
    options: UseListReorderOptions = {}
) {
    const reducedMotion = useReducedMotion();
    const flipStateRef = useRef<any>(null);
    const initialMountRef = useRef(true);
    const prevDepsRef = useRef<any[]>(dependencies);

    const {
        flipIdSelector = '[data-flip-id]',
        stagger = parseFloat(INTERACTION_TOKENS.listReorder.duration) / 1000 * 0.2,
        duration = parseFloat(INTERACTION_TOKENS.listReorder.duration) / 1000,
        ease = GSAP_EASINGS.smooth
    } = options;

    const depsChanged = prevDepsRef.current.length !== dependencies.length ||
                        prevDepsRef.current.some((dep, i) => dep !== dependencies[i]);

    if (depsChanged && containerRef.current && !reducedMotion) {
        flipStateRef.current = Flip.getState(containerRef.current.querySelectorAll(flipIdSelector));
        prevDepsRef.current = dependencies;
    } else if (depsChanged) {
        prevDepsRef.current = dependencies;
    }

    useLayoutEffect(() => {
        if (!containerRef.current) return;

        if (initialMountRef.current) {
            initialMountRef.current = false;
            if (!reducedMotion) {
                gsap.fromTo(
                    containerRef.current.children,
                    { y: 15, opacity: 0, scale: 0.99 },
                    { y: 0, opacity: 1, scale: 1, duration: 0.25, stagger: 0.04, ease: "power2.out", delay: 0.05 }
                );
            }
            return;
        }

        if (reducedMotion) {
            return;
        }

        if (flipStateRef.current) {
            containerRef.current.style.minHeight = `${containerRef.current.scrollHeight}px`;

            Flip.from(flipStateRef.current, {
                targets: containerRef.current.querySelectorAll(flipIdSelector),
                duration: duration,
                ease: ease,
                stagger: stagger,
                absolute: true,
                onEnter: (elements) => gsap.fromTo(elements,
                    { opacity: 0, y: 15 },
                    { opacity: 1, y: 0, duration, stagger, ease, overwrite: "auto" }
                ),
                onLeave: (elements) => gsap.to(elements,
                    { opacity: 0, y: -15, duration, onComplete: () => elements.forEach(el => el.remove()), overwrite: "auto" }
                ),
                onComplete: () => {
                    if (containerRef.current) containerRef.current.style.minHeight = '';
                }
            });
            flipStateRef.current = null;
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [reducedMotion, duration, ease, stagger, flipIdSelector, depsChanged]);
}
