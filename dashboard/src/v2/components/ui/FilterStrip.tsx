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
        <div className="flex gap-1 p-1 bg-black/[0.04] dark:bg-white/[0.04] rounded-xl">
            {options.map((option) => (
                <button
                    key={option}
                    onClick={() => onChange(option)}
                    className={`text-xs font-semibold tracking-wide px-3 py-1.5 rounded-lg transition-all duration-200 ${
                        active === option
                            ? 'bg-white dark:bg-void-700 text-slate-900 dark:text-white shadow-[0_1px_4px_rgba(0,0,0,0.08)] dark:shadow-[0_1px_4px_rgba(0,0,0,0.3)]'
                            : 'text-slate-500 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                    }`}
                >
                    {option}
                </button>
            ))}
        </div>
    );
}
