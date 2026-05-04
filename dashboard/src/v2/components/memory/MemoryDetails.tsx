import type { FunctionComponent } from "preact";
import type { MemNode } from "../../lib/memory-graph.js";
import { Inspector } from "./Inspector.js";
import type { Signal } from "@preact/signals";

interface MemoryDetailsProps {
    nodes: MemNode[];
    selectedMemoryId: Signal<string | null>;
    onDelete: (id: string) => Promise<void>;
}

export const MemoryDetails: FunctionComponent<MemoryDetailsProps> = ({
    nodes,
    selectedMemoryId,
    onDelete
}) => {
    const selectedNode = selectedMemoryId.value ? nodes.find(n => n.id === selectedMemoryId.value) || null : null;

    if (!selectedNode) {
        return (
            <div className="flex-1 flex items-center justify-center bg-white/50 dark:bg-void-800/40 rounded-2xl border border-slate-200 dark:border-void-700 p-8 h-full">
                <p className="text-slate-400 text-sm">Select a memory from the list to view details.</p>
            </div>
        );
    }

    // Wrap Inspector to adapt to layout needs
    return (
        <div className="flex-1 bg-white dark:bg-void-800 rounded-2xl border border-slate-200 dark:border-void-700 overflow-hidden relative h-full">
             <Inspector
                node={selectedNode}
                allNodes={nodes}
                edges={[]}
                lobotomize={false}
                onClose={() => selectedMemoryId.value = null}
                onDelete={onDelete}
            />
        </div>
    );
};
