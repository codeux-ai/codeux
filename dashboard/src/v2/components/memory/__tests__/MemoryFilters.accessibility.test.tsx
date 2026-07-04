/** @vitest-environment jsdom */
import { h } from "preact";
import { render, fireEvent } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { expect, test, describe, afterEach } from "vitest";
import { MemoryFilters } from "../MemoryFilters.js";
import { activeTierSignal, selectedAgentPresetIdSignal, selectedSprintIdSignal } from "../memoryState.js";

expect.extend(matchers);

describe("MemoryFilters Accessibility", () => {
    afterEach(() => {
        document.body.innerHTML = "";
        activeTierSignal.value = "short_term";
        selectedSprintIdSignal.value = undefined;
        selectedAgentPresetIdSignal.value = undefined;
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

        expect(getByRole("combobox", { name: "Filter memory by Sprint" })).toBeInTheDocument();
        expect(getByRole("combobox", { name: "Filter memory by Agent Preset" })).toBeInTheDocument();
    });

    test("select changes expose selected sprint and agent feedback", async () => {
        activeTierSignal.value = "short_term";
        const { getByRole, getByText } = render(
            <MemoryFilters
                stats={{ sprint: 5, agent: 2, project: 10, activeModel: "test", staleEmbeddings: 0 }}
                sprints={[
                    { id: "1", number: 1, goal: "first", name: "", repoPath: "" } as any,
                    { id: "2", number: 2, goal: "second", name: "", repoPath: "" } as any
                ]}
                agentPresets={[
                    { id: "agent1", name: "Agent 1", description: "", modelName: "" } as any,
                    { id: "agent2", name: "Agent 2", description: "", modelName: "" } as any
                ]}
                showModels={false}
                setShowModels={() => {}}
                setShowAddModal={() => {}}
                lobotomize={false}
                handleLobotomizeToggle={() => {}}
            />
        );

        await fireEvent.change(getByRole("combobox", { name: "Filter memory by Sprint" }), { target: { value: "2" } });
        expect(selectedSprintIdSignal.value).toBe("2");
        expect(getByText("Sprint filter set to Sprint 2.")).toBeInTheDocument();

        await fireEvent.change(getByRole("combobox", { name: "Filter memory by Agent Preset" }), { target: { value: "agent2" } });
        expect(selectedAgentPresetIdSignal.value).toBe("agent2");
        expect(getByText("Agent filter set to Agent 2.")).toBeInTheDocument();
    });

    test("tab keyboard navigation works", async () => {
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

        const shortTermTab = getByRole("tab", { name: /Short Term/ });
        const longTermTab = getByRole("tab", { name: /Long Term/ });

        shortTermTab.focus();
        await fireEvent.keyDown(shortTermTab, { key: "ArrowRight", code: "ArrowRight" });
        expect(activeTierSignal.value).toBe("long_term");
        expect(document.activeElement).toBe(longTermTab);

        await fireEvent.keyDown(longTermTab, { key: "ArrowLeft", code: "ArrowLeft" });
        expect(activeTierSignal.value).toBe("short_term");
        expect(document.activeElement).toBe(shortTermTab);

        await fireEvent.keyDown(shortTermTab, { key: "End", code: "End" });
        expect(activeTierSignal.value).toBe("long_term");
        expect(document.activeElement).toBe(longTermTab);

        await fireEvent.keyDown(longTermTab, { key: "Home", code: "Home" });
        expect(activeTierSignal.value).toBe("short_term");
        expect(document.activeElement).toBe(shortTermTab);
    });

    test("model catalog button communicates pressed visibility state", () => {
        const { getByRole, getByText } = render(
            <MemoryFilters
                stats={{ sprint: 5, agent: 2, project: 10, activeModel: "test", staleEmbeddings: 0 }}
                sprints={[]}
                agentPresets={[]}
                showModels={true}
                setShowModels={() => {}}
                setShowAddModal={() => {}}
                lobotomize={false}
                handleLobotomizeToggle={() => {}}
            />
        );

        const toggleBtn = getByRole("button", { name: "Hide embedding model catalog" });
        expect(toggleBtn).toHaveAttribute("aria-pressed", "true");
        expect(getByText("Shown")).toBeInTheDocument();
    });

    test("Danger mode toggle uses aria-pressed and persistent state copy", async () => {
        const { getByRole } = render(
            <MemoryFilters
                stats={{ sprint: 5, agent: 2, project: 10, activeModel: "test", staleEmbeddings: 0 }}
                sprints={[]}
                agentPresets={[]}
                showModels={false}
                setShowModels={() => {}}
                setShowAddModal={() => {}}
                lobotomize={true}
                handleLobotomizeToggle={() => {}}
            />
        );

        const toggleBtn = getByRole("button", { name: "Disable danger delete mode" });
        expect(toggleBtn).toHaveAttribute("aria-pressed", "true");
        expect(toggleBtn).toHaveTextContent("Danger Delete Armed");
        expect(toggleBtn).toHaveAccessibleDescription("Danger delete mode is armed. Single-memory deletes skip confirmation until turned off.");
    });

    test("critical controls expose accessible names", () => {
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

        expect(getByRole("button", { name: "Add Memory" })).toBeInTheDocument();
        expect(getByRole("button", { name: "Show embedding model catalog" })).toBeInTheDocument();
        expect(getByRole("button", { name: "Enable danger delete mode" })).toBeInTheDocument();
    });
});
