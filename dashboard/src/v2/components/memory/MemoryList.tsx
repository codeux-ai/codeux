import type { FunctionComponent } from "preact";
import type { MemNode } from "../../lib/memory-graph.js";
import { MemoryCard } from "./MemoryCard.js";
import type { Signal } from "@preact/signals";
import { useVirtualizer } from '@tanstack/react-virtual';
import { useRef } from 'preact/hooks';

interface MemoryListProps {
    nodes: MemNode[];
    searchQuery: Signal<string>;
    selectedMemoryId: Signal<string | null>;
}

export const MemoryList: FunctionComponent<MemoryListProps> = ({ nodes, searchQuery, selectedMemoryId }) => {
    const query = searchQuery.value.toLowerCase();

    // Filter nodes based on search query
    const filteredNodes = query
        ? nodes.filter(n =>
            n.content.toLowerCase().includes(query) ||
            n.category.toLowerCase().includes(query)
          )
        : nodes;

    const parentRef = useRef<HTMLDivElement>(null);

    const rowVirtualizer = useVirtualizer({
        count: filteredNodes.length,
        getScrollElement: () => parentRef.current,
        estimateSize: () => 120, // Estimated height of a memory card + gap
        overscan: 5,
    });

    if (filteredNodes.length === 0) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-slate-400">
                <p>No memories found matching your criteria.</p>
            </div>
        );
    }

    return (
        <div
            ref={parentRef}
            className="flex-1 overflow-y-auto w-full pr-2 h-full"
            style={{ maxHeight: "100%" }}
        >
            <div
                style={{
                    height: `${rowVirtualizer.getTotalSize()}px`,
                    width: '100%',
                    position: 'relative',
                }}
            >
                {rowVirtualizer.getVirtualItems().map((virtualItem) => {
                    const node = filteredNodes[virtualItem.index];
                    return (
                        <div
                            key={virtualItem.key}
                            style={{
                                position: 'absolute',
                                top: 0,
                                left: 0,
                                width: '100%',
                                height: `${virtualItem.size}px`,
                                transform: `translateY(${virtualItem.start}px)`,
                                paddingBottom: '16px' // Gap replacement
                            }}
                        >
                            <MemoryCard
                                node={node}
                                isSelected={selectedMemoryId.value === node.id}
                                onSelect={(id) => selectedMemoryId.value = id}
                            />
                        </div>
                    );
                })}
            </div>
        </div>
    );
};
