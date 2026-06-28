import type { FunctionComponent, ComponentChildren } from "preact";
import { isValidElement, cloneElement } from "preact";
import { useEffect, useRef, useState, useLayoutEffect, useId } from "preact/hooks";
import { createPortal } from "preact/compat";
import gsap from "gsap";
import { tooltipMotion } from "../../utils/motion.js";
import { useGsapInteractionTokens } from "../../lib/motion/constants.js";
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
    const gsapTokens = useGsapInteractionTokens();
    const gsapCtx = useRef<gsap.Context | null>(null);
    const [tooltipId] = useState(() => `tooltip-${Math.random().toString(36).substr(2, 9)}`);

    const handlePointerEnter = (e: PointerEvent) => {
        if (e.pointerType === "mouse" || e.pointerType === "pen") {
            if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
            hoverTimeout.current = window.setTimeout(() => {
                setIsVisible(true);
                setIsRendered(true);
            }, delay);
        }
    };

    const handleFocus = (e: FocusEvent) => {
        // Only trigger on keyboard focus (focus-visible) to maintain parity
        try {
            if (!(e.target as Element).matches(":focus-visible")) return;
        } catch {
            // fallback for older browsers or test environments
        }
        if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
        hoverTimeout.current = window.setTimeout(() => {
            setIsVisible(true);
            setIsRendered(true);
        }, delay);
    };

    const handlePointerLeave = (e?: PointerEvent | FocusEvent) => {
        if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
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

        if (!gsapCtx.current) {
            gsapCtx.current = gsap.context(() => {});
        }

        gsapCtx.current.add(() => {
            if (!tooltipRef.current) return;
            gsap.killTweensOf(tooltipRef.current);

            if (isVisible) {
                tooltipMotion.enter(tooltipRef.current, position, { duration: gsapTokens.controlFeedback.duration, ease: gsapTokens.controlFeedback.ease });
            } else if (isRendered) {
                tooltipMotion.exit(tooltipRef.current, position, () => setIsRendered(false), { duration: gsapTokens.controlFeedback.duration, ease: gsapTokens.controlFeedback.ease });
            }
        });
    }, [isVisible, isRendered, position]);

    useEffect(() => {
        return () => {
            if (gsapCtx.current) {
                gsapCtx.current.revert();
            }
            if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
        };
    }, []);

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
        };
    }, [isVisible]);

    // Return just the children if no content
    if (!content) return <>{children}</>;

    const triggerElement = isValidElement(children) ? cloneElement(children as preact.VNode<any>, {
        ref: (node: any) => {
            (wrapperRef as any).current = node;
            const childRef = (children as any).ref;
            if (childRef) {
                if (typeof childRef === 'function') childRef(node);
                else childRef.current = node;
            }
        },
        className: `${(children.props as any).className || ''} ${triggerClassName}`.trim(),
        onPointerEnter: (e: PointerEvent) => {
            handlePointerEnter(e);
            (children.props as any).onPointerEnter?.(e);
        },
        onPointerLeave: (e: PointerEvent) => {
            handlePointerLeave(e);
            (children.props as any).onPointerLeave?.(e);
        },
        onFocusCapture: (e: FocusEvent) => {
            handleFocus(e);
            (children.props as any).onFocusCapture?.(e);
        },
        onBlurCapture: (e: FocusEvent) => {
            handlePointerLeave(e);
            (children.props as any).onBlurCapture?.(e);
        },
        "aria-describedby": isRendered ? tooltipId : (children.props as any)["aria-describedby"]
    }) : (
        <span
            ref={wrapperRef as any}
            className={triggerClassName}
            onPointerEnter={handlePointerEnter as any}
            onPointerLeave={handlePointerLeave as any}
            onFocusCapture={handleFocus as any}
            onBlurCapture={handlePointerLeave as any}
            aria-describedby={isRendered ? tooltipId : undefined}
        >
            {children}
        </span>
    );

    return (
        <>
            {triggerElement}
            {isRendered && createPortal(
                <div
                    id={tooltipId}
                    ref={tooltipRef}
                    className={unstyled
                        ? `fixed z-[9999] pointer-events-none bg-transparent p-0 shadow-none ${className}`
                        : `fixed z-[9999] px-2.5 py-1.5 text-xs font-medium text-white bg-slate-900 dark:bg-black rounded-xl shadow-xl pointer-events-none ${className.includes("whitespace-") ? className : "whitespace-nowrap " + className}`}
                    style={{ top: coords.top, left: coords.left }}
                    role="tooltip"
                >
                    {content}
                </div>,
                document.body
            )}
        </>
    );
};
