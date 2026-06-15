import { useLayoutEffect, useState, useMemo } from "preact/hooks";
import type { RefObject } from "preact";
import { useReducedMotionSafe } from "./useReducedMotionSafe.js";
import { GSAP_DURATIONS } from "./constants.js";
import { MOTION_TOKENS } from "./tokens.js";

interface IndicatorStyle {
    transform: string;
    width?: string;
    height?: string;
    opacity: number;
    transition?: string;
}

interface UseAnimatedActiveIndicatorResult {
    style: IndicatorStyle;
    isReady: boolean;
}

export type IndicatorOrientation = 'horizontal' | 'vertical';

/**
 * Measures the active element in a container and provides
 * style properties to animate an absolutely-positioned active indicator.
 *
 * @param containerRef Reference to the parent container element.
 * @param activeIndex The index of the currently active child element (zero-based).
 * @param childSelector An optional CSS selector to find valid children within the container. Defaults to '[role="tab"]'.
 * @param orientation The orientation of the indicator ('horizontal' or 'vertical'). Defaults to 'horizontal'.
 * @returns An object containing `style` properties and an `isReady` boolean.
 */
export function useAnimatedActiveIndicator(
    containerRef: RefObject<HTMLElement>,
    activeIndex: number,
    childSelector: string = '[role="tab"]',
    orientation: IndicatorOrientation = 'horizontal'
): UseAnimatedActiveIndicatorResult {
    const [layout, setLayout] = useState({
        offset: 0,
        size: 0,
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
                // Determine the offset and size based on orientation
                const offset = orientation === 'horizontal' ? activeChild.offsetLeft : activeChild.offsetTop;
                const size = orientation === 'horizontal' ? activeChild.offsetWidth : activeChild.offsetHeight;

                setLayout({
                    offset,
                    size,
                    opacity: 1,
                });
                setIsReady(true);
            } else {
                setLayout(prev => ({ ...prev, opacity: 0 }));
            }
        };

        // Measure immediately
        measure();

        // Optional: Measure on fonts loaded in case they change layout
        if (typeof document !== 'undefined') {
            document.fonts?.ready.then(measure);
        }

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
    }, [containerRef, activeIndex, childSelector, orientation]);

    const baseStyle = useMemo(() => {
        const transform = orientation === 'horizontal'
            ? `translateX(${layout.offset}px)`
            : `translateY(${layout.offset}px)`;

        const sizeProp = orientation === 'horizontal' ? 'width' : 'height';

        return {
            transform,
            [sizeProp]: `${layout.size}px`,
            opacity: layout.opacity,
        } as IndicatorStyle;
    }, [layout, orientation]);

    const motionStyle = useReducedMotionSafe<IndicatorStyle>(
        {
            ...baseStyle,
            transition: isReady
                ? `transform ${GSAP_DURATIONS.base}s ${MOTION_TOKENS.easing.standard}, width ${GSAP_DURATIONS.base}s ${MOTION_TOKENS.easing.standard}, height ${GSAP_DURATIONS.base}s ${MOTION_TOKENS.easing.standard}`
                : 'none'
        },
        {
            ...baseStyle,
            transition: 'none'
        }
    );

    return {
        style: motionStyle,
        isReady
    };
}
