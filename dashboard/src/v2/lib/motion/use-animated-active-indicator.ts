import { useLayoutEffect, useState } from "preact/hooks";
import type { RefObject } from "preact";
import { useReducedMotionSafe } from "./useReducedMotionSafe.js";
import { GSAP_DURATIONS, GSAP_EASINGS } from "./constants.js";

interface IndicatorStyle {
    transform: string;
    width: string;
    opacity: number;
    transition?: string;
}

interface UseAnimatedActiveIndicatorResult {
    style: IndicatorStyle;
    isReady: boolean;
}

/**
 * Measures the active element in a segmented control or tab strip and provides
 * style properties to animate an absolutely-positioned active indicator underneath it.
 *
 * @param containerRef Reference to the parent container element.
 * @param activeIndex The index of the currently active child element (zero-based).
 * @param childSelector An optional CSS selector to find valid children within the container. Defaults to '[role="tab"]'.
 * @returns An object containing `style` properties and an `isReady` boolean.
 */
export function useAnimatedActiveIndicator(
    containerRef: RefObject<HTMLElement>,
    activeIndex: number,
    childSelector: string = '[role="tab"]'
): UseAnimatedActiveIndicatorResult {
    const [style, setStyle] = useState<{ transform: string; width: string; opacity: number; }>({
        transform: "translateX(0px)",
        width: "0px",
        opacity: 0,
    });
    const [isReady, setIsReady] = useState(false);

    useLayoutEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const measure = () => {
            const children = Array.from(container.querySelectorAll<HTMLElement>(childSelector));
            const activeChild = children[activeIndex];

            if (activeChild) {
                // Determine the offset and width
                const offsetLeft = activeChild.offsetLeft ?? 0;
                const offsetWidth = activeChild.offsetWidth ?? 0;

                setStyle({
                    transform: `translateX(${offsetLeft}px)`,
                    width: `${offsetWidth}px`,
                    opacity: 1,
                });
                setIsReady(true);
            } else {
                setStyle(prev => ({ ...prev, opacity: 0 }));
            }
        };

        // Measure immediately
        measure();

        // Optional: Measure on fonts loaded in case they change layout
        document.fonts?.ready.then(measure);

        // Measure on window resize or when elements inside change size
        const observer = new ResizeObserver(() => {
            measure();
        });

        observer.observe(container);
        const children = Array.from(container.querySelectorAll<HTMLElement>(childSelector));
        children.forEach((child) => {
            if (child instanceof Element) {
                observer.observe(child);
            }
        });

        return () => {
            observer.disconnect();
        };
    }, [containerRef, activeIndex, childSelector]);

    const motionStyle = useReducedMotionSafe<IndicatorStyle>(
        {
            ...style,
            transition: isReady
                ? `transform ${GSAP_DURATIONS.base}s cubic-bezier(0.4, 0, 0.2, 1), width ${GSAP_DURATIONS.base}s cubic-bezier(0.4, 0, 0.2, 1)`
                : 'none'
        },
        {
            ...style,
            transition: 'none'
        }
    );

    return {
        style: motionStyle,
        isReady
    };
}
