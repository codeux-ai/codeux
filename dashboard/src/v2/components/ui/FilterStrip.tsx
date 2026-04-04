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
    return (
        <div className="flex gap-1 p-1 bg-black/[0.04] dark:bg-white/[0.04] rounded-xl overflow-x-auto scrollbar-hide max-w-full" role="tablist">
            {options.map((option) => {
                const isObj = typeof option === "object" && option !== null && "value" in option;
                const value = isObj ? option.value : (option as T);
                const label = isObj ? option.label : (option as string);

                return (
                    <button
                        key={value}
                        type="button"
                        role="tab"
                        aria-selected={active === value}
                        onClick={() => onChange(value)}
                        className={`flex-none focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50 focus-visible:ring-offset-1 text-xs font-semibold tracking-wide px-3 py-1.5 rounded-lg transition-all duration-200 touch-target ${
                            active === value
                                ? 'bg-white dark:bg-void-700 text-slate-900 dark:text-white shadow-[0_1px_4px_rgba(0,0,0,0.08)] dark:shadow-[0_1px_4px_rgba(0,0,0,0.3)]'
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
                    className="flex-none focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50 focus-visible:ring-offset-1 text-xs font-semibold tracking-wide px-3 py-1.5 rounded-lg transition-all duration-300 overflow-hidden animate-in fade-in zoom-in-95 touch-target ml-1 border-l border-slate-300 dark:border-slate-700 text-slate-500 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 hover:bg-slate-200/50 dark:hover:bg-void-600/50"
                >
                    Clear All
                </button>
            )}
        </div>
    );
}
