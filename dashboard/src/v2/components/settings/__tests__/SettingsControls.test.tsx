/**
 * @vitest-environment jsdom
 */
import { h } from "preact";
import { readFileSync } from "node:fs";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/preact";
import "@testing-library/jest-dom/vitest";
import { BranchNameSchemeEditor } from "../BranchNameSchemeEditor";
import { SprintKeyEditor } from "../SprintKeyEditor";
import { TextInput, SecretInput, NumberInput, TextAreaInput, PillChoiceGroup, SelectInput } from "../SettingsFormFields";


import { SettingsCategoryRail } from "../SettingsCategoryRail";
import { ActionButton, NoticePanel } from "../SettingsSurface";
import { OverrideBadge } from "../panels/SharedPanelComponents";
import { SlidersHorizontal } from "lucide-preact";
import type { SettingsSearchMatches } from "../../../lib/settings-search-index";
import userEvent from "@testing-library/user-event";
import { SettingsActivePanelStatus } from "../SettingsActivePanelStatus";
import { SettingsContentPanels } from "../SettingsContentPanels";
import { UnsavedChangesModal } from "../../ui/UnsavedChangesModal";
import { ProviderInstanceCard } from "../ProviderInstanceCard";

const defaultInnerHeight = window.innerHeight;

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(window, "innerHeight", { configurable: true, value: defaultInnerHeight });
  cleanup();
});

vi.mock("../panels/SettingsGeneralPanel", () => ({
  SettingsGeneralPanel: () => <div>General panel values stay mounted</div>,
}));

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

  it("SettingsContentPanels renders dirty-to-saving-to-saved feedback while keeping values mounted", async () => {
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

  it("SettingsContentPanels accepts the measured sticky offset from the settings scope strip", () => {
    render(
      <SettingsContentPanels
        stickyTop="148px"
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

    expect(screen.getByText("Active panel").parentElement).toHaveStyle("--settings-active-panel-top: 148px");
  });

  it("SettingsPage keeps the scope controls in a sticky wrapping strip and passes its measured offset to the panel strip", () => {
    const source = readFileSync("dashboard/src/v2/SettingsPage.tsx", "utf8");

    expect(source).toContain('data-settings-sticky="scope"');
    expect(source).toContain("sticky top-16 z-30");
    expect(source).toContain("flex min-w-0 flex-wrap");
    expect(source).toContain("scopeSticky.getBoundingClientRect().height + appShellOffset + stickyGap");
    expect(source).toContain("<SettingsContentPanels state={state} stickyTop={panelStickyTop} />");
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
