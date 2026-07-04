import { h } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { ChevronDown, ChevronRight } from "lucide-preact";
import { clearSelectedMemoryIds, memorySidebarExpandedSignal, searchQuerySignal } from "./memoryState.js";
import { MemoryList } from "./MemoryList.js";
import { MemorySearch } from "./MemorySearch.js";
import type { MemNode } from "../../lib/memory-graph.js";

interface MemorySidebarProps {
  nodes: MemNode[];
  onSelectNode: (idx: number) => void;
  refreshing?: boolean;
  loadError?: string | null;
  onRetry?: () => void;
  onAddMemory?: () => void;
}

const MemorySidebar = ({ nodes, onSelectNode, refreshing = false, loadError = null, onRetry, onAddMemory }: MemorySidebarProps) => {
  const isExpanded = memorySidebarExpandedSignal.value;
  const previousExpanded = useRef(isExpanded);

  useEffect(() => {
    if (previousExpanded.current && !isExpanded) {
      searchQuerySignal.value = "";
      clearSelectedMemoryIds();
    }
    previousExpanded.current = isExpanded;
  }, [isExpanded]);

  const toggleSidebar = () => {
    memorySidebarExpandedSignal.value = !memorySidebarExpandedSignal.value;
  };

  const openLabel = "Open memory sidebar";
  const closeLabel = "Close memory sidebar";

    return (
        <div
            className={`group relative flex shrink-0 flex-col overflow-hidden bg-void-900 border-void-700 transition-[width,height,background-color,border-color,box-shadow] duration-300 ease-out motion-reduce:transition-none ${
                isExpanded
                    ? "h-[min(44dvh,34rem)] w-full border-t lg:h-full lg:w-[20rem] lg:border-l lg:border-t-0"
                    : "h-14 w-full border-t lg:h-full lg:w-14 lg:border-l lg:border-t-0"
            }`}
        >
            <div className={`flex h-14 min-w-0 items-center border-b border-void-700 px-3 ${isExpanded ? "justify-between" : "justify-center"}`}>
                {isExpanded && (
                    <div className="min-w-0 flex-1">
                        <p className="truncate font-mono text-[10px] font-bold uppercase tracking-[0.24em] text-slate-400">
                            Memory
                        </p>
                        <p className="truncate text-[11px] text-slate-500">
                            Browse project memory
                        </p>
                    </div>
                )}
                <button
                    onClick={toggleSidebar}
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-void-700 bg-void-800 text-void-200 shadow-md transition-colors duration-200 hover:border-signal-500 hover:text-signal-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-2 focus-visible:ring-offset-void-900 motion-reduce:transition-none"
                    aria-label={isExpanded ? closeLabel : openLabel}
                    aria-expanded={isExpanded}
                    aria-controls="memory-sidebar-content"
                    title={isExpanded ? closeLabel : openLabel}
                >
                    <span
                        data-sidebar-toggle-icon
                        className={`flex items-center justify-center transition-transform duration-300 ease-out motion-reduce:transition-none motion-reduce:transform-none ${
                            isExpanded ? "rotate-0" : "rotate-180"
                        }`}
                    >
                        <ChevronDown className="h-4 w-4 lg:hidden" aria-hidden="true" />
                        <ChevronRight className="hidden h-4 w-4 lg:block" aria-hidden="true" />
                        <span className="sr-only">
                            {isExpanded ? "Collapse sidebar" : "Expand sidebar"}
                        </span>
                    </span>
                    <span className="sr-only">
                        {isExpanded ? closeLabel : openLabel}
                    </span>
                </button>
            </div>

            <div
                id="memory-sidebar-content"
                aria-hidden={!isExpanded}
                className={`min-h-0 min-w-0 flex-1 flex-col overflow-hidden transition-[opacity,transform] duration-300 ease-out motion-reduce:transition-none ${
                    isExpanded
                        ? "flex opacity-100 translate-y-0 lg:translate-y-0"
                        : "pointer-events-none flex opacity-0 translate-y-1 lg:translate-y-0"
                }`}
            >
                <div className="flex h-full min-h-0 min-w-0 flex-col">
                    <div className="shrink-0 border-b border-void-700 p-3">
                        <MemorySearch />
                    </div>
                    <MemoryList
                        nodes={nodes}
                        onSelectNode={onSelectNode}
                        refreshing={refreshing}
                        loadError={loadError}
                        onRetry={onRetry}
                        onAddMemory={onAddMemory}
                    />
                </div>
            </div>
        </div>
    );
};

export default MemorySidebar;
