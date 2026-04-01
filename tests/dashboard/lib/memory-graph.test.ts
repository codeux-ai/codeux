import { describe, it, expect } from "vitest";
import { prepareMemoryGraph, CLUSTER } from "../../../dashboard/src/v2/lib/memory-graph.js";
import type { MemoryRecord } from "../../../dashboard/src/v2/memory-types.js";
import type { EmbeddingMapResult } from "../../../dashboard/src/v2/lib/memory-api.js";

function createMockMemory(id: string, category: string, strength: number = 0.5): MemoryRecord {
    return {
        id,
        projectId: "proj-1",
        scope: "project",
        sprintId: null,
        agentPresetId: null,
        content: `Test content ${id}`,
        category: category as any,
        strength,
        source: { type: "manual" },
        embeddingModel: null,
        embeddingDimension: null,
        embeddingBlob: null,
        promotedFromId: null,
        promotionReason: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };
}

describe("prepareMemoryGraph", () => {
    it("should layout nodes using fallback positions when embeddings are absent", () => {
        const records = [
            createMockMemory("1", "architecture"),
            createMockMemory("2", "architecture"),
            createMockMemory("3", "context"),
        ];

        const result = prepareMemoryGraph(records, null);

        expect(result.nodes).toHaveLength(3);

        // All start at 0, 0
        expect(result.nodes[0].x).toBe(0);
        expect(result.nodes[0].y).toBe(0);

        // Architecture cluster center
        const [archX, archY] = CLUSTER["architecture"];
        const node1 = result.nodes[0];
        const node2 = result.nodes[1];

        // Ensure targetX and targetY are calculated around the centroid
        expect(node1.targetX).not.toBe(archX); // It should be offset by angle and distance
        expect(node1.targetY).not.toBe(archY);

        // Different index, should have different position
        expect(node1.targetX).not.toBe(node2.targetX);
        expect(node1.targetY).not.toBe(node2.targetY);
    });

    it("should generate category edges when embeddings are absent", () => {
        const records = [
            createMockMemory("1", "architecture"),
            createMockMemory("2", "architecture"),
            createMockMemory("3", "context"),
            createMockMemory("4", "context"),
            createMockMemory("5", "architecture"),
        ];

        const result = prepareMemoryGraph(records, null);

        // Nodes:
        // 0: arch, 1: arch, 2: ctx, 3: ctx, 4: arch
        // Edges should connect (0,1), (0,4), (1,4), (2,3) -> total 4 edges
        expect(result.edges).toHaveLength(4);

        // Verify edge connections
        const hasEdge = (a: number, b: number) => result.edges.some(e => (e.a === a && e.b === b) || (e.a === b && e.b === a));
        expect(hasEdge(0, 1)).toBe(true);
        expect(hasEdge(0, 4)).toBe(true);
        expect(hasEdge(1, 4)).toBe(true);
        expect(hasEdge(2, 3)).toBe(true);
        expect(hasEdge(0, 2)).toBe(false); // different categories
    });

    it("should use provided embedding projections and edges", () => {
        const records = [
            createMockMemory("1", "architecture"),
            createMockMemory("2", "context"),
        ];

        const embeddingMap: EmbeddingMapResult = {
            hasEmbeddings: true,
            nodes: [
                { id: "1", x: 100, y: 200 },
                { id: "2", x: -50, y: -100 },
            ],
            edges: [
                { source: "1", target: "2", similarity: 0.85 },
            ],
        };

        const result = prepareMemoryGraph(records, embeddingMap);

        expect(result.nodes).toHaveLength(2);

        // Ensure projected coordinates were mapped
        const node1 = result.nodes.find(n => n.id === "1");
        expect(node1?.targetX).toBe(100);
        expect(node1?.targetY).toBe(200);

        const node2 = result.nodes.find(n => n.id === "2");
        expect(node2?.targetX).toBe(-50);
        expect(node2?.targetY).toBe(-100);

        // Verify exact edges from map were preserved
        expect(result.edges).toHaveLength(1);
        expect(result.edges[0].similarity).toBe(0.85);

        // Map uses node index, so source "1" is index 0, target "2" is index 1
        expect(result.edges[0].a).toBe(0);
        expect(result.edges[0].b).toBe(1);
    });

    it("should compute stable category centroids and radii", () => {
        const records = [
            createMockMemory("1", "architecture"),
            createMockMemory("2", "architecture"),
        ];

        // Mock explicit projections to make centroid math predictable
        const embeddingMap: EmbeddingMapResult = {
            hasEmbeddings: true,
            nodes: [
                { id: "1", x: 10, y: 20 },
                { id: "2", x: 30, y: 40 },
            ],
            edges: [],
        };

        const result = prepareMemoryGraph(records, embeddingMap);

        const archCentroid = result.catCentroids["architecture"];
        expect(archCentroid).toBeDefined();

        // Count should be 2
        expect(archCentroid.count).toBe(2);

        // Center between (10, 20) and (30, 40) is (20, 30)
        expect(archCentroid.x).toBe(20);
        expect(archCentroid.y).toBe(30);

        // Max radius: Distance from (20,30) to (10,20) is sqrt(10^2 + 10^2) = sqrt(200) ≈ 14.14
        expect(archCentroid.radius).toBeCloseTo(Math.sqrt(200));
    });

    it("should handle empty records safely", () => {
        const result = prepareMemoryGraph([], null);
        expect(result.nodes).toEqual([]);
        expect(result.edges).toEqual([]);
        expect(result.catCentroids).toEqual({});
    });
});
