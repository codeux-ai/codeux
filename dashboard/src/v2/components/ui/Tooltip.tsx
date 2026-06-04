import type { FunctionComponent, ComponentChildren } from "preact";
import { useEffect, useRef, useState, useLayoutEffect } from "preact/hooks";
import { createPortal } from "preact/compat";
import gsap from "gsap";
import { tooltipMotion } from "../../utils/motion.js";
import { useGsapDurations, GSAP_EASINGS } from "../../lib/motion/constants.js";
import { calculatePosition } from "../../lib/positioning/index.js";

interface TooltipProps {
    children: ComponentChildren;
    content: ComponentChildren;
    position?: "top" | "bottom" | "left" | "right";
    className?: string;
    triggerClassName?: string;
    unstyled?: boolean;
    delay?: number;
}

export const Tooltip: FunctionComponent<TooltipProps> = ({
    children,
    content,
    position = "bottom",
    className = "",
    triggerClassName = "",
    unstyled = false,
    delay = 300
}) => {
    const [isVisible, setIsVisible] = useState(false);
    const [isRendered, setIsRendered] = useState(false);
    const wrapperRef = useRef<HTMLDivElement>(null);
    const tooltipRef = useRef<HTMLDivElement>(null);
    const hoverTimeout = useRef<number | null>(null);

    const [coords, setCoords] = useState({ top: 0, left: 0 });
    const durations = useGsapDurations();

    const handleMouseEnter = () => {
        if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
        hoverTimeout.current = window.setTimeout(() => {
            setIsVisible(true);
            setIsRendered(true);
        }, delay);
    };

    const handleFocus = (e: FocusEvent) => {
        // Only trigger on keyboard focus (focus-visible) to maintain parity
        try {
            if (!(e.target as Element).matches(":focus-visible")) return;
        } catch {
            // fallback for older browsers or test environments
        }
        handleMouseEnter();
    };

    const handleMouseLeave = () => {
        if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
        hoverTimeout.current = window.setTimeout(() => {
            setIsVisible(false);
        }, 150);
    };

    useLayoutEffect(() => {
        if (!tooltipRef.current) return;

        gsap.killTweensOf(tooltipRef.current);

        if (isVisible && wrapperRef.current) {
            const triggerRect = wrapperRef.current.getBoundingClientRect();
            const contentRect = tooltipRef.current.getBoundingClientRect();

            const { top, left } = calculatePosition({
                triggerRect,
                contentRect,
                position,
                align: "center",
                gap: 8,
                padding: 8
            });

            setCoords({ top, left });

            // Calculate precise transform origin relative to tooltip
            const triggerCenterX = triggerRect.left + triggerRect.width / 2;
            const triggerCenterY = triggerRect.top + triggerRect.height / 2;

            const originX = triggerCenterX - left;
            const originY = triggerCenterY - top;

            gsap.set(tooltipRef.current, { transformOrigin: `${originX}px ${originY}px` });

            gsap.fromTo(
                tooltipRef.current,
                { opacity: 0, scale: 0 },
                { opacity: 1, scale: 1, duration: durations.fast, ease: GSAP_EASINGS.spring, overwrite: "auto" }
            );
        } else if (isRendered) {
            gsap.to(tooltipRef.current, {
                opacity: 0,
                scale: 0,
                duration: durations.fast,
                ease: GSAP_EASINGS.smooth,
                overwrite: "auto",
                onComplete: () => setIsRendered(false)
            });
        }
    }, [isVisible, isRendered, position]);

    useEffect(() => {
        const handleScroll = () => {
            if (isVisible) {
                if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
                setIsVisible(false);
            }
        };

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape" && isVisible) {
                e.preventDefault();
                e.stopPropagation();
                if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
                setIsVisible(false);
                setIsRendered(false);
            }
        };

        if (isVisible) {
            document.addEventListener("keydown", handleKeyDown, { capture: true });
            window.addEventListener("scroll", handleScroll, { capture: true, passive: true });
        }

        return () => {
            document.removeEventListener("keydown", handleKeyDown, { capture: true });
            window.removeEventListener("scroll", handleScroll, { capture: true });
            if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
        };
    }, [isVisible]);

    // Return just the children if no content
    if (!content) return <>{children}</>;

    // Generate unique ID for ARIA wiring
    const tooltipId = `tooltip-${Math.random().toString(36).substr(2, 9)}`;

    return (
        <div
            ref={wrapperRef}
            className={`inline-flex relative ${triggerClassName}`}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
            onFocusCapture={handleFocus}
            onBlurCapture={handleMouseLeave}
            aria-describedby={isVisible ? tooltipId : undefined}
        >
            {children}
            {isRendered && createPortal(
                <div
                    id={tooltipId}
                    ref={tooltipRef}
                    className={unstyled
                        ? `fixed z-[9999] pointer-events-none bg-transparent p-0 shadow-none ${className}`
                        : `fixed z-[9999] px-2.5 py-1.5 text-xs font-medium text-white bg-slate-900 dark:bg-black rounded-lg shadow-xl pointer-events-none ${className.includes("whitespace-") ? className : "whitespace-nowrap " + className}`}
                    style={{ top: coords.top, left: coords.left }}
                    role="tooltip"
                >
                    {content}
                </div>,
                document.body
            )}
        </div>
    );
};
