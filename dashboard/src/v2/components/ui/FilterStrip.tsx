import { X } from "lucide-preact";

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
    label,
}: {
    options: readonly (T | { value: T; label: string })[];
    active: T;
    onChange: (value: T) => void;
    showClear?: boolean;
    onClear?: () => void;
    label?: string;
}) {
    const isActiveFiltered = active !== "all";
    
    return (
        <div className="flex flex-wrap items-center gap-2">
            {label && (
                <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400 dark:text-slate-500 mr-1">
                    {label}
                </span>
            )}
            <div className="flex gap-1 p-1 bg-black/[0.04] dark:bg-white/[0.04] rounded-xl overflow-x-auto scrollbar-hide max-w-full" role="tablist">
                {options.map((option) => {
                    const isObj = typeof option === "object" && option !== null && "value" in option;
                    const value = isObj ? option.value : (option as T);
                    const optionLabel = isObj ? option.label : (option as string);
                    const isSelected = active === value;

                    return (
                        <button
                            key={value}
                            type="button"
                            role="tab"
                            aria-selected={isSelected}
                            onClick={() => onChange(value)}
                            className={`flex-none focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50 focus-visible:ring-offset-1 text-xs font-semibold tracking-wide px-3 py-1.5 rounded-lg transition-all duration-200 touch-target flex items-center gap-1.5 ${
                                isSelected
                                    ? 'bg-white dark:bg-void-700 text-slate-900 dark:text-white shadow-[0_1px_4px_rgba(0,0,0,0.08)] dark:shadow-[0_1px_4px_rgba(0,0,0,0.3)]'
                                    : 'text-slate-500 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                            }`}
                        >
                            {optionLabel}
                            {isSelected && value !== "all" && (
                                <span className="w-1.5 h-1.5 rounded-full bg-signal-500 shadow-[0_0_6px_rgba(0,224,160,0.6)]" />
                            )}
                        </button>
                    );
                })}

                {(showClear || isActiveFiltered) && onClear && (
                    <button
                        type="button"
                        onClick={onClear}
                        className="flex-none focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50 focus-visible:ring-offset-1 text-xs font-bold uppercase tracking-wider px-3 py-1.5 rounded-lg transition-all duration-300 touch-target ml-1 border-l border-slate-300 dark:border-slate-700 text-ember-600 dark:text-ember-400 hover:bg-ember-500/[0.08]"
                        title="Clear filters"
                    >
                        <X className="w-3 h-3 inline-block mr-1 -mt-0.5" strokeWidth={3} />
                        Reset
                    </button>
                )}
            </div>
        </div>
    );
}
