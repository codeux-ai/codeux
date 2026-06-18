/** @vitest-environment jsdom */
import { h } from "preact";
import { render } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { expect, test, describe, afterEach } from "vitest";
import { MemoryFilters } from "../MemoryFilters.js";
import { activeTierSignal } from "../memoryState.js";

expect.extend(matchers);

describe("MemoryFilters Accessibility", () => {
    afterEach(() => {
        document.body.innerHTML = "";
    });

    test("tabs have role tab and correct aria-selected", () => {
        activeTierSignal.value = "short_term";
        const { getByRole } = render(
            <MemoryFilters
                stats={{ sprint: 5, agent: 2, project: 10, activeModel: "test", staleEmbeddings: 0 }}
                sprints={[]}
                agentPresets={[]}
                showModels={false}
                setShowModels={() => {}}
                setShowAddModal={() => {}}
                lobotomize={false}
                handleLobotomizeToggle={() => {}}
            />
        );

        const tablist = getByRole("tablist");
        expect(tablist).toBeInTheDocument();

        const shortTermTab = getByRole("tab", { name: /Short Term/ });
        const longTermTab = getByRole("tab", { name: /Long Term/ });

        expect(shortTermTab).toHaveAttribute("aria-selected", "true");
        expect(longTermTab).toHaveAttribute("aria-selected", "false");
    });

    test("selects have proper aria labels", () => {
        activeTierSignal.value = "short_term";
        const { getByRole } = render(
            <MemoryFilters
                stats={{ sprint: 5, agent: 2, project: 10, activeModel: "test", staleEmbeddings: 0 }}
                sprints={[{ id: "1", number: 1, goal: "test", name: "", repoPath: "" } as any]}
                agentPresets={[{ id: "agent1", name: "Agent 1", description: "", modelName: "" } as any]}
                showModels={false}
                setShowModels={() => {}}
                setShowAddModal={() => {}}
                lobotomize={false}
                handleLobotomizeToggle={() => {}}
            />
        );

        expect(getByRole("combobox", { name: "Select sprint" })).toBeInTheDocument();
        expect(getByRole("combobox", { name: "Select agent preset" })).toBeInTheDocument();
    });
});
