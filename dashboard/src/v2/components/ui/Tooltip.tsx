import type { FunctionComponent, ComponentChildren } from "preact";
import { useEffect, useRef, useState, useLayoutEffect } from "preact/hooks";
import { createPortal } from "preact/compat";
import gsap from "gsap";

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

    const handleMouseLeave = () => {
        if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
        setIsVisible(false);
    };

    useLayoutEffect(() => {
        if (isVisible && wrapperRef.current && tooltipRef.current) {
            const wrapperRect = wrapperRef.current.getBoundingClientRect();
            const tooltipRect = tooltipRef.current.getBoundingClientRect();

            let top = 0;
            let left = 0;
            const gap = 8; // distance from element

            switch (position) {
                case "top":
                    top = wrapperRect.top - tooltipRect.height - gap;
                    left = wrapperRect.left + (wrapperRect.width / 2) - (tooltipRect.width / 2);
                    break;
                case "bottom":
                    top = wrapperRect.bottom + gap;
                    left = wrapperRect.left + (wrapperRect.width / 2) - (tooltipRect.width / 2);
                    break;
                case "left":
                    top = wrapperRect.top + (wrapperRect.height / 2) - (tooltipRect.height / 2);
                    left = wrapperRect.left - tooltipRect.width - gap;
                    break;
                case "right":
                    top = wrapperRect.top + (wrapperRect.height / 2) - (tooltipRect.height / 2);
                    left = wrapperRect.right + gap;
                    break;
            }

            // Boundary checks
            const padding = 8;
            if (left < padding) left = padding;
            if (left + tooltipRect.width > window.innerWidth - padding) {
                left = window.innerWidth - tooltipRect.width - padding;
            }
            if (top < padding) top = padding;
            if (top + tooltipRect.height > window.innerHeight - padding) {
                top = window.innerHeight - tooltipRect.height - padding;
            }

            setCoords({ top, left });
        }
    }, [isVisible, position]);

    useLayoutEffect(() => {
        if (!tooltipRef.current) return;

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
        return () => {
            if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
        };
    }, []);

    // Return just the children if no content
    if (!content) return <>{children}</>;

    return (
        <div
            ref={wrapperRef}
            className="inline-flex relative"
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
            onFocusCapture={handleMouseEnter}
            onBlurCapture={handleMouseLeave}
        >
            {children}
            {isRendered && createPortal(
                <div
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
