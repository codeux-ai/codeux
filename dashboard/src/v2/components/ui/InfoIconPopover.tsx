import type { FunctionComponent } from "preact";
import { useEffect, useRef, useState, useLayoutEffect } from "preact/hooks";
import { createPortal } from "preact/compat";
import gsap from "gsap";
import { Info, Copy, Check } from "lucide-preact";
import { calculatePosition } from "../../lib/positioning/index.js";

interface InfoIconPopoverProps {
    className?: string;
    title?: string;
    items?: Array<{ key: string; desc: string }>;
    label?: string;
}

export const InfoIconPopover: FunctionComponent<InfoIconPopoverProps> = ({ className = "", title = "Placeholders", items = [], label }) => {
    const [isVisible, setIsVisible] = useState(false);
    const [isRendered, setIsRendered] = useState(false);

    const wrapperRef = useRef<HTMLButtonElement>(null);
    const popoverRef = useRef<HTMLDivElement>(null);
    const previousFocusRef = useRef<HTMLElement | null>(null);
    const hoverTimeout = useRef<number | null>(null);
    const leaveTimeout = useRef<number | null>(null);

    const [coords, setCoords] = useState({ top: 0, left: 0 });
    const [copiedKey, setCopiedKey] = useState<string | null>(null);

    const hasInteractiveContent = items && items.length > 0;

    const handleMouseEnter = () => {
        if (leaveTimeout.current) clearTimeout(leaveTimeout.current);
        if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
        hoverTimeout.current = window.setTimeout(() => {
            setIsVisible(true);
            setIsRendered(true);
        }, 150);
    };

    const handleMouseLeave = () => {
        if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
        if (leaveTimeout.current) clearTimeout(leaveTimeout.current);
        leaveTimeout.current = window.setTimeout(() => {
            setIsVisible(false);
        }, 150); // Small delay to allow mouse transition
    };

    const handleCopy = (key: string) => {
        navigator.clipboard.writeText(key);
        setCopiedKey(key);
        setTimeout(() => setCopiedKey(null), 2000);
    };

    const handleClick = () => {
        if (isVisible) {
            setIsVisible(false);
        } else {
            if (hasInteractiveContent) {
                previousFocusRef.current = document.activeElement as HTMLElement | null;
            }
            setIsVisible(true);
            setIsRendered(true);
        }
    };

    useLayoutEffect(() => {
        if (isVisible && wrapperRef.current && popoverRef.current) {
            const { top, left } = calculatePosition({
                triggerRect: wrapperRef.current.getBoundingClientRect(),
                contentRect: popoverRef.current.getBoundingClientRect(),
                position: "top",
                align: "center",
                gap: 12,
                padding: 12
            });
            setCoords({ top, left });
        }
    }, [isVisible]);

    useLayoutEffect(() => {
        if (!popoverRef.current) return;

        gsap.killTweensOf(popoverRef.current);

        if (isVisible) {
            gsap.fromTo(
                popoverRef.current,
                { opacity: 0, scale: 0.9, y: 10 },
                { opacity: 1, scale: 1, y: 0, duration: 0.4, ease: "back.out(1.7)" }
            );
        } else if (isRendered) {
            gsap.to(popoverRef.current, {
                opacity: 0,
                scale: 0.95,
                duration: 0.15,
                ease: "power2.in",
                onComplete: () => setIsRendered(false)
            });
        }
    }, [isVisible, isRendered]);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape" && isVisible) {
                if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
                if (leaveTimeout.current) clearTimeout(leaveTimeout.current);
                setIsVisible(false);
                if (hasInteractiveContent) {
                    if (wrapperRef.current) {
                        wrapperRef.current.focus();
                    } else if (previousFocusRef.current) {
                        previousFocusRef.current.focus();
                    }
                }
            }
        };

        if (isVisible) {
            document.addEventListener("keydown", handleKeyDown);
        }

        return () => {
            document.removeEventListener("keydown", handleKeyDown);
            if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
            if (leaveTimeout.current) clearTimeout(leaveTimeout.current);
        };
    }, [isVisible]);

    return (
        <button
            type="button"
            ref={wrapperRef}
            className={`inline-flex relative cursor-help text-left ${className}`}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
            onClick={handleClick}
            onFocusCapture={handleMouseEnter}
            onBlurCapture={handleMouseLeave}
            aria-label={label || "More information about this field"}
            aria-haspopup={hasInteractiveContent ? "dialog" : "true"}
            aria-expanded={isVisible}
            aria-describedby={!hasInteractiveContent && isVisible ? "info-popover-panel" : undefined}
        >
            <Info className="w-4 h-4 text-slate-400 hover:text-signal-500 transition-colors" strokeWidth={1.5} />

            {isRendered && createPortal(
                <div
                    id="info-popover-panel"
                    ref={popoverRef}
                    className="fixed z-[9999] p-4 bg-white/90 dark:bg-void-700/90 backdrop-blur-2xl rounded-xl shadow-[0_20px_40px_rgba(0,0,0,0.12)] dark:shadow-[0_20px_40px_rgba(0,0,0,0.4)] border border-black/[0.06] dark:border-white/[0.06] w-64"
                    style={{ top: coords.top, left: coords.left }}
                    role={hasInteractiveContent ? "dialog" : "tooltip"}
                    tabIndex={-1}
                    aria-label={title || "Information"}
                    onMouseEnter={handleMouseEnter}
                    onMouseLeave={handleMouseLeave}
                >
                    {title ? (
                        <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400 mb-3">
                            {title}
                        </div>
                    ) : null}
                    <ul className="space-y-2">
                        {items.map(p => (
                            <li key={p.key} className="flex flex-col gap-0.5 group">
                                <div className="flex items-center gap-2">
                                    <span className="font-mono text-[11px] text-signal-500">{p.key}</span>
                                    <button
                                        type="button"
                                        onClick={() => handleCopy(p.key)}
                                        className="opacity-0 group-hover:opacity-100 transition-opacity focus:opacity-100 p-0.5 hover:bg-slate-100 dark:hover:bg-void-600 rounded"
                                        title="Copy placeholder"
                                    >
                                        {copiedKey === p.key ? (
                                            <Check className="w-3 h-3 text-green-500" strokeWidth={2} />
                                        ) : (
                                            <Copy className="w-3 h-3 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300" strokeWidth={1.5} />
                                        )}
                                    </button>
                                </div>
                                <span className="text-[11px] text-slate-600 dark:text-slate-300">{p.desc}</span>
                            </li>
                        ))}
                    </ul>
                </div>,
                document.body
            )}
        </button>
    );
};
