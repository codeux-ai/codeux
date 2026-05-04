import { FunctionComponent } from "preact";
import { useMemo } from "preact/hooks";
import { useComputed } from "@preact/signals";
import { MemoryCard } from "./MemoryCard.js";
import { searchQuerySignal, activeMemoryIdSignal } from "./memoryState.js";
import type { MemNode } from "../../lib/memory-graph.js";

export const MemoryList: FunctionComponent<{
    nodes: MemNode[];
    onSelectNode: (idx: number) => void;
}> = ({ nodes, onSelectNode }) => {




    const filteredNodes = useComputed(() => {
        const query = searchQuerySignal.value;
        if (!query.trim()) {
            return nodes.map((node, index) => ({ node, index })).filter(({ node }) => node.alive);
        }

        const lower = query.toLowerCase();
        return nodes
            .map((node, index) => ({ node, index }))
            .filter(({ node }) => node.alive && (node.content.toLowerCase().includes(lower) || node.category.toLowerCase().includes(lower)));
    });

    if (filteredNodes.value.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center p-8 text-center text-slate-400">
                <p className="text-sm font-medium">No memories found</p>
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-3 h-full overflow-y-auto dashboard-scrollbar p-2">
            {filteredNodes.value.map(({ node, index }) => (
                <MemoryCard
                    key={node.id}
                    id={node.id}
                    content={node.content}
                    category={node.category}
                    strength={node.strength}
                                        onClick={() => onSelectNode(index)}
                />
            ))}
        </div>
    );
};
