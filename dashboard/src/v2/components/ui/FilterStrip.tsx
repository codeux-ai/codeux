import { useRef, useLayoutEffect } from "preact/hooks";
import { gsap } from "gsap";
import { useGsapDurations, GSAP_INTERACTION_TOKENS, useGsapInteractionTokens } from "../../lib/motion/constants.js";
import { useInteractionTokens } from "../../lib/motion/tokens.js";
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
    ariaLabel,
    ariaLabelledBy,
}: {
    options: readonly (T | { value: T; label: string; ariaLabel?: string })[];
    active: T;
    onChange: (value: T) => void;
    showClear?: boolean;
    onClear?: () => void;
    ariaLabel?: string;
    ariaLabelledBy?: string;
}) {
    const listRef = useRef<HTMLDivElement>(null);

    // Find active index
    const activeIndex = options.findIndex((option) => {
        const isObj = typeof option === "object" && option !== null && "value" in option;
        const value = isObj ? option.value : (option as T);
        return value === active;
    });

    const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);
    const pillRef = useRef<HTMLDivElement>(null);
    const isFirstRender = useRef(true);
    const gsapTokens = useGsapInteractionTokens();
  const durations = useGsapDurations();
  const reducedMotion = useReducedMotion();
    const tokens = useInteractionTokens();

    useLayoutEffect(() => {
        const btn = buttonRefs.current[activeIndex];
        if (!btn || !pillRef.current) return;

        if (isFirstRender.current) {
            gsap.set(pillRef.current, { x: btn.offsetLeft, width: btn.offsetWidth });
            isFirstRender.current = false;
        } else {
            gsap.to(pillRef.current, {
                x: btn.offsetLeft,
                width: btn.offsetWidth,
                duration: gsapTokens.selectionMovement.duration,
                ease: 'power2.out'
            });
        }
    }, [activeIndex, durations.base, options]);

    const handleKeyDown = (e: KeyboardEvent, index: number) => {
        let newIndex = index;
        if (e.key === "ArrowRight") {
            e.preventDefault();
            newIndex = (index + 1) % options.length;
        } else if (e.key === "ArrowLeft") {
            e.preventDefault();
            newIndex = (index - 1 + options.length) % options.length;
        } else if (e.key === "Home") {
            e.preventDefault();
            newIndex = 0;
        } else if (e.key === "End") {
            e.preventDefault();
            newIndex = options.length - 1;
        }

        if (newIndex !== index) {
            const tabs = listRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
            if (tabs && tabs[newIndex]) {
                tabs[newIndex].focus();
            }
        }
    };

    return (
        <div ref={listRef} className="relative flex gap-1 p-1 bg-black/[0.04] dark:bg-white/[0.04] rounded-xl overflow-x-auto scrollbar-hide max-w-full" role="tablist" aria-label={ariaLabel} aria-labelledby={ariaLabelledBy}>
            {/* Animated active indicator background */}
            <div
                ref={pillRef}
                className="absolute top-1 bottom-1 left-0 z-0 rounded-lg pointer-events-none bg-white dark:bg-void-700 shadow-[0_1px_4px_rgba(0,0,0,0.08)] dark:shadow-[0_1px_4px_rgba(0,0,0,0.3)] ring-1 ring-black/5 dark:ring-white/10"
            />

            {options.map((option, idx) => {
                const isObj = typeof option === "object" && option !== null && "value" in option;
                const value = isObj ? option.value : (option as T);
                const label = isObj ? option.label : (option as string);
                const optionAriaLabel = isObj ? option.ariaLabel : undefined;
                const isActive = active === value;

                return (
                    <button
                        ref={(el) => { buttonRefs.current[idx] = el; }}
                        key={value}
                        type="button"
                        style={{ transitionDuration: tokens.controlFeedback.duration, transitionTimingFunction: tokens.controlFeedback.ease }}
                        role="tab"
                        aria-label={optionAriaLabel}
                        aria-selected={isActive}
                        tabIndex={isActive ? 0 : -1}
                        onClick={() => onChange(value)}
                        onKeyDown={(e) => handleKeyDown(e as any, idx)}
                        // Note the z-10 so the button text is on top of the absolute indicator behind it
                        className={`relative z-10 flex-none focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-void-800 text-xs font-semibold tracking-wide px-3 py-1.5 rounded-lg transition-colors active:brightness-95 dark:active:brightness-110 touch-target ${
                            isActive
                                ? 'text-slate-900 dark:text-white'
                                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                        }`}
                    >
                        {label}
                    </button>
                );
            })}

            {showClear && onClear && (
                <button
                    type="button"
                    style={{ transitionDuration: tokens.controlFeedback.duration, transitionTimingFunction: tokens.controlFeedback.ease }}
                    onClick={onClear}
                    aria-label={`Clear filters${ariaLabel ? ` for ${ariaLabel}` : ''}`}
                    className="relative z-10 flex-none focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50 focus-visible:ring-offset-1 text-xs font-semibold tracking-wide px-3 py-1.5 rounded-lg transition-all overflow-hidden animate-in fade-in zoom-in-95 touch-target ml-1 border-l border-slate-300 dark:border-slate-700 text-slate-500 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 hover:bg-slate-200/50 dark:hover:bg-void-600/50"
                >
                    Clear All
                </button>
            )}
        </div>
    );
}
