/**
 * Generic tab filter strip. Pass a const array of option strings,
 * the active value, and an onChange handler.
 */
export function FilterStrip<T extends string>({
    options,
    active,
    onChange,
}: {
    options: readonly T[];
    active: T;
    onChange: (value: T) => void;
}) {
    return (
        <div className="flex gap-1 p-1 bg-black/[0.04] dark:bg-white/[0.04] rounded-xl" role="tablist">
            {options.map((option) => (
                <button
                    key={option}
                    role="tab"
                    aria-selected={active === option}
                    onClick={() => onChange(option)}
                    className={`focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50 focus-visible:ring-offset-1 text-xs font-semibold tracking-wide px-3 py-1.5 rounded-lg transition-all duration-200 ${
                        active === option
                            ? 'bg-white dark:bg-void-700 text-slate-900 dark:text-white shadow-[0_1px_4px_rgba(0,0,0,0.08)] dark:shadow-[0_1px_4px_rgba(0,0,0,0.3)]'
                            : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
                    }`}
                >
                    {option}
                </button>
            ))}
        </div>
    );
}
