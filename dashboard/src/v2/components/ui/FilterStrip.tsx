import { useRef } from "preact/hooks";
import { useAnimatedActiveIndicator } from "../../lib/motion/index.js";

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
    const listRef = useRef<HTMLDivElement>(null);

    // Find active index
    const activeIndex = options.findIndex((option) => {
        const isObj = typeof option === "object" && option !== null && "value" in option;
        const value = isObj ? option.value : (option as T);
        return value === active;
    });

    const indicator = useAnimatedActiveIndicator(listRef, activeIndex);

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
        <div ref={listRef} className="relative flex gap-1 p-1 bg-black/[0.04] dark:bg-white/[0.04] rounded-xl overflow-x-auto scrollbar-hide max-w-full" role="tablist">
            {/* Animated active indicator background */}
            <div
                className={`absolute top-1 bottom-1 left-0 z-0 rounded-lg pointer-events-none bg-white dark:bg-void-700 shadow-[0_1px_4px_rgba(0,0,0,0.08)] dark:shadow-[0_1px_4px_rgba(0,0,0,0.3)] ring-1 ring-black/5 dark:ring-white/10`}
                style={{
                    ...indicator.style,
                    // If not ready, we rely on opacity: 0 from the hook so it doesn't flash in the wrong place
                }}
            />

            {options.map((option, idx) => {
                const isObj = typeof option === "object" && option !== null && "value" in option;
                const value = isObj ? option.value : (option as T);
                const label = isObj ? option.label : (option as string);
                const isActive = active === value;

                return (
                    <button
                        key={value}
                        type="button"
                        role="tab"
                        aria-selected={isActive}
                        tabIndex={isActive ? 0 : -1}
                        onClick={() => onChange(value)}
                        onKeyDown={(e) => handleKeyDown(e as any, idx)}
                        // Note the z-10 so the button text is on top of the absolute indicator behind it
                        className={`relative z-10 flex-none focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50 focus-visible:ring-offset-1 focus-visible:ring-offset-white dark:focus-visible:ring-offset-void-800 text-xs font-semibold tracking-wide px-3 py-1.5 rounded-lg transition-colors duration-200 touch-target ${
                            isActive
                                ? 'text-slate-900 dark:text-white'
                                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-black/5 dark:hover:bg-white/5'
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
