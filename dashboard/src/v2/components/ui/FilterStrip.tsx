import { useRef, useState, useLayoutEffect, useEffect } from "preact/hooks";
import { useReducedMotion } from "../../hooks/use-reduced-motion.js";

/**
 * Generic tab filter strip. Pass a const array of option strings,
 * the active value, and an onChange handler.
 */
export function FilterStrip<T extends string>({
    options,
    active,
    onChange,
    showClear,
    onClear,
}: {
    options: readonly (T | { value: T; label: string })[];
    active: T;
    onChange: (value: T) => void;
    showClear?: boolean;
    onClear?: () => void;
}) {
    const reducedMotion = useReducedMotion();
    const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
    const [pillStyle, setPillStyle] = useState({ width: 0, left: 0, opacity: 0 });

    const updatePillPosition = () => {
        const activeTab = tabRefs.current[active as string];
        if (activeTab) {
            setPillStyle({
                width: activeTab.offsetWidth,
                left: activeTab.offsetLeft,
                opacity: 1,
            });
        }
    };

    useLayoutEffect(() => {
        updatePillPosition();
    }, [active]);

    useEffect(() => {
        window.addEventListener("resize", updatePillPosition);
        return () => window.removeEventListener("resize", updatePillPosition);
    }, [active]);

    return (
        <div className="relative flex gap-1 p-1 bg-black/[0.04] dark:bg-white/[0.04] rounded-xl overflow-x-auto scrollbar-hide max-w-full" role="tablist">
            <div
                className={`absolute left-0 top-1 bottom-1 rounded-lg bg-white/90 dark:bg-void-700/80 shadow-[0_1px_4px_rgba(0,0,0,0.08)] dark:shadow-[0_1px_4px_rgba(0,0,0,0.3)] border border-jade-500/10 dark:border-jade-400/10 ${
                    reducedMotion ? "transition-none" : "transition-all duration-300 ease-[cubic-bezier(0.23,1,0.32,1)]"
                }`}
                style={{
                    width: `${pillStyle.width}px`,
                    transform: `translateX(${pillStyle.left}px)`,
                    opacity: pillStyle.opacity,
                }}
                aria-hidden="true"
            />

            {options.map((option) => {
                const isObj = typeof option === "object" && option !== null && "value" in option;
                const value = isObj ? option.value : (option as T);
                const label = isObj ? option.label : (option as string);

                return (
                    <button
                        key={value}
                        ref={(el) => { tabRefs.current[value as string] = el; }}
                        type="button"
                        role="tab"
                        aria-selected={active === value}
                        onClick={() => onChange(value)}
                        className={`relative z-10 flex-none focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50 focus-visible:ring-offset-1 text-xs font-semibold tracking-wide px-3 py-1.5 rounded-lg transition-all duration-200 touch-target ${
                            active === value
                                ? 'text-slate-900 dark:text-white'
                                : 'text-slate-500 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                        }`}
                    >
                        {label}
                    </button>
                );
            })}

            {showClear && onClear && (
                <button
                    type="button"
                    onClick={onClear}
                    className="relative z-10 flex-none focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50 focus-visible:ring-offset-1 text-xs font-semibold tracking-wide px-3 py-1.5 rounded-lg transition-all duration-300 overflow-hidden animate-in fade-in zoom-in-95 touch-target ml-1 border-l border-slate-300 dark:border-slate-700 text-slate-500 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 hover:bg-slate-200/50 dark:hover:bg-void-600/50"
                >
                    Clear All
                </button>
            )}
        </div>
    );
}
