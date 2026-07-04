/**
 * @vitest-environment jsdom
 */
import { h } from "preact";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/preact";
import "@testing-library/jest-dom/vitest";
import { BranchNameSchemeEditor } from "../BranchNameSchemeEditor";
import { SprintKeyEditor } from "../SprintKeyEditor";
import { TextInput, SecretInput, NumberInput, TextAreaInput, PillChoiceGroup } from "../SettingsFormFields";


import { SettingsCategoryRail } from "../SettingsCategoryRail";
import { ActionButton, NoticePanel } from "../SettingsSurface";
import { OverrideBadge } from "../panels/SharedPanelComponents";
import { SlidersHorizontal } from "lucide-preact";
import type { SettingsSearchMatches } from "../../../lib/settings-search-index";
import userEvent from "@testing-library/user-event";
import { SettingsContentPanels } from "../SettingsContentPanels";
import { UnsavedChangesModal } from "../../ui/UnsavedChangesModal";

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

    expect(screen.getByText("Showing 1 categories for \"claude\".")).toBeInTheDocument();
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

  it("SettingsCategoryRail exposes pending and disabled category states with visible labels", () => {
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
    expect(btn).toHaveAttribute("aria-busy", "true");
    expect(btn).toBeDisabled();
    expect(screen.getByText("Selected")).toBeInTheDocument();
    expect(screen.getByText("Pending")).toBeInTheDocument();
    expect(screen.getByText("Disabled")).toBeInTheDocument();
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
  afterEach(() => {
    cleanup();
  });

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

    await user.click(screen.getByRole("button", { name: "Show secret" }));
    expect(input).toHaveAttribute("type", "text");
    expect(screen.getByRole("button", { name: "Hide secret" })).toHaveAttribute("aria-pressed", "true");
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
    await waitFor(() => expect(screen.getByText("Settings saved.")).toBeInTheDocument());
    expect(screen.getByText("General panel values stay mounted")).toBeInTheDocument();
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
});
