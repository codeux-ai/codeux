import type { FunctionComponent } from "preact";
import { useEffect, useRef, useState, useLayoutEffect } from "preact/hooks";
import { createPortal } from "preact/compat";
import gsap from "gsap";
import { Info } from "lucide-preact";

interface InfoIconPopoverProps {
    className?: string;
    title?: string;
    items?: Array<{ key: string; desc: string }>;
}

export const InfoIconPopover: FunctionComponent<InfoIconPopoverProps> = ({ className = "", title = "Placeholders", items = [] }) => {
    const [isVisible, setIsVisible] = useState(false);
    const [isRendered, setIsRendered] = useState(false);

    const wrapperRef = useRef<HTMLDivElement>(null);
    const popoverRef = useRef<HTMLDivElement>(null);
    const hoverTimeout = useRef<number | null>(null);

    const [coords, setCoords] = useState({ top: 0, left: 0 });

    const handleMouseEnter = () => {
        if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
        hoverTimeout.current = window.setTimeout(() => {
            setIsVisible(true);
            setIsRendered(true);
        }, 150);
    };

    const handleMouseLeave = () => {
        if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
        setIsVisible(false);
    };

    const handleClick = () => {
        if (isVisible) {
            setIsVisible(false);
        } else {
            setIsVisible(true);
            setIsRendered(true);
        }
    };

    useLayoutEffect(() => {
        if (isVisible && wrapperRef.current && popoverRef.current) {
            const wrapperRect = wrapperRef.current.getBoundingClientRect();
            const popoverRect = popoverRef.current.getBoundingClientRect();

            const gap = 12;
            let top = wrapperRect.top - popoverRect.height - gap;
            let left = wrapperRect.left + (wrapperRect.width / 2) - (popoverRect.width / 2);

            // Boundary checks
            const padding = 12;
            if (left < padding) left = padding;
            if (left + popoverRect.width > window.innerWidth - padding) {
                left = window.innerWidth - popoverRect.width - padding;
            }
            if (top < padding) {
                // If it doesn't fit on top, put it below
                top = wrapperRect.bottom + gap;
            }
            if (top + popoverRect.height > window.innerHeight - padding) {
                top = window.innerHeight - popoverRect.height - padding;
            }

            setCoords({ top, left });
        }
    }, [isVisible]);

    useLayoutEffect(() => {
        if (!popoverRef.current) return;

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
        return () => {
            if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
        };
    }, []);

    return (
        <div
            ref={wrapperRef}
            className={`inline-flex relative cursor-help ${className}`}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
            onClick={handleClick}
            onFocusCapture={handleMouseEnter}
            onBlurCapture={handleMouseLeave}
        >
            <Info className="w-4 h-4 text-slate-400 hover:text-signal-500 transition-colors" strokeWidth={1.5} />

            {isRendered && createPortal(
                <div
                    ref={popoverRef}
                    className="fixed z-[9999] p-4 bg-white/90 dark:bg-void-700/90 backdrop-blur-2xl rounded-xl shadow-[0_20px_40px_rgba(0,0,0,0.12)] dark:shadow-[0_20px_40px_rgba(0,0,0,0.4)] border border-black/[0.06] dark:border-white/[0.06] w-64 pointer-events-none"
                    style={{ top: coords.top, left: coords.left }}
                    role="tooltip"
                >
                    {title ? (
                        <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400 mb-3">
                            {title}
                        </div>
                    ) : null}
                    <ul className="space-y-2">
                        {items.map(p => (
                            <li key={p.key} className="flex flex-col gap-0.5">
                                <span className="font-mono text-[11px] text-signal-500">{p.key}</span>
                                <span className="text-[11px] text-slate-600 dark:text-slate-300">{p.desc}</span>
                            </li>
                        ))}
                    </ul>
                </div>,
                document.body
            )}
        </div>
    );
};
