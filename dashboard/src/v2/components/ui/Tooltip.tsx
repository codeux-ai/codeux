import type { FunctionComponent, ComponentChildren } from "preact";
import { useEffect, useRef, useState, useLayoutEffect } from "preact/hooks";
import { createPortal } from "preact/compat";
import gsap from "gsap";
import { calculatePosition } from "../../lib/positioning/index.js";

interface TooltipProps {
    children: ComponentChildren;
    content: ComponentChildren;
    position?: "top" | "bottom" | "left" | "right";
    className?: string;
    delay?: number;
}

export const Tooltip: FunctionComponent<TooltipProps> = ({
    children,
    content,
    position = "bottom",
    className = "",
    delay = 150
}) => {
    const [isVisible, setIsVisible] = useState(false);
    const [isRendered, setIsRendered] = useState(false);
    const wrapperRef = useRef<HTMLDivElement>(null);
    const tooltipRef = useRef<HTMLDivElement>(null);
    const hoverTimeout = useRef<number | null>(null);

    const [coords, setCoords] = useState({ top: 0, left: 0 });

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
        // Add a small delay before hiding to prevent abrupt hide/show transitions
        hoverTimeout.current = window.setTimeout(() => {
            setIsVisible(false);
        }, 150);
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
            gsap.fromTo(
                tooltipRef.current,
                { opacity: 0, scale: 0.9, y: position === "bottom" ? -5 : position === "top" ? 5 : 0, x: position === "right" ? -5 : position === "left" ? 5 : 0 },
                { opacity: 1, scale: 1, y: 0, x: 0, duration: 0.4, ease: "back.out(1.7)" }
            );
        } else if (isRendered) {
            gsap.to(tooltipRef.current, {
                opacity: 0,
                scale: 0.95,
                duration: 0.15,
                ease: "power2.in",
                onComplete: () => setIsRendered(false)
            });
        }
    }, [isVisible, isRendered, position]);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape" && isVisible) {
                if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
                setIsVisible(false);
            }
        };

        if (isVisible) {
            document.addEventListener("keydown", handleKeyDown);
        }

        return () => {
            document.removeEventListener("keydown", handleKeyDown);
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
            className="inline-flex relative"
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
                    className={`fixed z-[9999] px-2.5 py-1.5 text-xs font-medium text-white bg-slate-900 dark:bg-black rounded-lg shadow-xl pointer-events-none whitespace-nowrap ${className}`}
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
