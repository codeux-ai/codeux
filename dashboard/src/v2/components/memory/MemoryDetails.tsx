import { FunctionComponent } from "preact";
import { Inspector } from "./Inspector.js";
import { activeMemoryIdSignal } from "./memoryState.js";
import type { MemNode, Edge } from "../../lib/memory-graph.js";

export const MemoryDetails: FunctionComponent<{
    allNodes: MemNode[];
    edges: Edge[];
    lobotomize: boolean;
    onClose: () => void;
    onDelete: (id: string) => void;
}> = ({ allNodes, edges, lobotomize, onClose, onDelete }) => {

    // Subscribe directly to signal for the selected node
    const selectedId = activeMemoryIdSignal.value;
    const selectedNode = selectedId ? allNodes.find(n => n.id === selectedId) || null : null;
    const missingSelectedMemoryId = selectedId && !selectedNode ? selectedId : null;

    return (
        <Inspector
            node={selectedNode}
            missingSelectedMemoryId={missingSelectedMemoryId}
            allNodes={allNodes}
            edges={edges}
            lobotomize={lobotomize}
            onClose={onClose}
            onDelete={onDelete}
        />
    );
};
