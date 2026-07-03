import { FunctionComponent } from "preact";
import { useEffect, useState } from "preact/hooks";
import { Search, X } from "lucide-preact";
import { searchQuerySignal } from "./memoryState.js";

const SEARCH_DEBOUNCE_MS = 180;

export const MemorySearch: FunctionComponent = () => {
    const currentQuery = searchQuerySignal.value;
    const [inputValue, setInputValue] = useState(currentQuery);
    const [clearAnnouncement, setClearAnnouncement] = useState("");

    useEffect(() => {
        setInputValue(currentQuery);
    }, [currentQuery]);

    useEffect(() => {
        if (inputValue === searchQuerySignal.value) {
            return;
        }

        const timer = window.setTimeout(() => {
            searchQuerySignal.value = inputValue;
        }, SEARCH_DEBOUNCE_MS);

        return () => {
            window.clearTimeout(timer);
        };
    }, [inputValue]);

    return (
        <div className="relative group w-full min-w-0">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 transition-colors duration-200 group-focus-within:text-signal-500" aria-hidden="true" />
            <input
                aria-label="Search memories"
                aria-controls="memory-panel"
                aria-describedby="memory-search-hint"
                aria-keyshortcuts="Escape"
                type="text"
                placeholder="Search memories by name or category..."
                value={inputValue}
                onKeyDown={(e) => {
                    if (e.key === "Escape") {
                        if (inputValue || searchQuerySignal.value) {
                            setClearAnnouncement("Search cleared");
                            setTimeout(() => setClearAnnouncement(""), 1000);
                        }
                        setInputValue("");
                        searchQuerySignal.value = "";
                    }
                }}
                onInput={(e) => {
                    const value = (e.target as HTMLInputElement).value;
                    if (value) {
                        setClearAnnouncement("Searching...");
                        setTimeout(() => setClearAnnouncement(""), 1000);
                    }
                    setInputValue(value);
                }}
                className="w-full min-w-0 rounded-xl border border-black/[0.08] bg-black/[0.04] py-2.5 pl-9 pr-10 text-sm font-mono text-slate-800 outline-none transition-all duration-200 focus:border-signal-500/40 focus:bg-signal-500/5 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-200"
            />
            <p id="memory-search-hint" className="sr-only">
                Type to filter memories. Press Escape to clear the search.
            </p>
            <div className="sr-only" aria-live="polite" aria-atomic="true">{clearAnnouncement}</div>
            {inputValue && (
                <button
                    type="button"
                    aria-label="Clear search"
                    onClick={() => {
                        setClearAnnouncement("Search cleared");
                        setTimeout(() => setClearAnnouncement(""), 1000);
                        setInputValue("");
                        searchQuerySignal.value = "";
                    }}
                    className="absolute right-3 top-1/2 flex -translate-y-1/2 items-center justify-center gap-1.5 rounded-md px-1.5 py-1 text-slate-400 transition-colors duration-150 hover:bg-black/[0.05] hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-1 dark:hover:bg-white/[0.05] dark:hover:text-slate-200 dark:focus-visible:ring-offset-void-900"
                >
                    <kbd className="hidden sm:inline-block text-[10px] font-mono border border-black/[0.1] dark:border-white/[0.1] rounded px-1 text-slate-400">Esc</kbd>
                    <X className="w-3.5 h-3.5" />
                </button>
            )}
        </div>
    );
};
