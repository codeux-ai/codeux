import { FunctionComponent } from "preact";
import { useEffect, useState } from "preact/hooks";
import { Search, X } from "lucide-preact";
import { useInteractionTokens } from "../../lib/motion/tokens.js";
import { searchQuerySignal } from "./memoryState.js";
import { useMemoryI18n } from "../../i18n/messages/memory.js";

const SEARCH_DEBOUNCE_MS = 180;

export const MemorySearch: FunctionComponent<{ entityLabel?: "memory" | "skill" }> = ({ entityLabel = "memory" }) => {
    const committedQuery = searchQuerySignal.value;
    const [inputValue, setInputValue] = useState(committedQuery);
    const [announcement, setAnnouncement] = useState("");
    const interactionTokens = useInteractionTokens();
    const { t } = useMemoryI18n();
    const searchPending = inputValue !== committedQuery;
    const asyncFeedbackStyle = {
        transitionDuration: interactionTokens.asyncFeedback.duration,
        transitionTimingFunction: interactionTokens.asyncFeedback.ease,
    };

    useEffect(() => {
        setInputValue(committedQuery);
    }, [committedQuery]);

    useEffect(() => {
        if (inputValue === committedQuery) {
            return;
        }

        const trimmedInput = inputValue.trim();
        const timeoutId = window.setTimeout(() => {
            searchQuerySignal.value = inputValue;
            setAnnouncement(trimmedInput ? t("searchApplied", { query: trimmedInput }) : t("searchCleared"));
        }, SEARCH_DEBOUNCE_MS);

        return () => {
            window.clearTimeout(timeoutId);
        };
    }, [committedQuery, inputValue, t]);

    const clearSearch = () => {
        if (inputValue || searchQuerySignal.value) {
            setAnnouncement(t("searchCleared"));
        }
        setInputValue("");
        searchQuerySignal.value = "";
    };

    return (
        <div className="relative group w-full min-w-0">
            <label htmlFor="memory-search" className="sr-only">{t(entityLabel === "skill" ? "searchSkills" : "searchMemories")}</label>
            <div className="relative">
                <Search
                    className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 transition-colors motion-reduce:duration-0 group-focus-within:text-signal-500"
                    style={{ transitionDuration: interactionTokens.controlFeedback.duration, transitionTimingFunction: interactionTokens.controlFeedback.ease }}
                    aria-hidden="true"
                />
                <input
                    id="memory-search"
                    aria-controls="memory-panel"
                    aria-describedby="memory-search-hint memory-search-status"
                    aria-keyshortcuts="Escape"
                    aria-busy={searchPending}
                    type="text"
                    placeholder={t(entityLabel === "skill" ? "searchPlaceholderSkills" : "searchPlaceholderMemories")}
                    value={inputValue}
                    onKeyDown={(e) => {
                        if (e.key === "Escape") {
                            clearSearch();
                        }
                    }}
                    onInput={(e) => {
                        setInputValue((e.target as HTMLInputElement).value);
                    }}
                    className="w-full min-w-0 rounded-xl border border-black/[0.08] bg-black/[0.04] py-2.5 pl-9 pr-10 text-sm font-mono text-slate-800 outline-none transition-[background-color,border-color,box-shadow,color] motion-reduce:duration-0 focus:border-signal-500/40 focus:bg-signal-500/5 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-200"
                    style={{ transitionDuration: interactionTokens.controlFeedback.duration, transitionTimingFunction: interactionTokens.controlFeedback.ease }}
                />
                {inputValue && (
                    <button
                        type="button"
                        aria-label={t("clearSearch")}
                        onClick={clearSearch}
                        className="absolute right-3 top-1/2 flex min-h-8 min-w-8 -translate-y-1/2 items-center justify-center gap-1.5 rounded-md px-1.5 py-1 text-slate-400 transition-[background-color,color,box-shadow] motion-reduce:duration-0 hover:bg-black/[0.05] hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-1 dark:hover:bg-white/[0.05] dark:hover:text-slate-200 dark:focus-visible:ring-offset-void-900"
                        style={{ transitionDuration: interactionTokens.controlFeedback.duration, transitionTimingFunction: interactionTokens.controlFeedback.ease }}
                    >
                        <kbd className="hidden sm:inline-block text-[10px] font-mono border border-black/[0.1] dark:border-white/[0.1] rounded px-1 text-slate-400">Esc</kbd>
                        <X className="w-3.5 h-3.5" />
                    </button>
                )}
            </div>
            <p id="memory-search-hint" className="sr-only">
                {t(entityLabel === "skill" ? "searchHintSkills" : "searchHintMemories")}
            </p>
            <div id="memory-search-status" className="mt-1 min-h-4 text-[11px] font-medium text-slate-500 transition-colors dark:text-slate-400" style={asyncFeedbackStyle}>
                {searchPending
                    ? t("searchTyping")
                    : committedQuery.trim()
                        ? t("searchActive", { query: committedQuery.trim() })
                        : t("searchClear")}
            </div>
            <div className="sr-only" aria-live="polite" aria-atomic="true">
                {announcement}
            </div>
            {searchPending && (
                <div className="absolute right-10 top-1/2 hidden -translate-y-1/2 rounded-md border border-signal-500/20 bg-signal-500/[0.08] px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-signal-600 transition-[background-color,border-color,color] dark:text-signal-400 sm:block" style={asyncFeedbackStyle}>
                    {t("pending")}
                </div>
            )}
        </div>
    );
};
