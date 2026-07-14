/** @vitest-environment jsdom */
import { h } from "preact";
import { cleanup, fireEvent, within } from "@testing-library/preact";
import { renderWithDashboardI18n as render } from "../../../../../../tests/dashboard/helpers/dashboard-i18n-test-utils.js";
import * as matchers from "@testing-library/jest-dom/matchers";
import { expect, test, describe, afterEach, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { MemoryFilters } from "../MemoryFilters.js";
import { activeTierSignal, selectedAgentPresetIdSignal, selectedSprintIdSignal } from "../memoryState.js";

expect.extend(matchers);

describe("MemoryFilters Accessibility", () => {
    afterEach(() => {
        cleanup();
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
        expect(within(shortTermTab).getByText("7 memories")).toBeInTheDocument();
        expect(within(longTermTab).getByText("10 memories")).toBeInTheDocument();
        expect(getByRole("group", { name: "Memory scope filters" })).toBeInTheDocument();
        expect(getByRole("group", { name: "Memory actions" })).toBeInTheDocument();
    });

    test("selects have proper aria labels", () => {
        activeTierSignal.value = "short_term";
        const { getByRole } = render(
            <MemoryFilters
                stats={{ sprint: 5, agent: 2, project: 10, activeModel: "test", staleEmbeddings: 0 }}
                sprints={[{ id: "1", number: 1, goal: "test", name: "", repoPath: "" } as any]}
                agentPresets={[{ id: "agent1", name: "Agent 1", description: "", modelName: "" } as any]}
                setShowAddModal={() => {}}
                lobotomize={false}
                handleLobotomizeToggle={() => {}}
            />
        );

        expect(getByRole("combobox", { name: "Filter memory by Sprint" })).toBeInTheDocument();
        expect(getByRole("combobox", { name: "Filter memory by Agent Preset" })).toBeInTheDocument();
    });

    test("select changes expose selected sprint and agent feedback", async () => {
        const user = userEvent.setup();
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
                setShowAddModal={() => {}}
                lobotomize={false}
                handleLobotomizeToggle={() => {}}
            />
        );

        await user.selectOptions(getByRole("combobox", { name: "Filter memory by Sprint" }), "2");
        expect(selectedSprintIdSignal.value).toBe("2");
        expect(getByText("Sprint filter set to Sprint 2.")).toBeInTheDocument();

        await user.selectOptions(getByRole("combobox", { name: "Filter memory by Agent Preset" }), "agent2");
        expect(selectedAgentPresetIdSignal.value).toBe("agent2");
        expect(getByText("Agent filter set to Agent 2.")).toBeInTheDocument();
        expect(getByText("Short Term: showing 7 memories of 17 memories · Sprint 2 · Agent 2")).toBeInTheDocument();
    });

    test("tab keyboard navigation works", async () => {
        activeTierSignal.value = "short_term";
        const { getByRole } = render(
            <MemoryFilters
                stats={{ sprint: 5, agent: 2, project: 10, activeModel: "test", staleEmbeddings: 0 }}
                sprints={[]}
                agentPresets={[]}
                setShowAddModal={() => {}}
                lobotomize={false}
                handleLobotomizeToggle={() => {}}
            />
        );

        const shortTermTab = getByRole("tab", { name: /Short Term/ });
        const longTermTab = getByRole("tab", { name: /Long Term/ });
        const skillsTab = getByRole("tab", { name: /Skills/ });

        shortTermTab.focus();
        await fireEvent.keyDown(shortTermTab, { key: "ArrowRight", code: "ArrowRight" });
        expect(activeTierSignal.value).toBe("long_term");
        expect(document.activeElement).toBe(longTermTab);

        await fireEvent.keyDown(longTermTab, { key: "ArrowLeft", code: "ArrowLeft" });
        expect(activeTierSignal.value).toBe("short_term");
        expect(document.activeElement).toBe(shortTermTab);

        await fireEvent.keyDown(shortTermTab, { key: "End", code: "End" });
        expect(activeTierSignal.value).toBe("skills");
        expect(document.activeElement).toBe(skillsTab);

        await fireEvent.keyDown(skillsTab, { key: "Home", code: "Home" });
        expect(activeTierSignal.value).toBe("short_term");
        expect(document.activeElement).toBe(shortTermTab);
    });

    test("Danger mode toggle uses aria-pressed and persistent state copy", async () => {
        const { getByRole } = render(
            <MemoryFilters
                stats={{ sprint: 5, agent: 2, project: 10, activeModel: "test", staleEmbeddings: 0 }}
                sprints={[]}
                agentPresets={[]}
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
                setShowAddModal={() => {}}
                lobotomize={false}
                handleLobotomizeToggle={() => {}}
            />
        );

        expect(getByRole("button", { name: "Add Memory" })).toBeInTheDocument();
        expect(getByRole("button", { name: "Enable danger delete mode" })).toBeInTheDocument();
    });

    test("unavailable filter controls are omitted with visible reasons and counts", () => {
        activeTierSignal.value = "short_term";
        const { getByText, queryByRole } = render(
            <MemoryFilters
                stats={{ sprint: 0, agent: 0, project: 3, activeModel: null, staleEmbeddings: 0 }}
                sprints={[]}
                agentPresets={[]}
                setShowAddModal={() => {}}
                lobotomize={false}
                handleLobotomizeToggle={() => {}}
            />
        );

        expect(getByText("Short Term: showing 0 memories of 3 memories · No short-term memories · All Agents")).toBeInTheDocument();
        expect(queryByRole("combobox", { name: "Filter memory by Sprint" })).toBeNull();
        expect(queryByRole("combobox", { name: "Filter memory by Agent Preset" })).toBeNull();
        expect(getByText("No short-term memory filters are available for this tier.")).toBeInTheDocument();
    });

    test("danger toggle announces changed pressed state", async () => {
        const handleDanger = vi.fn();
        const { getByRole, getByText } = render(
            <MemoryFilters
                stats={{ sprint: 1, agent: 0, project: 0, activeModel: null, staleEmbeddings: 0 }}
                sprints={[]}
                agentPresets={[]}
                setShowAddModal={() => {}}
                lobotomize={false}
                handleLobotomizeToggle={handleDanger}
            />
        );

        await fireEvent.click(getByRole("button", { name: "Enable danger delete mode" }));
        expect(handleDanger).toHaveBeenCalledTimes(1);
        expect(getByText("Danger delete mode armed. Single-memory deletes happen immediately.")).toBeInTheDocument();
    });

    test("localizes German tier and filter controls while preserving agent names", async () => {
        const user = userEvent.setup();
        const { getByRole, getByText } = render(
            <MemoryFilters
                stats={{ sprint: 5, agent: 2, project: 10, activeModel: "test", staleEmbeddings: 0 }}
                sprints={[{ id: "2", number: 2, goal: "Untranslated sprint goal", name: "", repoPath: "" } as any]}
                agentPresets={[{ id: "agent2", name: "Agent Omega", description: "", modelName: "" } as any]}
                setShowAddModal={() => {}}
                lobotomize={false}
                handleLobotomizeToggle={() => {}}
            />,
            "de",
        );

        expect(getByRole("tab", { name: /Kurzzeit/ })).toHaveAttribute("aria-selected", "true");
        expect(getByRole("tab", { name: /Langzeit/ })).toBeInTheDocument();
        expect(getByRole("tab", { name: /Fähigkeiten/ })).toBeInTheDocument();
        expect(getByRole("group", { name: "Filter für den Erinnerungsumfang" })).toBeInTheDocument();
        await user.selectOptions(getByRole("combobox", { name: "Erinnerungen nach Agentenvorlage filtern" }), "agent2");
        expect(getByText("Agentenfilter auf Agent Omega gesetzt.")).toBeInTheDocument();
        expect(getByText(/Kurzzeit:.*Agent Omega/)).toBeInTheDocument();
    });
});
