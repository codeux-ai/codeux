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
    delay = 150
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
        handleMouseEnter();
    };

    const handleMouseLeave = () => {
        if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
        setIsVisible(false);
    };

    const handleKeyDownCapture = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
            if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
            setIsVisible(false);
        }
    };

    useLayoutEffect(() => {
        if (isVisible && wrapperRef.current && tooltipRef.current) {
            const { top, left } = calculatePosition({
                triggerRect: wrapperRef.current.getBoundingClientRect(),
                contentRect: tooltipRef.current.getBoundingClientRect(),
                position,
                align: "center",
                gap: 8,
                padding: 8
            });
            setCoords({ top, left });
        }
    }, [isVisible, position]);

    useLayoutEffect(() => {
        if (!tooltipRef.current) return;

        gsap.killTweensOf(tooltipRef.current);

        if (isVisible) {
            tooltipMotion.enter(tooltipRef.current, position, { duration: durations.fast, ease: GSAP_EASINGS.spring });
        } else if (isRendered) {
            tooltipMotion.exit(tooltipRef.current, position, () => setIsRendered(false), { duration: durations.fast, ease: GSAP_EASINGS.smooth });
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
                if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
                setIsVisible(false);
            }
        };

        if (isVisible) {
            document.addEventListener("keydown", handleKeyDown);
            window.addEventListener("scroll", handleScroll, { capture: true, passive: true });
        }

        return () => {
            document.removeEventListener("keydown", handleKeyDown);
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
            onKeyDownCapture={handleKeyDownCapture}
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
