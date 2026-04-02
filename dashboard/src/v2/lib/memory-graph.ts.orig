import type { MemoryCategory, MemoryRecord, MemoryScope } from "../memory-types.js";
import type { EmbeddingMapResult } from "./memory-api.js";

export type MemCat = MemoryCategory;

export interface MemNode {
    id: string;
    content: string;
    category: MemCat;
    strength: number;
    scope: MemoryScope;
    x: number;
    y: number;
    targetX: number;
    targetY: number;
    radius: number;
    opacity: number;
    scale: number;
    glow: number;
    alive: boolean;
}

export interface Edge {
    a: number;
    b: number;
    similarity: number;
}

export interface CategoryCentroid {
    x: number;
    y: number;
    count: number;
    radius: number;
}

export interface GraphMetadata {
    nodes: MemNode[];
    edges: Edge[];
    catCentroids: Record<string, CategoryCentroid>;
}

export const CLUSTER: Record<string, [number, number]> = {
    architecture: [0,    -270],
    codebase:     [240,  -135],
    context:      [240,   135],
    preferences:  [0,     270],
    patterns:     [-240, -135],
    decision:     [-240,  135],
    error:        [170,   250],
    learning:     [-170,  -250],
};

function buildNodesFromRecords(records: MemoryRecord[], embeddingMap: EmbeddingMapResult | null): MemNode[] {
    const posMap = new Map<string, { x: number; y: number }>();
    if (embeddingMap?.hasEmbeddings) {
        for (const n of embeddingMap.nodes) posMap.set(n.id, { x: n.x, y: n.y });
    }

    const hasProjections = posMap.size > 0;

    // Precompute counts for fallback layout and spacing
    const categoryTotalCounts: Record<string, number> = {};
    for (const r of records) {
        const cat = r.category in CLUSTER ? r.category : "context";
        categoryTotalCounts[cat] = (categoryTotalCounts[cat] || 0) + 1;
    }

    const categoryCurrentIndices: Record<string, number> = {};

    return records.map(r => {
        let tx: number, ty: number;
        const projected = posMap.get(r.id);

        if (projected && hasProjections) {
            tx = projected.x;
            ty = projected.y;
        } else {
            const cat = r.category in CLUSTER ? r.category : "context";
            const ci = categoryCurrentIndices[cat] = (categoryCurrentIndices[cat] || 0);
            categoryCurrentIndices[cat]++;
            const [cx, cy] = CLUSTER[cat] || [0, 0];
            const catCount = categoryTotalCounts[cat];
            const angle = ci * (Math.PI * 2 / Math.max(3, catCount)) + Math.PI / 4;
            const dist = 45 + r.strength * 35;
            tx = cx + Math.cos(angle) * dist;
            ty = cy + Math.sin(angle) * dist;
        }

        return {
            id: r.id, content: r.content, category: r.category as MemCat,
            strength: r.strength, scope: r.scope,
            x: 0, y: 0, targetX: tx, targetY: ty,
            radius: 4 + r.strength * 7, opacity: 0, scale: 0,
            glow: r.strength * 0.4, alive: true,
        };
    });
}

function buildEdges(nodes: MemNode[], embeddingMap: EmbeddingMapResult | null): Edge[] {
    const edges: Edge[] = [];

    if (embeddingMap?.hasEmbeddings && embeddingMap.edges.length > 0) {
        const idxMap = new Map<string, number>();
        nodes.forEach((n, i) => idxMap.set(n.id, i));

        for (const e of embeddingMap.edges) {
            const ai = idxMap.get(e.source);
            const bi = idxMap.get(e.target);
            if (ai !== undefined && bi !== undefined) {
                edges.push({ a: ai, b: bi, similarity: e.similarity });
            }
        }
    } else {
        // Fallback edges for nodes in same category
        for (let i = 0; i < nodes.length; i++) {
            for (let j = i + 1; j < nodes.length; j++) {
                if (nodes[i].category === nodes[j].category) {
                    edges.push({ a: i, b: j, similarity: 0.5 });
                }
            }
        }
    }

    return edges;
}

export function prepareMemoryGraph(records: MemoryRecord[], embeddingMap: EmbeddingMapResult | null): GraphMetadata {
    const nodes = buildNodesFromRecords(records, embeddingMap);
    const edges = buildEdges(nodes, embeddingMap);

    const catCentroids: Record<string, CategoryCentroid> = {};

    for (const n of nodes) {
        if (!catCentroids[n.category]) {
            catCentroids[n.category] = { x: 0, y: 0, count: 0, radius: 0 };
        }
        const c = catCentroids[n.category];
        c.x += n.targetX;
        c.y += n.targetY;
        c.count++;
    }

    for (const cat of Object.keys(catCentroids)) {
        const c = catCentroids[cat];
        if (c.count > 0) {
            c.x /= c.count;
            c.y /= c.count;
        }
    }

    for (const n of nodes) {
        const c = catCentroids[n.category];
        if (!c) continue;
        const dist = Math.sqrt((n.targetX - c.x) ** 2 + (n.targetY - c.y) ** 2);
        if (dist > c.radius) {
            c.radius = dist;
        }
    }

    return { nodes, edges, catCentroids };
}
