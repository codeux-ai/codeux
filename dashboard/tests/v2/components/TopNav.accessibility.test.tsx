/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as matchers from "@testing-library/jest-dom/matchers";
import { createContext } from "preact";

const mockProjectDataContext = createContext({});

// Mock required contexts and hooks
vi.mock("../../../src/v2/context/project-data.js", () => {
    return {
        ProjectDataContext: createContext({}),
        useProjectData: () => ({
            projects: [
                { id: "proj-1", name: "Project Alpha", status: "idle" },
                { id: "proj-2", name: "Project Beta", status: "idle" }
            ],
            selectedProject: { id: "proj-1", name: "Project Alpha", status: "idle" },
            loading: false,
            selectProject: vi.fn().mockResolvedValue(undefined),
        })
    };
});

let mockSprintsData = {
    data: [
        { id: "spr-1", name: "Sprint 1", number: 1, status: "idle" },
        { id: "spr-2", name: "Sprint 2", number: 2, status: "idle" }
    ],
    selectedSprintId: "spr-1",
    selectedSprint: { id: "spr-1", name: "Sprint 1", number: 1, status: "idle" },
    loading: false,
    selectSprint: vi.fn().mockResolvedValue(undefined),
};

vi.mock("../../../src/hooks/useSprints.js", () => ({
    useSprints: () => mockSprintsData
}));

vi.mock("../../../src/v2/hooks/use-project-effective-settings.js", () => ({
    useProjectEffectiveSettings: () => ({
        data: { settings: { git: { sprintKeyPrefix: "SPR" }, sprintPreview: { enabled: true, showInAppBrowser: true } } },
        effectiveSettings: { settings: { sprintPreview: { enabled: true, showInAppBrowser: true } } }
    })
}));

vi.mock("../../../src/v2/hooks/use-notifications.js", () => ({
    useNotifications: () => ({
        notifications: [],
        unreadCount: 0,
        markAllRead: vi.fn(),
        markRead: vi.fn(),
        dismiss: vi.fn(),
        refresh: vi.fn(),
    })
}));

vi.mock("../../../src/v2/hooks/use-is-dark.js", () => ({
    useIsDark: () => false
}));

// Mock GSAP to prevent errors during rendering
vi.mock("gsap", () => ({
    default: {
        fromTo: vi.fn(),
        to: vi.fn(),
    }
}));

// Mock Router link
vi.mock("@tanstack/react-router", () => ({
    Link: ({ children }: any) => <a href="#">{children}</a>
}));

vi.mock("../../../src/v2/components/top-nav/GlobalSearch.js", () => ({
    GlobalSearch: () => <div data-testid="global-search">Search</div>
}))

vi.mock("../../../src/v2/components/top-nav/BrandSection.js", () => ({
    BrandSection: () => <div data-testid="brand-section">Brand</div>
}))

vi.mock("../../../src/v2/components/top-nav/TelemetryStats.js", () => ({
    TelemetryStats: () => <div data-testid="telemetry-stats">Stats</div>
}))

vi.mock("../../../src/v2/components/DockerStatusMenu.js", () => ({
    DockerStatusMenu: () => <div data-testid="docker-status">Docker</div>
}))

vi.mock("../../../src/v2/components/browser/BrowserSessionsMenu.js", () => ({
    BrowserSessionsMenu: () => <div data-testid="browser-sessions">Browser</div>
}))

// Mock the hook last
vi.mock("../../../src/v2/hooks/useThemeSetting.js", () => ({
    useThemeSetting: () => ({ theme: 'system', setTheme: vi.fn() }),
    ThemeProvider: ({ children }: any) => <div>{children}</div>
}));

import { TopNav } from "../../../src/v2/components/TopNav.js";
import { ThemeProvider } from "../../../src/v2/hooks/useThemeSetting.js";

expect.extend(matchers);

