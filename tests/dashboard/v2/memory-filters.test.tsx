/** @vitest-environment jsdom */
import { h } from "preact";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { afterEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { MemoryFilters } from "../../../dashboard/src/v2/components/memory/MemoryFilters.js";
import {
    activeTierSignal,
    selectedAgentPresetIdSignal,
    selectedSprintIdSignal,
} from "../../../dashboard/src/v2/components/memory/memoryState.js";
import type { MemoryStats } from "../../../dashboard/src/v2/lib/memory-api.js";
import type { AgentPreset, SprintRecord } from "../../../dashboard/src/v2/types.js";

expect.extend(matchers);

const stats: MemoryStats = {
    sprint: 2,
    agent: 1,
    project: 4,
    activeModel: "test-model",
    staleEmbeddings: 0,
};

const buildSprint = (id: string, number: number): SprintRecord => ({
    id,
    projectId: "project-1",
    number,
    slug: `sprint-${number}`,
    name: `Sprint ${number}`,
    isGeneratedName: false,
    originalPrompt: null,
    goal: `Goal ${number}`,
    status: "idle",
    showcasePinned: false,
    startDate: null,
    endDate: null,
    featureBranch: null,
    baseCommitSha: null,
    tasksCount: 0,
    completion: 0,
    linkedIssues: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
});

const buildAgentPreset = (id: string, name: string): AgentPreset => ({
    id,
    projectId: "project-1",
    name,
    description: "",
    instructionMarkdown: "",
    labels: [],
    sourcePath: null,
    sourceScope: null,
    sourceUpdatedAt: null,
    sourceImportedAt: null,
    sourceExists: false,
    syncStatus: "manual",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
});

const renderFilters = ({
    filterStats = stats,
    sprints = [buildSprint("sprint-1", 1), buildSprint("sprint-2", 2)],
    agentPresets = [buildAgentPreset("agent-1", "Agent One"), buildAgentPreset("agent-2", "Agent Two")],
}: {
    filterStats?: MemoryStats;
    sprints?: SprintRecord[];
    agentPresets?: AgentPreset[];
} = {}) => {
    return render(
        <MemoryFilters
            stats={filterStats}
            sprints={sprints}
            agentPresets={agentPresets}
            showModels={false}
            setShowModels={vi.fn()}
            setShowAddModal={vi.fn()}
            lobotomize={false}
            handleLobotomizeToggle={vi.fn()}
            skillsCount={12}
        />
    );
};

describe("MemoryFilters", () => {
    afterEach(() => {
        cleanup();
        activeTierSignal.value = "short_term";
        selectedSprintIdSignal.value = undefined;
        selectedAgentPresetIdSignal.value = undefined;
    });

    it("updates activeTierSignal and tab state when a tier tab is selected", () => {
        renderFilters();

        const shortTermTab = screen.getByRole("tab", { name: /Short Term/ });
        const longTermTab = screen.getByRole("tab", { name: /Long Term/ });

        expect(shortTermTab).toHaveAttribute("aria-selected", "true");
        expect(shortTermTab).toHaveAttribute("tabindex", "0");
        expect(longTermTab).toHaveAttribute("tabindex", "-1");

        fireEvent.click(longTermTab);

        expect(activeTierSignal.value).toBe("long_term");
        expect(longTermTab).toHaveAttribute("aria-selected", "true");
        expect(longTermTab).toHaveAttribute("tabindex", "0");
        expect(shortTermTab).toHaveAttribute("aria-selected", "false");
        expect(shortTermTab).toHaveAttribute("tabindex", "-1");
    });

    it("supports arrow-key roving focus across tier tabs", () => {
        renderFilters();

        const tablist = screen.getByRole("tablist", { name: "Memory Tier" });
        const shortTermTab = within(tablist).getByRole("tab", { name: /Short Term/ });
        const longTermTab = within(tablist).getByRole("tab", { name: /Long Term/ });

        shortTermTab.focus();
        fireEvent.keyDown(shortTermTab, { key: "ArrowRight" });

        expect(activeTierSignal.value).toBe("long_term");
        expect(document.activeElement).toBe(longTermTab);
        expect(longTermTab).toHaveAttribute("tabindex", "0");

        fireEvent.keyDown(longTermTab, { key: "Home" });

        expect(activeTierSignal.value).toBe("short_term");
        expect(document.activeElement).toBe(shortTermTab);
        expect(shortTermTab).toHaveAttribute("tabindex", "0");
    });

    it("shows the indexed Skills tier without destructive memory actions", () => {
        renderFilters();
        const skillsTab = screen.getByRole("tab", { name: /Skills/ });
        expect(within(skillsTab).getByText("12 skills")).toBeInTheDocument();

        fireEvent.click(skillsTab);

        expect(activeTierSignal.value).toBe("skills");
        expect(screen.queryByRole("button", { name: "Add Memory" })).toBeNull();
        expect(screen.queryByRole("button", { name: /danger delete mode/i })).toBeNull();
        expect(screen.getByText(/Versioned skill storages/)).toBeInTheDocument();
    });

    it("resets sprint and agent signals to undefined when placeholder options are selected", async () => {
        const user = userEvent.setup();
        renderFilters();

        const sprintSelect = screen.getByRole("combobox", { name: "Filter memory by Sprint" });
        const agentSelect = screen.getByRole("combobox", { name: "Filter memory by Agent Preset" });

        await user.selectOptions(sprintSelect, "sprint-2");
        await user.selectOptions(agentSelect, "agent-2");

        expect(selectedSprintIdSignal.value).toBe("sprint-2");
        expect(selectedAgentPresetIdSignal.value).toBe("agent-2");

        await user.selectOptions(sprintSelect, "");
        expect(selectedSprintIdSignal.value).toBeUndefined();
        expect(screen.getByText("Sprint filter cleared.")).toBeInTheDocument();

        await user.selectOptions(agentSelect, "");
        expect(selectedAgentPresetIdSignal.value).toBeUndefined();
        expect(screen.getByText("Agent filter set to all agents.")).toBeInTheDocument();
    });

    it("keeps tier tabs operable but omits selectors when source lists are empty", () => {
        renderFilters({
            sprints: [],
            agentPresets: [],
        });

        const shortTermTab = screen.getByRole("tab", { name: /Short Term/ });
        const longTermTab = screen.getByRole("tab", { name: /Long Term/ });

        expect(within(shortTermTab).getByText("3 memories")).toBeInTheDocument();
        expect(screen.queryByRole("combobox", { name: "Filter memory by Sprint" })).toBeNull();
        expect(screen.queryByRole("combobox", { name: "Filter memory by Agent Preset" })).toBeNull();
        expect(screen.getByText("No sprint or agent filters are available for this tier.")).toBeInTheDocument();

        fireEvent.click(longTermTab);

        expect(activeTierSignal.value).toBe("long_term");
        expect(longTermTab).toHaveAttribute("aria-selected", "true");
        expect(screen.queryByRole("combobox", { name: "Filter memory by Sprint" })).toBeNull();
        expect(screen.queryByRole("combobox", { name: "Filter memory by Agent Preset" })).toBeNull();
        expect(screen.getByText("No agent filters are available for this tier.")).toBeInTheDocument();
    });

    it("keeps a zero-count Short Term tab operable without rendering short-term selectors", () => {
        renderFilters({
            filterStats: { ...stats, sprint: 0, agent: 0 },
        });

        const shortTermTab = screen.getByRole("tab", { name: /Short Term/ });
        const longTermTab = screen.getByRole("tab", { name: /Long Term/ });

        expect(within(shortTermTab).getByText("0 memories")).toBeInTheDocument();
        expect(shortTermTab).toHaveAttribute("aria-selected", "true");
        expect(screen.queryByRole("combobox", { name: "Filter memory by Sprint" })).toBeNull();
        expect(screen.queryByRole("combobox", { name: "Filter memory by Agent Preset" })).toBeNull();
        expect(screen.getByText("No short-term memory filters are available for this tier.")).toBeInTheDocument();

        fireEvent.click(longTermTab);

        expect(activeTierSignal.value).toBe("long_term");
        expect(screen.queryByRole("combobox", { name: "Filter memory by Sprint" })).toBeNull();
        expect(screen.getByRole("combobox", { name: "Filter memory by Agent Preset" })).toBeInTheDocument();
    });
});
