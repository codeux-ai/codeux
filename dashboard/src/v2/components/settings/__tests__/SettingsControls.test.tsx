/**
 * @vitest-environment jsdom
 */
import { h } from "preact";
import { useRef, useState } from "preact/hooks";
import { readFileSync } from "node:fs";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/preact";
import "@testing-library/jest-dom/vitest";
import { BranchNameSchemeEditor } from "../BranchNameSchemeEditor";
import { SprintKeyEditor } from "../SprintKeyEditor";
import { TextInput, SecretInput, NumberInput, TextAreaInput, PillChoiceGroup, SelectInput } from "../SettingsFormFields";


import { SettingsCategoryRail, CATEGORIES } from "../SettingsCategoryRail";
import { SettingsScopeControls } from "../SettingsScopeControls";
import { ActionButton, NoticePanel } from "../SettingsSurface";
import { OverrideBadge } from "../panels/SharedPanelComponents";
import { SettingsTechstacksPanel } from "../panels/SettingsTechstacksPanel";
import { SlidersHorizontal } from "lucide-preact";
import type { SettingsSearchMatches } from "../../../lib/settings-search-index";
import type { Source } from "../../../types";
import userEvent from "@testing-library/user-event";
import { SettingsActivePanelStatus } from "../SettingsActivePanelStatus";
import { SettingsContentPanels } from "../SettingsContentPanels";
import { UnsavedChangesModal } from "../../ui/UnsavedChangesModal";
import { ProviderInstanceCard } from "../ProviderInstanceCard";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../../../lib/settings";
import { dashboardSettingsToProjectSettings } from "../../../lib/settings-view-models";
import type { ProjectSettings, SystemSettings, TechstackCatalogEntrySettings } from "../../../../types";
import { SettingsSmartFindSearch } from "../../../SettingsPage";

const defaultInnerHeight = window.innerHeight;
const interactionStyle = { transitionDuration: "200ms", transitionTimingFunction: "ease" };
const genericProject = {
  id: "project-1",
  name: "Test Project",
} as Source;

const renderSettingsScopeControls = (overrides: Partial<Parameters<typeof SettingsScopeControls>[0]> = {}) => render(
  <SettingsScopeControls
    activeScope="system"
    setActiveScope={() => {}}
    selectedProject={genericProject}
    scopeStatusText="System scope selected. Editing live system defaults."
    projectSourceSummary={null}
    filteredCategoryCount={10}
    isSearchActive={false}
    activeDirty={false}
    activeSaving={false}
    saveMessage={null}
    error={null}
    interactionStyle={interactionStyle}
    {...overrides}
  />,
);

const renderSettingsSmartFindSearch = (overrides: Partial<Parameters<typeof SettingsSmartFindSearch>[0]> = {}) => {
  const defaultProps: Parameters<typeof SettingsSmartFindSearch>[0] = {
    settingsSearch: "",
    setSettingsSearch: () => {},
    searchInputRef: { current: null },
    filteredCategories: CATEGORIES,
    settingsSearchMatches: {},
    activeCategory: "general",
    activeCategoryConfig: CATEGORIES[0],
    onSwitchCategory: () => {},
    interactionStyle,
  };

  return render(<SettingsSmartFindSearch {...defaultProps} {...overrides} />);
};

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(window, "innerHeight", { configurable: true, value: defaultInnerHeight });
  cleanup();
});

vi.mock("../panels/SettingsGeneralPanel", () => ({
  SettingsGeneralPanel: () => <div>General panel values stay mounted</div>,
}));

const customTechstack: TechstackCatalogEntrySettings = {
  id: "custom-web",
  label: "Custom Web",
  items: [
    { id: "vite", label: "Vite" },
    { id: "tailwind", label: "Tailwind" },
  ],
};

const createProjectSettings = (techstack?: ProjectSettings["techstack"]): ProjectSettings => ({
  ...dashboardSettingsToProjectSettings(DEFAULT_DASHBOARD_SETTINGS),
  ...(techstack ? { techstack } : {}),
});

const createCatalogEntries = (): TechstackCatalogEntrySettings[] => [
  ...DEFAULT_DASHBOARD_SETTINGS.techstackCatalog.entries.map((entry) => ({
    ...entry,
    items: entry.items.map((item) => ({ ...item })),
  })),
  {
    ...customTechstack,
    items: customTechstack.items.map((item) => ({ ...item })),
  },
];