describe("TopNav Selectors Accessibility", () => {
    let user: ReturnType<typeof userEvent.setup>;

    beforeEach(() => {
        user = userEvent.setup();
        mockSprintsData = {
            data: [
                { id: "spr-1", name: "Sprint 1", number: 1, status: "idle" },
                { id: "spr-2", name: "Sprint 2", number: 2, status: "idle" }
            ],
            selectedSprintId: "spr-1",
            selectedSprint: { id: "spr-1", name: "Sprint 1", number: 1, status: "idle" },
            loading: false,
            selectSprint: vi.fn().mockResolvedValue(undefined),
        };
    });

    afterEach(() => {
        cleanup();
        vi.clearAllMocks();
    });

    const renderNav = () => {
        return render(
            <ThemeProvider>
                <TopNav />
            </ThemeProvider>
        );
    };

    it("has accessible names and aria-expanded on selector buttons", async () => {
        renderNav();
        const projectBtn = document.getElementById("project-selector-button");
        const sprintBtn = document.getElementById("sprint-selector-button");

        expect(projectBtn).toHaveAttribute("aria-expanded", "false");
        expect(sprintBtn).toHaveAttribute("aria-expanded", "false");

        expect(projectBtn).toHaveAttribute("aria-controls", "project-listbox");
        expect(sprintBtn).toHaveAttribute("aria-controls", "sprint-listbox");
    });

    it("can open project dropdown with keyboard", async () => {
        renderNav();
        const projectBtn = document.getElementById("project-selector-button") as HTMLButtonElement;

        projectBtn.focus();
        await user.keyboard("{Enter}");

        expect(projectBtn).toHaveAttribute("aria-expanded", "true");

        const listbox = screen.getByRole("listbox", { name: /Project list/i });
        expect(listbox).toBeInTheDocument();
    });

    it("can filter projects and keeps aria-selected updated", async () => {
        renderNav();
        const projectBtn = document.getElementById("project-selector-button") as HTMLButtonElement;

        projectBtn.focus();
        await user.keyboard("{Enter}");

        const filterInput = screen.getByRole("textbox", { name: /Filter projects/i });
        expect(filterInput).toHaveAttribute("aria-controls", "project-listbox");

        // Before filtering, we have two options
        expect(screen.getAllByRole("option")).toHaveLength(2);

        const alphaOption = screen.getByRole("option", { name: /Project Alpha/i });
        expect(alphaOption).toHaveAttribute("aria-selected", "true");

        const betaOption = screen.getByRole("option", { name: /Project Beta/i });
        expect(betaOption).toHaveAttribute("aria-selected", "false");

        // Type to filter
        await user.type(filterInput, "Beta");

        expect(screen.getAllByRole("option")).toHaveLength(1);
        expect(screen.getByRole("option", { name: /Project Beta/i })).toBeInTheDocument();
        expect(screen.queryByRole("option", { name: /Project Alpha/i })).not.toBeInTheDocument();
    });

    it("restores focus to selector button on Escape", async () => {
        renderNav();

        const projectBtn = document.getElementById("project-selector-button") as HTMLButtonElement;

        projectBtn.focus();
        await user.keyboard("{Enter}");

        expect(screen.getByRole("listbox", { name: /Project list/i })).toBeInTheDocument();

        await user.keyboard("{Escape}");

        // Let setTimeout run for focus restoration
        await new Promise(r => setTimeout(r, 0));

        expect(document.activeElement).toBe(projectBtn);
    });

    it("supports Home and End keyboard navigation in dropdown", async () => {
        renderNav();
        const projectBtn = document.getElementById("project-selector-button") as HTMLButtonElement;

        projectBtn.focus();
        await user.keyboard("{Enter}");

        // Wait for focus
        await new Promise(r => setTimeout(r, 0));

        // Ensure options are there
        const options = screen.getAllByRole("option");
        expect(options).toHaveLength(2);

        await user.keyboard("{End}");
        expect(document.activeElement).toBe(screen.getByText("Manage Projects").closest("a"));

        await user.keyboard("{Home}");
        // Focus should move to the filter input actually, because it's focusable
        const input = screen.getByRole("textbox");
        expect(document.activeElement).toBe(input);
    });

    it("announces selected state in aria-label", async () => {
        renderNav();
        const projectBtn = document.getElementById("project-selector-button");
        expect(projectBtn).toHaveAttribute("aria-label", "Selected project: Project Alpha");

        const sprintBtn = document.getElementById("sprint-selector-button");
        expect(sprintBtn?.getAttribute("aria-label")).toMatch(/^Selected sprint:/);
    });

    it("can select an option using keyboard", async () => {
        renderNav();
        const projectBtn = document.getElementById("project-selector-button") as HTMLButtonElement;

        projectBtn.focus();
        await user.keyboard("{Enter}");

        const betaOption = screen.getByRole("option", { name: /Project Beta/i });
        betaOption.focus();
        await user.keyboard("{Enter}");

        // Let promises resolve
        await new Promise(r => setTimeout(r, 0));

        expect(projectBtn).toHaveAttribute("aria-expanded", "false");
    });

    it("announces sprint disabled state appropriately when no sprints", async () => {
        mockSprintsData.data = [];
        mockSprintsData.selectedSprintId = null;
        mockSprintsData.selectedSprint = null;

        renderNav();
        const sprintBtn = document.getElementById("sprint-selector-button") as HTMLButtonElement;

        expect(sprintBtn).toHaveAttribute("aria-disabled", "true");
        await user.click(sprintBtn);
        expect(sprintBtn).toHaveAttribute("aria-expanded", "false");
    });
});
