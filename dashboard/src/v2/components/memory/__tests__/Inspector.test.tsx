/** @vitest-environment jsdom */
import { h } from "preact";
import { render } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { afterEach, describe, expect, test, vi } from "vitest";
import { Inspector } from "../Inspector.js";
import type { Edge, MemNode } from "../../../lib/memory-graph.js";

expect.extend(matchers);

vi.mock("../../../hooks/use-reduced-motion.js", () => ({
    useReducedMotion: () => false
}));

const buildNode = (overrides: Partial<MemNode> = {}): MemNode => ({
    id: "memory-1",
    content: "Alpha project memory",
    category: "architecture",
    strength: 0.9,
    scope: "project",
    x: 0,
    y: 0,
    targetX: 0,
    targetY: 0,
    radius: 10,
    opacity: 1,
    scale: 1,
    glow: 0,
    alive: true,
    ...overrides
});

const edges: Edge[] = [
    { a: 0, b: 1, similarity: 0.82 } as Edge
];

describe("Inspector", () => {
    afterEach(() => {
        document.body.innerHTML = "";
    });

    test("exposes a labeled close button and readable connected memories", () => {
        const { getByRole, getByText } = render(
            <Inspector
                node={buildNode()}
                allNodes={[
                    buildNode(),
                    buildNode({ id: "memory-2", content: "Beta related memory", category: "codebase" }),
                ]}
                edges={edges}
                lobotomize={false}
                onClose={vi.fn()}
                onDelete={vi.fn()}
            />
        );

        expect(getByRole("region", { name: "Selected memory details" })).toBeInTheDocument();
        expect(getByText("Selected memory open in inspector")).toBeInTheDocument();
        expect(getByRole("button", { name: "Close memory inspector" })).toBeInTheDocument();
        expect(getByText("Beta related memory")).toBeInTheDocument();
        expect(getByText("Codebase")).toBeInTheDocument();
        expect(getByText("82%")).toBeInTheDocument();
    });

    test("danger delete mode explains immediate inspector deletion", () => {
        const { getByRole, getByText } = render(
            <Inspector
                node={buildNode()}
                allNodes={[buildNode()]}
                edges={[]}
                lobotomize={true}
                onClose={vi.fn()}
                onDelete={vi.fn()}
            />
        );

        expect(getByText("Danger delete is armed. Deleting this memory happens immediately without another confirmation.")).toBeInTheDocument();
        expect(getByRole("button", { name: "Delete Immediately" })).toHaveAccessibleDescription("Danger delete is armed. This action deletes immediately without confirmation.");
    });
});