const createSystemSettings = (projectSettings: ProjectSettings): SystemSettings => ({
  runtime: {} as SystemSettings["runtime"],
  integrations: {} as SystemSettings["integrations"],
  defaults: projectSettings,
  techstackCatalog: {
    defaultTechstackId: DEFAULT_DASHBOARD_SETTINGS.techstackCatalog.defaultTechstackId,
    entries: createCatalogEntries(),
  },
  mcpTools: [],
  customMcpServers: [],
  modelPricing: { overrides: {} },
});

  it("SettingsCategoryRail renders categories with proper aria-current semantics", () => {
    const mockCategories = [
      { id: "general" as const, num: "01", label: "General", icon: SlidersHorizontal, description: "Test" }
    ];
    render(
      <SettingsCategoryRail
        filteredCategories={mockCategories}
        activeCategory="general"
        settingsSearch=""
        settingsSearchMatches={{}}
        onSwitchCategory={() => {}}
      />
    );
    const btn = screen.getByRole("button", { name: /General/ });
    expect(btn).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("navigation", { name: "Settings categories" })).toHaveClass(
      "lg:max-h-[var(--settings-category-rail-available-height)]",
      "lg:overflow-y-auto",
      "scrollbar-hide",
    );
    expect(screen.queryByText("Categories")).not.toBeInTheDocument();
    expect(screen.queryByText("Jump directly into the area you need without digging through the full settings tree.")).not.toBeInTheDocument();
  });

  it("SettingsCategoryRail includes the Techstacks category without changing selection semantics", () => {
    const techstacks = CATEGORIES.find((category) => category.id === "techstacks");

    expect(techstacks?.label).toBe("Techstacks");

    render(
      <SettingsCategoryRail
        filteredCategories={CATEGORIES}
        activeCategory="techstacks"
        settingsSearch=""
        settingsSearchMatches={{}}
        onSwitchCategory={() => {}}
      />
    );

    const btn = screen.getByRole("button", { name: /Techstacks/ });
    expect(btn).toHaveAttribute("aria-current", "page");
    expect(btn).toHaveAttribute("aria-selected", "true");
  });

  it("SettingsCategoryRail subtracts the measured page-top margin from its desktop height", async () => {
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 900 });
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 240,
      top: 240,
      right: 240,
      bottom: 640,
      left: 0,
      width: 240,
      height: 400,
      toJSON: () => ({}),
    });
    const mockCategories = [
      { id: "general" as const, num: "01", label: "General", icon: SlidersHorizontal, description: "Test" }
    ];

    render(
      <SettingsCategoryRail
        filteredCategories={mockCategories}
        activeCategory="general"
        settingsSearch=""
        settingsSearchMatches={{}}
        onSwitchCategory={() => {}}
      />
    );

    const rail = screen.getByRole("navigation", { name: "Settings categories" });
    await waitFor(() => {
      expect(rail).toHaveStyle("--settings-category-rail-available-height: 644px");
    });
    expect(rail).not.toHaveClass("lg:h-[calc(100dvh-5rem)]");
  });

  it("SettingsCategoryRail shows a hidden-scrollbar scroll hint only while more categories are below", async () => {
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 900 });
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 240,
      top: 240,
      right: 280,
      bottom: 640,
      left: 0,
      width: 280,
      height: 400,
      toJSON: () => ({}),
    });
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(900);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(320);
    const scrollTopSpy = vi.spyOn(HTMLElement.prototype, "scrollTop", "get").mockReturnValue(0);
    const mockCategories = [
      { id: "general" as const, num: "01", label: "General", icon: SlidersHorizontal, description: "Test" }
    ];

    render(
      <SettingsCategoryRail
        filteredCategories={mockCategories}
        activeCategory="general"
        settingsSearch=""
        settingsSearchMatches={{}}
        onSwitchCategory={() => {}}
      />
    );

    const rail = screen.getByRole("navigation", { name: "Settings categories" });
    expect(await screen.findByTestId("settings-category-scroll-hint")).toHaveClass("-bottom-4", "-mb-4", "pb-4");
    expect(rail).toHaveClass("scrollbar-hide");

    scrollTopSpy.mockReturnValue(580);
    fireEvent.scroll(rail);

    await waitFor(() => {
      expect(screen.queryByTestId("settings-category-scroll-hint")).not.toBeInTheDocument();
    });
  });

  it("SettingsCategoryRail explains provider search matches", () => {
    const mockCategories = [
      { id: "integrations" as const, num: "08", label: "Integrations", icon: SlidersHorizontal, description: "Connections" }
    ];
    const settingsSearchMatches: SettingsSearchMatches = {
      integrations: {
        categoryId: "integrations",
        matchedLabels: ["Claude Code"],
        matchedDescriptions: [],
        matchedTerms: [],
      },
    };

    render(
      <SettingsCategoryRail
        filteredCategories={mockCategories}
        activeCategory="integrations"
        settingsSearch="claude"
        settingsSearchMatches={settingsSearchMatches}
        onSwitchCategory={() => {}}
      />
    );

    expect(screen.getByText(/Showing 1 categories for "claude"\./)).toBeInTheDocument();
    expect(screen.getByText("Claude Code")).toBeInTheDocument();
  });

  it("SettingsCategoryRail gives no-match recovery copy", () => {
    render(
      <SettingsCategoryRail
        filteredCategories={[]}
        activeCategory="general"
        settingsSearch="zzzz"
        settingsSearchMatches={{}}
        onSwitchCategory={() => {}}
      />
    );

    expect(screen.getByText(/No categories match "zzzz"/)).toBeInTheDocument();
    expect(screen.getByText(/Keep the search field focused/)).toBeInTheDocument();
  });

  it("SettingsSmartFindSearch keeps idle status quiet while preserving the category count for assistive technology", () => {
    renderSettingsSmartFindSearch();

    expect(screen.getByText("Press slash to search settings.")).toBeInTheDocument();
    expect(screen.getByText("11 settings categories available.")).toHaveClass("sr-only");
    expect(screen.queryByText("11 settings categories available. Press slash to search.")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Clear settings search" })).not.toBeInTheDocument();
    expect(screen.getByText("/")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Appearance" })).toBeInTheDocument();
  });

  it("SettingsSmartFindSearch announces active matches with counts, active category, and previews", () => {
    const modelsCategory = CATEGORIES.find((category) => category.id === "models")!;
    const integrationsCategory = CATEGORIES.find((category) => category.id === "integrations")!;
    const settingsSearchMatches: SettingsSearchMatches = {
      models: {
        categoryId: "models",
        matchedLabels: ["Claude Code"],
        matchedDescriptions: [],
        matchedTerms: ["routing"],
      },
      integrations: {
        categoryId: "integrations",
        matchedLabels: [],
        matchedDescriptions: ["API keys"],
        matchedTerms: [],
      },
    };

    renderSettingsSmartFindSearch({
      settingsSearch: "claude",
      filteredCategories: [modelsCategory, integrationsCategory],
      settingsSearchMatches,
      activeCategory: "models",
      activeCategoryConfig: modelsCategory,
    });

    expect(screen.getByRole("status")).toHaveTextContent(
      '3 results across 2 matching categories for "claude". Active category: AI Models. Active matches: Claude Code, routing. Match previews: Claude Code, routing, API keys.',
    );
    expect(screen.getByLabelText("Smart Find match previews")).toHaveTextContent("Claude Code");
    expect(screen.getByRole("button", { name: "Integrations" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Appearance" })).not.toBeInTheDocument();
  });

  it("SettingsSmartFindSearch announces active no-match searches without hiding recovery context", () => {
    renderSettingsSmartFindSearch({
      settingsSearch: "zzzz",
      filteredCategories: [],
      settingsSearchMatches: {},
    });

    expect(screen.getByRole("status")).toHaveTextContent(
      '0 results across 0 matching categories for "zzzz". Active category: General. Match previews: none. Clear the search or try routing, provider, auth, CI, agent, or memory.',
    );
    expect(screen.queryByLabelText("Smart Find match previews")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Appearance" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear settings search" })).toBeInTheDocument();
  });

  it("SettingsSmartFindSearch clear button restores focus and removes search-only chips", async () => {
    const user = userEvent.setup();
    const integrationsCategory = CATEGORIES.find((category) => category.id === "integrations")!;
    const settingsSearchMatches: SettingsSearchMatches = {
      integrations: {
        categoryId: "integrations",
        matchedLabels: ["Claude Code"],
        matchedDescriptions: [],
        matchedTerms: [],
      },
    };

    const SmartFindHarness = () => {
      const [settingsSearch, setSettingsSearch] = useState("claude");
      const searchInputRef = useRef<HTMLInputElement>(null);
      const searchActive = settingsSearch.trim().length > 0;

      return (
        <SettingsSmartFindSearch
          settingsSearch={settingsSearch}
          setSettingsSearch={setSettingsSearch}
          searchInputRef={searchInputRef}
          filteredCategories={searchActive ? [integrationsCategory] : CATEGORIES}
          settingsSearchMatches={searchActive ? settingsSearchMatches : {}}
          activeCategory="general"
          activeCategoryConfig={CATEGORIES[0]}
          onSwitchCategory={() => {}}
          interactionStyle={interactionStyle}
        />
      );
    };

    render(<SmartFindHarness />);

    const searchInput = screen.getByRole("textbox", { name: "Search settings categories" });
    await user.click(screen.getByRole("button", { name: "Clear settings search" }));

    expect(searchInput).toHaveFocus();
    expect(searchInput).toHaveValue("");
    expect(screen.queryByRole("button", { name: "Clear settings search" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Smart Find match previews")).not.toBeInTheDocument();
    expect(screen.queryByText("Claude Code")).not.toBeInTheDocument();
    expect(screen.getByText("Press slash to search settings.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Appearance" })).toBeInTheDocument();
  });

  it("SettingsCategoryRail exposes pending and disabled category states without selected or pending badges", () => {
    cleanup();
    const mockCategories = [
      { id: "general" as const, num: "01", label: "General", icon: SlidersHorizontal, description: "Test" }
    ];

    render(
      <SettingsCategoryRail
        filteredCategories={mockCategories}
        activeCategory="general"
        settingsSearch=""
        settingsSearchMatches={{}}
        pendingCategory="general"
        disabledCategoryReason="Finish the current save before changing categories."
        onSwitchCategory={() => {}}
      />
    );

    const btn = screen.getByRole("button", { name: /General/ });
    expect(btn).toHaveAttribute("aria-current", "page");
    expect(btn).toHaveAttribute("aria-selected", "true");
    expect(btn).toHaveAttribute("aria-busy", "true");
    expect(btn).toBeDisabled();
    expect(screen.queryByText("Selected")).not.toBeInTheDocument();
    expect(screen.queryByText("Pending")).not.toBeInTheDocument();
    expect(screen.getByText("Disabled")).toBeInTheDocument();
  });

  it("SettingsCategoryRail marks category movement with the selectionMovement contract", () => {
    cleanup();
    const mockCategories = [
      { id: "general" as const, num: "01", label: "General", icon: SlidersHorizontal, description: "Test" }
    ];

    render(
      <SettingsCategoryRail
        filteredCategories={mockCategories}
        activeCategory="general"
        settingsSearch=""
        settingsSearchMatches={{}}
        onSwitchCategory={() => {}}
      />
    );

    expect(screen.getByRole("navigation", { name: "Settings categories" })).toHaveAttribute("data-motion-contract", "selectionMovement");
    expect(screen.getByRole("button", { name: /General/ })).toHaveAttribute("data-motion-contract", "selectionMovement");
  });

  it("PillChoiceGroup exposes radio semantics for the selected option", () => {
    render(
      <PillChoiceGroup
        value="system"
        onChange={() => {}}
        aria-label="Scope choice"
        options={[
          { value: "system", label: "System" },
          { value: "project", label: "Project" },
        ]}
      />
    );

    expect(screen.getByRole("radiogroup", { name: "Scope choice" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "System" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Project" })).toHaveAttribute("aria-checked", "false");
  });

  it("SettingsScopeControls renders system scope without duplicated visible system context", () => {
    renderSettingsScopeControls();

    const group = screen.getByRole("radiogroup", { name: "Settings scope" });
    expect(group).toHaveAccessibleDescription(
      "Editing live system defaults. Project scope is available for the selected project. System scope selected. Editing live system defaults.",
    );
    expect(screen.getByRole("radio", { name: "System" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Project" })).toHaveAttribute("aria-checked", "false");
    expect(screen.queryByText("System (selected)")).not.toBeInTheDocument();
    expect(screen.getByText("Editing live system defaults.")).toHaveClass("sr-only");
    expect(screen.queryByText(/visible categor/)).not.toBeInTheDocument();
  });

  it("SettingsScopeControls keeps project unavailable guidance wired to the disabled radio", () => {
    const setActiveScope = vi.fn();
    renderSettingsScopeControls({
      selectedProject: null,
      setActiveScope,
      scopeStatusText: "Project scope is unavailable until a project is selected.",
    });

    const projectRadio = screen.getByRole("radio", { name: "Project" });
    expect(projectRadio).toBeDisabled();
    expect(projectRadio).toHaveAccessibleDescription("Project scope unlocks after selecting a project.");
    expect(screen.getByText("Project scope unlocks after selecting a project.")).toHaveAttribute("id", "settings-project-scope-disabled");

    fireEvent.click(projectRadio);
    expect(setActiveScope).not.toHaveBeenCalled();
  });

  it("SettingsScopeControls renders project inheritance and saved state chips", () => {
    renderSettingsScopeControls({
      activeScope: "project",
      scopeStatusText: "Project scope selected. Editing overrides for Test Project.",
      projectSourceSummary: "2 overridden settings and 8 inherited settings in this project scope.",
      saveMessage: "Settings saved.",
    });

    expect(screen.getByRole("radio", { name: "Project" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("Editing overrides for Test Project")).toBeInTheDocument();
    expect(screen.getByText("2 overridden settings and 8 inherited settings in this project scope.")).toBeInTheDocument();
    expect(screen.getByText("Saved")).toBeInTheDocument();
  });

  it("SettingsScopeControls renders unsaved edits without the saved badge", () => {
    renderSettingsScopeControls({
      activeDirty: true,
      saveMessage: "Settings saved.",
    });

    expect(screen.getByText("Unsaved edits")).toBeInTheDocument();
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
  });

  it("SettingsScopeControls shows visible category count only while Smart Find is active", () => {
    const { rerender } = renderSettingsScopeControls({
      filteredCategoryCount: 4,
      isSearchActive: false,
    });

    expect(screen.queryByText("4 visible categories")).not.toBeInTheDocument();

    rerender(
      <SettingsScopeControls
        activeScope="system"
        setActiveScope={() => {}}
        selectedProject={genericProject}
        scopeStatusText="System scope selected. Editing live system defaults."
        projectSourceSummary={null}
        filteredCategoryCount={1}
        isSearchActive
        activeDirty={false}
        activeSaving={false}
        saveMessage={null}
        error={null}
        interactionStyle={interactionStyle}
      />,
    );

    expect(screen.getByText("1 visible category")).toBeInTheDocument();
  });

  it("SelectInput keeps disabled reason visible and described by the control", () => {
    render(
      <SelectInput
        value="off"
        onChange={() => {}}
        disabled
        disabledReason="Switch GitHub mode to Remote to use this policy."
        aria-label="Feature PR auto-merge"
        options={[
          { value: "off", label: "Off" },
          { value: "green", label: "When green" },
        ]}
      />
    );

    const trigger = screen.getByRole("button", { name: "Feature PR auto-merge" });
    const reason = screen.getByText("Switch GitHub mode to Remote to use this policy.");
    expect(reason.id).toBeTruthy();
    expect(trigger).toHaveAccessibleDescription("Switch GitHub mode to Remote to use this policy.");
  });

  it("ActionButton provides busy state feedback", () => {
    render(
      <ActionButton label="Save" onClick={() => {}} busy={true} />
    );
    const btn = screen.getByRole("button", { name: "Save" });
    expect(btn).toHaveAttribute("aria-busy", "true");
    expect(btn).toHaveAttribute("aria-disabled", "true");
  });

  it("ActionButton exposes a disabled save reason", () => {
    cleanup();
    render(
      <ActionButton label="Save" onClick={() => {}} disabled disabledReason="Fix errors to save." />
    );

    const btn = screen.getByRole("button", { name: /Save/ });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("title", "Fix errors to save.");
    expect(btn).toHaveAccessibleDescription("Fix errors to save.");
  });

  it("OverrideBadge handles reset click", async () => {
    const user = userEvent.setup();
    let clicked = false;
    render(
      <OverrideBadge label="Project override" onReset={() => { clicked = true; }} contextLabel="My Setting" />
    );
    const btn = screen.getByRole("button", { name: /Delete project override for My Setting/ });
    await user.click(btn);
    expect(clicked).toBe(true);
  });



  it("ActionButton renders danger tone", () => {
    render(<ActionButton label="Wipe" onClick={() => {}} tone="danger" />);
    const btn = screen.getByRole("button", { name: "Wipe" });
    expect(btn.className).toContain("status-red");
  });


describe("SettingsControls Accessibility", () => {
  it("BranchNameSchemeEditor passes aria-label and aria-description", () => {
    render(
      <BranchNameSchemeEditor
        value="test"
        onChange={() => {}}
      />
    );
    const input = screen.getByRole("textbox");
    expect(input).toHaveAttribute("aria-label", "Sprint branch scheme");
    expect(input).toHaveAttribute("aria-description", "Template used when naming sprint branches.");
  });

  it("SprintKeyEditor passes aria-label and aria-description", () => {
    render(
      <SprintKeyEditor
        value="SPR"
        onChange={() => {}}
      />
    );
    const input = screen.getByRole("textbox");
    expect(input).toHaveAttribute("aria-label", "Sprint key prefix");
    expect(input).toHaveAttribute("aria-description", "Prefix used when generating sprint keys (e.g. SPR-1).");
  });

  it("TextInput passes aria-label and aria-description", () => {
    render(
      <TextInput
        value="test"
        onChange={() => {}}
        aria-label="Test Label"
        aria-description="Test Description"
      />
    );
    const input = screen.getByRole("textbox");
    expect(input).toHaveAttribute("aria-label", "Test Label");
    expect(input).toHaveAttribute("aria-description", "Test Description");
  });

  it("SecretInput masks values by default and reveals only on request", async () => {
    const user = userEvent.setup();
    render(
      <SecretInput
        value="sk-test-secret"
        onChange={() => {}}
        aria-label="API key"
        aria-description="Secret token"
      />
    );

    const input = screen.getByLabelText("API key");
    expect(input).toHaveAttribute("type", "password");
    expect(input).toHaveAttribute("aria-description", "Secret token");

    await user.click(screen.getByRole("button", { name: "Show API key" }));
    expect(input).toHaveAttribute("type", "text");
    expect(screen.getByRole("button", { name: "Hide API key" })).toHaveAttribute("aria-pressed", "true");
  });

  it("NumberInput passes aria-label and aria-description", () => {
    render(
      <NumberInput
        value={10}
        onChange={() => {}}
        aria-label="Num Label"
        aria-description="Num Description"
      />
    );
    const input = screen.getByRole("spinbutton");
    expect(input).toHaveAttribute("aria-label", "Num Label");
    expect(input).toHaveAttribute("aria-description", "Num Description");
  });

  it("NumberInput wires helper and invalid text to the control", () => {
    const { rerender } = render(
      <NumberInput
        value={0}
        onChange={() => {}}
        aria-label="Retry count"
        helperText="Use a value between 1 and 5."
        errorText="Retry count must be at least 1."
      />
    );

    const input = screen.getByRole("spinbutton", { name: "Retry count" });
    expect(input).toHaveAccessibleDescription("Use a value between 1 and 5.");
    expect(input).not.toHaveAttribute("aria-invalid", "true");

    rerender(
      <NumberInput
        value={0}
        onChange={() => {}}
        aria-label="Retry count"
        helperText="Use a value between 1 and 5."
        errorText="Retry count must be at least 1."
        invalid
        forceValidation
      />
    );

    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("Retry count must be at least 1.");
    expect(screen.getByRole("alert")).toHaveTextContent("Retry count must be at least 1.");
  });

  it("NumberInput exposes positive confidence cues", () => {
    render(
      <NumberInput
        value={3}
        onChange={() => {}}
        aria-label="Retry count"
        valid
      />
    );

    const input = screen.getByRole("spinbutton", { name: "Retry count" });
    expect(input).toHaveAttribute("data-valid", "true");
    expect(input).toHaveAccessibleDescription("Ready to save.");
  });

  it("TextAreaInput passes aria-label and aria-description", () => {
    render(
      <TextAreaInput
        value="test"
        onChange={() => {}}
        aria-label="Textarea Label"
        aria-description="Textarea Description"
      />
    );
    const input = screen.getByRole("textbox");
    expect(input).toHaveAttribute("aria-label", "Textarea Label");
    expect(input).toHaveAttribute("aria-description", "Textarea Description");
  });

  it("TextAreaInput announces validation after validation is forced", () => {
    render(
      <TextAreaInput
        value=""
        onChange={() => {}}
        aria-label="Instruction template"
        helperText="Markdown is supported."
        errorText="Instruction template is required."
        invalid
        forceValidation
      />
    );

    const input = screen.getByRole("textbox", { name: "Instruction template" });
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("Instruction template is required.");
    expect(screen.getByRole("alert")).toHaveTextContent("Instruction template is required.");
  });

  it("TextAreaInput exposes positive confidence cues", () => {
    render(
      <TextAreaInput
        value="Use project conventions."
        onChange={() => {}}
        aria-label="Instruction template"
        valid
      />
    );

    const input = screen.getByRole("textbox", { name: "Instruction template" });
    expect(input).toHaveAttribute("data-valid", "true");
    expect(input).toHaveAccessibleDescription("Ready to save.");
  });

  it("UnsavedChangesModal exposes save and discard pending intent", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const onConfirm = vi.fn();
    render(
      <UnsavedChangesModal
        onConfirm={onConfirm}
        onCancel={vi.fn()}
        onSave={onSave}
        saving
      />
    );

    const saveButton = screen.getByRole("button", { name: /Saving/ });
    expect(saveButton).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText(/Discarding permanently drops/)).toBeInTheDocument();

    cleanup();
    render(
      <UnsavedChangesModal
        onConfirm={onConfirm}
        onCancel={vi.fn()}
        onSave={onSave}
      />
    );

    const discardButton = screen.getByRole("button", { name: "Discard without saving" });
    await user.click(discardButton);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(discardButton).toHaveAttribute("aria-busy", "true");
  });

  it("SettingsActivePanelStatus renders the sticky active panel save state contract", () => {
    render(
      <SettingsActivePanelStatus
        stickyTop="112px"
        state={{
          activeCategory: "models",
          activeCategoryConfig: { label: "AI Models" },
          activeDirty: true,
          activeSaving: false,
          error: null,
          saveMessage: null,
          loading: false,
          resettingProject: false,
        } as any}
      />
    );

    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
    expect(screen.getByRole("status")).toHaveTextContent("AI Models settings have local unsaved changes.");
    expect(screen.getByText("AI Models")).toBeInTheDocument();
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    const activePanelStrip = screen.getByText("Active panel").parentElement;
    expect(activePanelStrip).toHaveAttribute("data-settings-sticky", "active-panel");
    expect(activePanelStrip).toHaveClass("sticky", "top-[var(--settings-active-panel-top)]", "flex-wrap", "overflow-visible");
    expect(activePanelStrip).toHaveStyle("--settings-active-panel-top: 112px");
  });

  it("SettingsActivePanelStatus can render inline without duplicating status logic", () => {
    render(
      <SettingsActivePanelStatus
        sticky={false}
        state={{
          activeCategory: "general",
          activeDirty: false,
          activeSaving: false,
          error: "Save failed",
          saveMessage: null,
          loading: false,
          resettingProject: false,
        } as any}
      />
    );

    expect(screen.getByRole("alert")).toHaveAttribute("aria-live", "assertive");
    expect(screen.getByRole("alert")).toHaveTextContent("General settings blocked: Save failed");
    expect(screen.getByText("Blocked")).toBeInTheDocument();
    const activePanelStrip = screen.getByText("Active panel").parentElement;
    expect(activePanelStrip).not.toHaveAttribute("data-settings-sticky");
    expect(activePanelStrip).not.toHaveClass("sticky", "top-[var(--settings-active-panel-top)]");
    expect(activePanelStrip).not.toHaveStyle("--settings-active-panel-top: 9.5rem");
  });

  it("SettingsContentPanels renders its standalone sticky active-panel strip while keeping values mounted", async () => {
    const { rerender } = render(
      <SettingsContentPanels
        state={{
          activeCategory: "general",
          activeDirty: true,
          activeSaving: false,
          error: null,
          saveMessage: null,
          loading: false,
        } as any}
      />
    );

    expect(screen.getByText("You have unsaved changes in this settings scope.")).toBeInTheDocument();
    expect(screen.getByText("General panel values stay mounted")).toBeInTheDocument();
    expect(screen.getByText("General")).toBeInTheDocument();
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    const activePanelStrip = screen.getByText("Active panel").parentElement;
    expect(activePanelStrip).toHaveAttribute("data-settings-sticky", "active-panel");
    expect(activePanelStrip).toHaveClass("sticky", "top-[var(--settings-active-panel-top)]", "flex-wrap", "overflow-visible");
    expect(activePanelStrip).toHaveStyle("--settings-active-panel-top: 9.5rem");
    const panelStatus = screen.getByText("General settings have local unsaved changes.");
    expect(panelStatus).toHaveAttribute("role", "status");
    expect(panelStatus).toHaveAttribute("aria-live", "polite");
    expect(screen.getByText("General panel values stay mounted").parentElement).toHaveAttribute("data-motion-contract", "enterExit");
    expect(screen.getByText("General panel values stay mounted").parentElement).toHaveClass("motion-reduce:animate-none");

    rerender(
      <SettingsContentPanels
        state={{
          activeCategory: "general",
          activeDirty: true,
          activeSaving: true,
          error: null,
          saveMessage: null,
          loading: false,
          resettingProject: false,
        } as any}
      />
    );
    await waitFor(() => expect(screen.getByText("Saving settings. Current values remain visible.")).toBeInTheDocument());
    expect(screen.getByText("Saving")).toBeInTheDocument();
    expect(screen.getByText("General panel values stay mounted")).toBeInTheDocument();

    rerender(
      <SettingsContentPanels
        state={{
          activeCategory: "general",
          activeDirty: false,
          activeSaving: false,
          error: null,
          saveMessage: "Settings saved.",
          loading: false,
          resettingProject: false,
        } as any}
      />
    );
    await waitFor(() => expect(screen.getAllByText("Settings saved.").length).toBeGreaterThan(0));
    expect(screen.getByText("Saved")).toBeInTheDocument();
    expect(screen.getByText("General panel values stay mounted")).toBeInTheDocument();
  });

  it("SettingsContentPanels can suppress the active panel strip for a shared command/status bar", () => {
    render(
      <SettingsContentPanels
        showActivePanelStatus={false}
        state={{
          activeCategory: "general",
          activeDirty: false,
          activeSaving: false,
          error: null,
          saveMessage: null,
          loading: false,
          resettingProject: false,
        } as any}
      />
    );

    expect(screen.queryByText("Active panel")).not.toBeInTheDocument();
    expect(screen.getByText("General panel values stay mounted")).toBeInTheDocument();
  });

  it("SettingsContentPanels routes the Techstacks category to the catalog panel", () => {
    const projectSettings = createProjectSettings();
    render(
      <SettingsContentPanels
        state={{
          activeCategory: "techstacks",
          activeScope: "system",
          activeDirty: false,
          activeSaving: false,
          error: null,
          saveMessage: null,
          loading: false,
          resettingProject: false,
          systemSettings: createSystemSettings(projectSettings),
          updateSystem: () => {},
        } as any}
      />
    );

    expect(screen.getByText("Techstacks Catalog")).toBeInTheDocument();
    expect(screen.getAllByText("Code UX Stack").length).toBeGreaterThan(0);
  });

  it("SettingsTechstacksPanel protects the built-in Code UX Stack from removal", () => {
    const projectSettings = createProjectSettings();
    render(
      <SettingsTechstacksPanel
        state={{
          activeScope: "system",
          activeSaving: false,
          systemSettings: createSystemSettings(projectSettings),
          updateSystem: () => {},
        } as any}
      />
    );

    expect(screen.getByText("Built-in stack protected")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove Code UX Stack" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove Custom Web" })).toBeInTheDocument();
  });

  it("SettingsTechstacksPanel lets project scope clear the selected stack to Unassigned", async () => {
    const user = userEvent.setup();
    let latestProjectSettings = createProjectSettings({
      selectedTechstackId: "custom-web",
      applicationKind: "web",
    });
    const systemSettings = createSystemSettings(latestProjectSettings);

    const Harness = () => {
      const [projectSettings, setProjectSettings] = useState(latestProjectSettings);
      latestProjectSettings = projectSettings;
      return (
        <SettingsTechstacksPanel
          state={{
            activeScope: "project",
            activeSaving: false,
            projectSources: {},
            selectedProject: { id: "project-1", name: "Test project" },
            projectSettings,
            systemSettings,
            updateEditableSettings: (recipe: (current: ProjectSettings) => ProjectSettings) => setProjectSettings(recipe),
            getFieldReset: () => undefined,
          } as any}
        />
      );
    };

    render(<Harness />);

    await user.click(screen.getByRole("radio", { name: /Unassigned/ }));

    expect(latestProjectSettings.techstack.selectedTechstackId).toBeNull();
  });

  it("SettingsTechstacksPanel persists project stack and application kind through editable settings helpers", async () => {
    const user = userEvent.setup();
    let latestProjectSettings = createProjectSettings({
      selectedTechstackId: null,
      applicationKind: null,
    });
    const systemSettings = createSystemSettings(latestProjectSettings);

    const Harness = () => {
      const [projectSettings, setProjectSettings] = useState(latestProjectSettings);
      latestProjectSettings = projectSettings;
      return (
        <SettingsTechstacksPanel
          state={{
            activeScope: "project",
            activeSaving: false,
            projectSources: {},
            selectedProject: { id: "project-1", name: "Test project" },
            projectSettings,
            systemSettings,
            updateEditableSettings: (recipe: (current: ProjectSettings) => ProjectSettings) => setProjectSettings(recipe),
            getFieldReset: () => undefined,
          } as any}
        />
      );
    };

    render(<Harness />);

    await user.click(screen.getByRole("radio", { name: /Custom Web/ }));
    await user.click(screen.getByRole("radio", { name: /Web app/ }));

    expect(latestProjectSettings.techstack).toEqual({
      selectedTechstackId: "custom-web",
      applicationKind: "web",
    });
  });

  it("SettingsPage keeps scope controls and active panel status in one unified sticky wrapping bar", () => {
    const source = readFileSync("dashboard/src/v2/SettingsPage.tsx", "utf8");
    const commandStatusBarSource = source.match(
      /<div\s+data-settings-sticky="settings-command-status"[\s\S]*?<SettingsCategoryRail/,
    )?.[0] ?? "";

    expect(source).toContain('import { SettingsScopeControls } from "./components/settings/SettingsScopeControls.js";');
    expect(source).toContain('import { SettingsActivePanelStatus } from "./components/settings/SettingsActivePanelStatus.js";');
    expect(source).toContain('data-settings-sticky="settings-command-status"');
    expect(commandStatusBarSource).toContain("sticky top-16 z-30");
    expect(commandStatusBarSource).toContain("flex min-w-0 max-w-full flex-wrap");
    expect(commandStatusBarSource).toContain("<SettingsScopeControls");
    expect(commandStatusBarSource).toContain("<SettingsActivePanelStatus");
    expect(commandStatusBarSource).toContain("sticky={false}");
    expect(commandStatusBarSource).not.toContain("rounded-[");
    expect(commandStatusBarSource).not.toContain("bg-[var(--surface-glass)]");
    expect(source.match(/<SettingsContentPanels/g) ?? []).toHaveLength(1);
    expect(source).toMatch(/<SettingsContentPanels\s+state=\{state\}\s+showActivePanelStatus=\{false\}\s+\/>/);
    expect(source).not.toContain("scopeSticky.getBoundingClientRect()");
    expect(source).not.toContain("panelStickyTop");
  });

  it("SettingsContentPanels renders reset pending feedback while keeping values mounted", () => {
    render(
      <SettingsContentPanels
        state={{
          activeCategory: "general",
          activeDirty: false,
          activeSaving: false,
          error: null,
          saveMessage: null,
          loading: false,
          resettingProject: true,
        } as any}
      />
    );

    expect(screen.getByText("Resetting project overrides. Current values remain visible.")).toBeInTheDocument();
    expect(screen.getByText("General panel values stay mounted")).toBeInTheDocument();
  });

  it("ProviderInstanceCard confirms target-specific removal, suppresses duplicate confirms, and restores fallback focus", async () => {
    const user = userEvent.setup();
    const fallback = document.createElement("div");
    fallback.id = "settings-active-category-panel";
    document.body.append(fallback);
    const onRemove = vi.fn(() => new Promise<void>((resolve) => window.setTimeout(resolve, 10)));

    render(
      <ProviderInstanceCard
        providerConfigId="codex"
        provider={{
          provider: "codex",
          name: "Codex Primary",
          apiKey: "",
          authType: "apiKey",
          mountAuth: false,
          authPath: "",
        } as any}
        providerModel="gpt-5"
        dockerExecutionEnabled
        onUpdate={() => {}}
        onRemove={onRemove}
      />
    );

    await user.click(screen.getByRole("button", { name: "Remove Codex Primary" }));
    const confirmButton = screen.getByRole("button", { name: "Confirm remove Codex Primary" });
    await user.click(confirmButton);
    await user.click(confirmButton);

    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(confirmButton).toHaveAttribute("aria-busy", "true");
    await waitFor(() => expect(document.activeElement).toBe(fallback));
    fallback.remove();
  });
});
