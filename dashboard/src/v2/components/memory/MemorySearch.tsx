import { FunctionComponent } from "preact";
import { Search } from "lucide-preact";
import { searchQuerySignal } from "./memoryState.js";

export const MemorySearch: FunctionComponent = () => {
    return (
        <div className="relative group w-full sm:w-[280px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-focus-within:text-signal-500 transition-colors duration-200" />
            <input
                aria-label="Search memory"
                type="text"
                placeholder="Search memory..."
                value={searchQuerySignal.value}
                onInput={(e) => searchQuerySignal.value = (e.target as HTMLInputElement).value}
                className="w-full bg-black/[0.04] dark:bg-white/[0.04] border border-black/[0.08] dark:border-white/[0.08] rounded-xl pl-9 pr-4 py-2.5 text-sm outline-none focus:border-signal-500/40 focus:bg-signal-500/5 transition-all duration-200 text-slate-800 dark:text-slate-200 font-mono"
            />
            {searchQuerySignal.value && (
                <button
                    aria-label="Clear search"
                    onClick={() => searchQuerySignal.value = ""}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-xs font-mono font-bold"
                >
                    ESC
                </button>
            )}
        </div>
    );
};
