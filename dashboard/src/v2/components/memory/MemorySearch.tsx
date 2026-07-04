import { FunctionComponent } from "preact";
import { useState } from "preact/hooks";
import { Search, X } from "lucide-preact";
import { searchQuerySignal } from "./memoryState.js";

export const MemorySearch: FunctionComponent = () => {
    const [clearAnnouncement, setClearAnnouncement] = useState("");

    return (
        <div className="relative group w-full lg:w-[280px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-focus-within:text-signal-500 transition-colors duration-200" />
            <input
                aria-label="Search memory"
                aria-controls="memory-panel"
                type="text"
                placeholder="Search memories, categories..."
                value={searchQuerySignal.value}
                onKeyDown={(e) => {
                    if (e.key === "Escape") {
                        if (searchQuerySignal.value) {
                            setClearAnnouncement("Search cleared");
                            setTimeout(() => setClearAnnouncement(""), 1000);
                        }
                        searchQuerySignal.value = "";
                    }
                }}
                onInput={(e) => {
                    const value = (e.target as HTMLInputElement).value;
                    if (value) {
                        setClearAnnouncement("Searching...");
                        setTimeout(() => setClearAnnouncement(""), 1000);
                    }
                    searchQuerySignal.value = value;
                }}
                className="w-full rounded-lg border border-black/[0.08] bg-white/70 py-2.5 pl-9 pr-4 font-mono text-sm text-slate-800 outline-none transition-all duration-200 placeholder:text-slate-400 focus:border-signal-500/40 focus:bg-signal-500/5 dark:border-white/[0.08] dark:bg-void-800/55 dark:text-slate-200"
            />
            <div className="sr-only" aria-live="polite" aria-atomic="true">{clearAnnouncement}</div>
            {searchQuerySignal.value && (
                <button
                    aria-label="Clear search"
                    onClick={() => {
                        setClearAnnouncement("Search cleared");
                        setTimeout(() => setClearAnnouncement(""), 1000);
                        searchQuerySignal.value = "";
                    }}
                    className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center justify-center gap-1.5 rounded-md px-1.5 py-1 text-slate-400 transition-colors duration-150 hover:bg-black/[0.05] hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-1 dark:hover:bg-white/[0.05] dark:hover:text-slate-200 dark:focus-visible:ring-offset-void-900"
                >
                    <kbd className="hidden sm:inline-block text-[10px] font-mono border border-black/[0.1] dark:border-white/[0.1] rounded px-1 text-slate-400">Esc</kbd>
                    <X className="w-3.5 h-3.5" />
                </button>
            )}
        </div>
    );
};
