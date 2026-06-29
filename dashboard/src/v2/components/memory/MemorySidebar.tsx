import { h } from "preact";
import { useEffect } from "preact/hooks";
import { ChevronLeft, ChevronRight } from "lucide-preact";
import { memorySidebarExpandedSignal, searchQuerySignal } from "./memoryState.js";
import { MemorySearch } from "./MemorySearch.js";
import { MemoryList } from "./MemoryList.js";
import type { MemNode } from "../../lib/memory-graph.js";

interface MemorySidebarProps {
  nodes: MemNode[];
  onSelectNode: (idx: number) => void;
}

const MemorySidebar = ({ nodes, onSelectNode }: MemorySidebarProps) => {
  const isExpanded = memorySidebarExpandedSignal.value;

  useEffect(() => {
    if (!isExpanded) {
      searchQuerySignal.value = "";
    }
  }, [isExpanded]);

  const toggleSidebar = () => {
    memorySidebarExpandedSignal.value = !memorySidebarExpandedSignal.value;
  };

  return (
    <div
      className={`relative w-full lg:h-full bg-void-900 lg:border-l lg:border-t-0 border-t border-void-700 transition-all duration-300 ease-in-out flex flex-col ${
        isExpanded ? "h-[50vh] lg:w-80" : "h-0 lg:w-0"
      }`}
    >
      <style>
        {`
          @keyframes pulse-arrow {
            0%, 100% { transform: scale(0.85); opacity: 0.7; }
            50% { transform: scale(1.15); opacity: 1; }
          }
          .animate-pulse-arrow {
            animation: pulse-arrow 2s ease-in-out infinite;
          }
        `}
      </style>

      {/* Toggle Button */}
      <button
        onClick={toggleSidebar}
        className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 lg:left-0 lg:top-1/2 lg:-translate-y-1/2 lg:-translate-x-1/2 z-10 flex h-5 w-10 lg:h-10 lg:w-5 items-center justify-center bg-void-800 border border-void-700 rounded-full text-void-300 hover:text-signal-500 hover:border-signal-500 transition-colors shadow-md focus:outline-none focus:ring-2 focus:ring-signal-500"
        aria-label={isExpanded ? "Collapse sidebar" : "Expand sidebar"}
        aria-expanded={isExpanded}
      >
        <span className="animate-pulse-arrow flex items-center justify-center rotate-90 lg:rotate-0">
          {isExpanded ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
        </span>
      </button>

      {/* Content Area */}
      <div
        className={`w-full lg:w-80 flex-1 flex flex-col transition-opacity duration-300 ${
          isExpanded ? "opacity-100" : "opacity-0 pointer-events-none overflow-hidden"
        }`}
      >
        <div className="flex flex-col h-full">
          <div className="shrink-0 p-3 border-b border-void-700">
            <MemorySearch />
          </div>
          <div className="flex-1 overflow-y-auto min-h-0">
            <MemoryList nodes={nodes} onSelectNode={onSelectNode} />
          </div>
        </div>
      </div>
    </div>
  );
};

export default MemorySidebar;
