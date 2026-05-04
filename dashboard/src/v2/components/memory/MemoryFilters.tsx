import type { FunctionComponent } from "preact";
import type { Signal } from "@preact/signals";
import { Search, X } from "lucide-preact";

interface MemoryFiltersProps {
    searchQuery: Signal<string>;
}

export const MemoryFilters: FunctionComponent<MemoryFiltersProps> = ({
    searchQuery,
}) => {
    return (
        <div className="relative w-full max-w-md">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" strokeWidth={2} />
            <input
                type="text"
                value={searchQuery.value}
                onInput={(e) => searchQuery.value = (e.target as HTMLInputElement).value}
                placeholder="Search memories…"
                className="w-full pl-10 pr-10 py-2.5 rounded-xl text-sm font-medium
                           bg-white dark:bg-void-800
                           border border-slate-200 dark:border-void-700
                           text-slate-700 dark:text-slate-300
                           placeholder:text-slate-400
                           focus:outline-none focus:ring-2 focus:ring-signal-500/20 focus:border-signal-500/40
                           transition-[border-color,box-shadow] duration-200"
            />
            {searchQuery.value && (
                <button onClick={() => searchQuery.value = ""}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full
                               flex items-center justify-center bg-black/[0.04] dark:bg-white/[0.04]
                               hover:bg-black/[0.08] dark:hover:bg-white/[0.08] transition-colors duration-200">
                    <X className="w-3.5 h-3.5 text-slate-500" strokeWidth={2} />
                </button>
            )}
        </div>
    );
};
