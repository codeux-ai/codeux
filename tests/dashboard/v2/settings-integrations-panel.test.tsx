/** @vitest-environment jsdom */
/** @vitest-environment happy-dom */
/** @jsx h */
/** @jsxFrag Fragment */
import { h, Fragment, type ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { describe, expect, it, vi, afterEach } from "vitest";
import { render as testingLibraryRender, waitFor, screen, fireEvent, cleanup, within } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import { SettingsIntegrationsPanel } from "../../../dashboard/src/v2/components/settings/panels/SettingsIntegrationsPanel.js";
import { fetchLocalFiles } from "../../../dashboard/src/v2/lib/project-api.js";
import { fetchAutomationCredentials, fetchCredentialHealth } from "../../../dashboard/src/v2/lib/automation-credential-api.js";
import { DashboardI18nProvider } from "../../../dashboard/src/v2/i18n/context.js";
import type { DashboardLocale } from "../../../dashboard/src/v2/i18n/locales.js";

const render = (children: ComponentChildren, locale: DashboardLocale = "en") => testingLibraryRender(children, {
  wrapper: ({ children: wrappedChildren }) => (
    <DashboardI18nProvider initialLocale={locale} storage={null}>{wrappedChildren}</DashboardI18nProvider>
  ),
});

vi.mock("../../../dashboard/src/v2/lib/project-api.js", () => ({
  fetchLocalFiles: vi.fn(),
}));

vi.mock("../../../dashboard/src/v2/lib/automation-credential-api.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../dashboard/src/v2/lib/automation-credential-api.js")>();
  return {
    ...actual,
    fetchAutomationCredentials: vi.fn(),
    fetchCredentialHealth: vi.fn(),
  };
});

vi.mock("gsap", () => {
  const applyStyles = (target: unknown, props: Record<string, unknown>) => {
    if (!(target instanceof HTMLElement)) return;
    for (const [key, value] of Object.entries(props)) {
      (target.style as CSSStyleDeclaration & Record<string, string>)[key] = String(value);
    }
  };

  return {
    default: {
      context: vi.fn((callback: () => void) => {
        callback();
        return { revert: vi.fn() };
      }),
      set: vi.fn((target: unknown, props: Record<string, unknown>) => applyStyles(target, props)),
      to: vi.fn((target: unknown, props: Record<string, unknown>) => applyStyles(target, props)),
      fromTo: vi.fn((target: unknown, _from: Record<string, unknown>, to: Record<string, unknown>) => applyStyles(target, to)),
      timeline: vi.fn(() => {
        const timeline = {
          to: (target: unknown, props: Record<string, unknown>) => {
            applyStyles(target, props);
            if (typeof props.onComplete === "function") {
              props.onComplete();
            }
            return timeline;
          },
        };
        return timeline;
      }),
    },
  };
});

describe("SettingsIntegrationsPanel", () => {
  afterEach(() => {
    cleanup();
  });

  const createImporterSettings = (overrides: Record<string, unknown> = {}) => ({
    enabled: false,
    apiToken: "",
    apiSecret: "",
    baseUrl: "",
    workspaceId: "",
    teamId: "",
    teamKey: "",
    projectId: "",
    databaseId: "",
    boardId: "",
    documentId: "",
    fileKey: "",
    defaultSearchLimit: 25,
    ...overrides,
  });

  const importerIntegrations = [
    { id: "notion", label: "Notion", description: "Read-only import from Notion workspace pages and databases" },
    { id: "asana", label: "Asana", description: "Read-only import from Asana workspaces, teams, and projects" },
    { id: "linear", label: "Linear", description: "Read-only import from Linear teams, projects, and issues" },
    { id: "miro", label: "Miro", description: "Read-only import from Miro teams and boards" },
    { id: "lucid", label: "Lucid", description: "Read-only import from Lucid or Lucidspark documents" },
    { id: "figma", label: "Figma / FigJam", description: "Read-only import from Figma files and FigJam boards" },
    { id: "mural", label: "Mural", description: "Read-only import from Mural workspaces and murals" },
  ];

  const createImporterState = (overrides: Record<string, unknown> = {}) => ({
    activeScope: "system",
    selectedProject: null,
    editableSettings: {
      cliWorkflow: {
        executionMode: "DOCKER",
        containerMountGithubAuth: false,
        containerGithubAuthPath: "~/.config/gh",
        containerMountGitConfig: true,
      },
      git: {
        githubMode: "REMOTE",
        defaultBranch: "main",
        featureBranchPrefix: "feature/",
        sprintBranchScheme: "feature/sprint{sprint}",
        autoCreatePr: true,
      },
    },
    systemSettings: {
      integrations: {
        providers: {},
        githubToken: "",
        gitlabToken: "",
        jira: {
          host: "",
          email: "",
          apiToken: "",
          autoTransitionLinkedIssuesOnImport: true,
          importTransitionName: "In Work",
          autoCloseLinkedIssues: false,
          defaultProject: "",
          closeTransitionName: "Done",
        },
        notion: createImporterSettings(),
        asana: createImporterSettings(),
        linear: createImporterSettings(),
        miro: createImporterSettings(),
        lucid: createImporterSettings(),
        figma: createImporterSettings(),
        mural: createImporterSettings(),
      },
    },
    projectSources: {},
    selectedIntegration: null,
    setSelectedIntegration: vi.fn(),
    integrations: importerIntegrations,
    importingHints: false,
    externalHints: { resolved: {} },
    handleImportHints: vi.fn(),
    updateEditableSettings: vi.fn(),
    updateSystem: vi.fn(),
    updateProject: vi.fn(),
    ...overrides,
  });

  const createGoogleDriveState = (overrides: Record<string, unknown> = {}) => ({
    activeScope: "system",
    selectedProject: null,
    editableSettings: {
      cliWorkflow: { executionMode: "DOCKER" },
      googleDrive: { enabled: false, hostPath: "", accessMode: "read-only" },
    },
    systemSettings: {
      integrations: { providers: {}, githubToken: "", gitlabToken: "" },
      defaults: {
        googleDrive: { enabled: false, hostPath: "", accessMode: "read-only" },
      },
    },
    projectSources: {},
    selectedIntegration: null,
    setSelectedIntegration: vi.fn(),
    integrations: [{
      id: "google-drive",
      label: "Google Drive",
      description: "Mount an already linked local Drive directory into Docker workspaces",
    }],
    importingHints: false,
    externalHints: { resolved: {} },
    handleImportHints: vi.fn(),
    updateEditableSettings: vi.fn(),
    updateSystem: vi.fn(),
    updateProject: vi.fn(),
    ...overrides,
  });

  it("places automation credentials first and supports keyboard Manage, back navigation, and focus restoration", async () => {
    const user = userEvent.setup();
    vi.mocked(fetchAutomationCredentials).mockResolvedValue([]);
    vi.mocked(fetchCredentialHealth).mockResolvedValue({
      available: true,
      secure: true,
      provider: "local-file",
      keyId: "root",
      keyVersion: 1,
    });

    const Harness = () => {
      const [selectedIntegration, setSelectedIntegration] = useState<"automation-credentials" | "github" | null>(null);
      return (
        <SettingsIntegrationsPanel state={{
          activeScope: "project",
          selectedProject: { id: "project-1", name: "Selected project" },
          projects: [{ id: "project-1", name: "Selected project" }],
          editableSettings: {
            cliWorkflow: { executionMode: "DOCKER" },
            git: { githubMode: "REMOTE" },
          },
          systemSettings: {
            integrations: { providers: {}, githubToken: "", gitlabToken: "" },
          },
          projectSources: {},
          selectedIntegration,
          setSelectedIntegration,
          integrations: [
            { id: "automation-credentials", label: "Automation Credentials", description: "Write-only project automation secrets" },
            { id: "github", label: "GitHub", description: "Git provider" },
          ],
          importingHints: false,
          externalHints: { resolved: {} },
          handleImportHints: vi.fn(),
          updateEditableSettings: vi.fn(),
          updateSystem: vi.fn(),
          updateProject: vi.fn(),
        } as any} />
      );
    };

    const { container } = render(<Harness />);
    const card = await waitFor(() => container.querySelector('[data-integration-card="automation-credentials"]') as HTMLElement);
    expect(container.textContent?.indexOf("Automation Credentials")).toBeLessThan(container.textContent?.indexOf("GitHub") ?? -1);
    expect(within(card).getByText("Ready · not configured")).toBeTruthy();
    expect(screen.queryByText("Automation credential management")).toBeNull();

    const manageButton = within(card).getByRole("button", { name: "Manage" });
    manageButton.focus();
    await user.keyboard("{Enter}");
    expect(await screen.findByText("Automation credential management")).toBeTruthy();
    const backButton = screen.getByRole("button", { name: "Back to Integrations" });
    await waitFor(() => expect(document.activeElement).toBe(backButton));

    await user.keyboard("{Enter}");
    await waitFor(() => expect(screen.queryByText("Automation credential management")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(manageButton));
  });

  it("keeps the selected integration detail in flow so long forms are not clipped", async () => {
    const state = {
      activeScope: "system",
      selectedProject: null,
      editableSettings: {
        cliWorkflow: {
          executionMode: "DOCKER",
          containerMountGithubAuth: false,
          containerMountGeminiAuth: false,
          containerMountCodexAuth: false,
          containerMountClaudeCodeAuth: false,
          containerGithubAuthPath: "~/.config/gh",
          containerGeminiAuthPath: "~/.gemini",
          containerCodexAuthPath: "~/.codex",
          containerClaudeCodeAuthPath: "~/.claude",
        },
        git: {
          githubMode: "REMOTE",
          defaultBranch: "main",
          featureBranchPrefix: "feature/",
          sprintBranchScheme: "feature/sprint{sprint}",
          autoCreatePr: true,
        },
      },
      systemSettings: {
        integrations: {
          providers: {
            jules: { provider: "jules", name: "Jules Primary", apiKey: "", mountAuth: false, authPath: "" },
            gemini: { provider: "gemini", name: "Gemini Primary", apiKey: "", mountAuth: false, authPath: "~/.gemini" },
            codex: { provider: "codex", name: "Codex Primary", apiKey: "", mountAuth: false, authPath: "~/.codex" },
            "claude-code": { provider: "claude-code", name: "Claude Primary", apiKey: "", mountAuth: false, authPath: "~/.claude" },
          },
          githubToken: "",
          gitlabToken: "",
        },
      },
      projectSources: {},
      selectedIntegration: "github",
      setSelectedIntegration: vi.fn(),
      integrations: [
        { id: "github", label: "GitHub", description: "Git provider" },
      ],
      importingHints: false,
      externalHints: {
        resolved: {
          julesApiKey: "",
          geminiApiKey: "",
          codexApiKey: "",
          claudeCodeApiKey: "",
          githubToken: "",
          gitlabToken: "",
        },
      },
      handleImportHints: vi.fn(),
      updateEditableSettings: vi.fn(),
      updateSystem: vi.fn(),
    } as any;

    const { container } = render(<SettingsIntegrationsPanel state={state} />);

    await waitFor(() => {
      expect(container.textContent).toContain("GitHub Configuration");
    });

    const panelRoot = container.querySelector(".flex.flex-col.gap-5") as HTMLElement;
    const slideContainer = panelRoot.querySelector(".relative.overflow-hidden.w-full") as HTMLElement;
    const [listPane, detailPane] = Array.from(slideContainer.children) as HTMLElement[];

    expect(listPane.style.display).toBe("none");
    expect(detailPane.style.display).toBe("block");
    expect(detailPane.style.position).toBe("relative");
  });

  it("renders integration purpose groups without the old catalog infobox", async () => {
    const state = {
      activeScope: "system",
      selectedProject: null,
      editableSettings: {
        cliWorkflow: {
          executionMode: "DOCKER",
          containerMountGithubAuth: false,
          containerGithubAuthPath: "~/.config/gh",
          containerMountGitConfig: false,
          containerGitUserName: "Code UX",
          containerGitUserEmail: "agents@codeux.ai",
        },
        git: {
          githubMode: "REMOTE",
          defaultBranch: "main",
          featureBranchPrefix: "feature/",
          sprintBranchScheme: "feature/sprint{sprint}",
          autoCreatePr: true,
        },
      },
      systemSettings: {
        integrations: {
          providers: {},
          githubToken: "",
          gitlabToken: "",
        },
      },
      projectSources: {},
      selectedIntegration: null,
      setSelectedIntegration: vi.fn(),
      integrations: [
        { id: "codex", label: "Codex", description: "CLI provider" },
        { id: "github", label: "GitHub", description: "Git provider" },
        { id: "jira", label: "Jira", description: "Issue tracker" },
      ],
      importingHints: false,
      externalHints: {
        resolved: {
          julesApiKey: "",
          geminiApiKey: "",
          codexApiKey: "",
          claudeCodeApiKey: "",
          githubToken: "",
          gitlabToken: "",
        },
      },
      handleImportHints: vi.fn(),
      updateEditableSettings: vi.fn(),
      updateSystem: vi.fn(),
    } as any;

    const { container } = render(<SettingsIntegrationsPanel state={state} />);

    await waitFor(() => {
      expect(container.textContent).toContain("CLI");
    });
    expect(container.textContent).toContain("GIT");
    expect(container.textContent).toContain("PM");
    expect(container.textContent).toContain("Import host hints");
    expect(container.textContent).not.toContain("Integration catalog");
    expect(container.textContent).not.toContain("Provider credentials and source-control auth in one place");
  });

  it("groups importer providers into PM and canvas catalog sections with status pills", async () => {
    const state = createImporterState({
      systemSettings: {
        integrations: {
          providers: {},
          githubToken: "",
          gitlabToken: "",
          jira: {
            host: "",
            email: "",
            apiToken: "",
            autoTransitionLinkedIssuesOnImport: true,
            importTransitionName: "In Work",
            autoCloseLinkedIssues: false,
            defaultProject: "",
            closeTransitionName: "Done",
          },
          notion: createImporterSettings({ enabled: true, apiToken: "token", databaseId: "database-id" }),
          asana: createImporterSettings(),
          linear: createImporterSettings(),
          miro: createImporterSettings(),
          lucid: createImporterSettings(),
          figma: createImporterSettings({ enabled: true, apiToken: "token" }),
          mural: createImporterSettings(),
        },
      },
      integrations: [
        { id: "jira", label: "Jira", description: "Issue tracker" },
        ...importerIntegrations,
      ],
    });

    const { container } = render(<SettingsIntegrationsPanel state={state as any} />);

    await waitFor(() => {
      expect(container.textContent).toContain("PM");
    });
    expect(container.textContent).toContain("CANVAS");
    expect(container.textContent).toContain("Notion");
    expect(container.textContent).toContain("Figma / FigJam");
    expect(container.textContent).toContain("Read-only import");
    expect(container.textContent).toContain("Active");
    expect(container.textContent).toContain("Configured");
    expect(container.textContent).toContain("Not configured");
  });

  it("renders system-owned Jira configuration controls", async () => {
    const state = {
      activeScope: "system",
      selectedProject: null,
      editableSettings: {
        cliWorkflow: {
          executionMode: "DOCKER",
          containerMountGithubAuth: false,
          containerGithubAuthPath: "~/.config/gh",
          containerMountGitConfig: true,
        },
        git: {
          githubMode: "REMOTE",
          defaultBranch: "main",
          featureBranchPrefix: "feature/",
          sprintBranchScheme: "feature/sprint{sprint}",
          autoCreatePr: true,
        },
      },
      systemSettings: {
        integrations: {
          providers: {},
          githubToken: "",
          gitlabToken: "",
          jira: {
            host: "https://acme.atlassian.net",
            email: "ops@acme.test",
            apiToken: "jira-token",
            autoTransitionLinkedIssuesOnImport: true,
            importTransitionName: "In Work",
            autoCloseLinkedIssues: true,
            defaultProject: "OPS",
            closeTransitionName: "Done",
          },
        },
      },
      projectSources: {},
      selectedIntegration: "jira",
      setSelectedIntegration: vi.fn(),
      integrations: [
        { id: "jira", label: "Jira", description: "Issue tracker" },
      ],
      importingHints: false,
      externalHints: {
        resolved: {
          julesApiKey: "",
          geminiApiKey: "",
          codexApiKey: "",
          claudeCodeApiKey: "",
          githubToken: "",
          gitlabToken: "",
          jiraToken: "",
        },
      },
      handleImportHints: vi.fn(),
      updateEditableSettings: vi.fn(),
      updateSystem: vi.fn(),
    } as any;

    const { container } = render(<SettingsIntegrationsPanel state={state} />);

    await waitFor(() => {
      expect(container.textContent).toContain("Jira Configuration");
    });

    expect(container.textContent).toContain("Jira site URL");
    expect(container.textContent).toContain("Default project");
    expect(container.textContent).toContain("Import transition");
    expect(container.textContent).toContain("Move Jira issues on import");
    expect(container.textContent).toContain("Auto-close Jira issues");
    const inputValues = Array.from(container.querySelectorAll("input")).map((input) => input.value);
    expect(inputValues).toContain("https://acme.atlassian.net");
    expect(inputValues).toContain("In Work");
    expect(inputValues).toContain("OPS");
  });

  it("renders Jules-specific automation controls on the Jules integration page", async () => {
    let updatedSettings: any = null;
    const editableSettings = {
      cliWorkflow: {
        executionMode: "DOCKER",
        containerMountGithubAuth: false,
        containerGithubAuthPath: "~/.config/gh",
        containerMountGitConfig: true,
      },
      git: {
        githubMode: "REMOTE",
        defaultBranch: "main",
        featureBranchPrefix: "feature/",
        sprintBranchScheme: "feature/sprint{sprint}",
        autoCreatePr: true,
      },
      automationInterventions: {
        autoApprovePlan: true,
        autoAnswerClarification: true,
        autoAnswerClarificationMode: "TEMPLATE",
        clarificationAnswerTemplate: "Use the project manager template.",
        autoResumePaused: true,
      },
      ciIntelligence: {
        waitForJulesCiAutofix: false,
        julesCiAutofixMaxRetries: 3,
      },
    };
    const state = {
      activeScope: "project",
      selectedProject: { id: "project-1", name: "Project" },
      editableSettings,
      systemSettings: {
        integrations: {
          providers: {
            jules: { provider: "jules", name: "Jules Primary", apiKey: "", mountAuth: false, authPath: "" },
          },
          githubToken: "",
          gitlabToken: "",
        },
        defaults: {
          aiProvider: {
            provider: "jules",
            providers: {
              jules: { provider: "jules", name: "Jules Primary", model: "" },
            },
            invocationRouting: {},
          },
          workers: {
            virtualWorkerProvider: "jules",
          },
        },
      },
      projectSources: {
        "automationInterventions.autoAnswerClarification": "project",
        "automationInterventions.autoAnswerClarificationMode": "project",
        "ciIntelligence.waitForJulesCiAutofix": "project",
      },
      selectedIntegration: "jules",
      setSelectedIntegration: vi.fn(),
      integrations: [
        { id: "jules", label: "Jules", description: "Hosted provider" },
      ],
      importingHints: false,
      externalHints: {
        resolved: {
          julesApiKey: "",
          githubToken: "",
          gitlabToken: "",
        },
      },
      handleImportHints: vi.fn(),
      updateEditableSettings: vi.fn((recipe) => {
        updatedSettings = recipe(editableSettings);
      }),
      updateSystem: vi.fn(),
      updateProject: vi.fn(),
    };

    const { container } = render(<SettingsIntegrationsPanel state={state as any} />);

    await waitFor(() => {
      expect(container.textContent).toContain("Jules Automation");
    });

    expect(container.textContent).toContain("Auto-answer clarifications");
    expect(container.textContent).toContain("Clarification answer mode");
    expect(container.textContent).toContain("Clarification answer template");
    expect(container.textContent).toContain("Jules CI autofix");
    expect(container.textContent).toContain("Jules CI autofix max retries");
    expect(container.textContent).toContain("Project override");
    expect(container.textContent).not.toContain("Jules Credentials");

    fireEvent.click(screen.getByRole("radio", { name: /Worker/i }));
    expect(updatedSettings.automationInterventions.autoAnswerClarificationMode).toBe("WORKER");

    const ciRow = screen.getByText("Jules CI autofix").closest(".group") as HTMLElement;
    fireEvent.click(within(ciRow).getByLabelText("Toggle setting"));
    expect(updatedSettings.ciIntelligence.waitForJulesCiAutofix).toBe(true);
  });

  it("shows editable git identity only when local git config copying is disabled", async () => {
    const baseState = {
      activeScope: "project",
      selectedProject: null,
      editableSettings: {
        cliWorkflow: {
          executionMode: "DOCKER",
          containerMountGithubAuth: false,
          containerGithubAuthPath: "~/.config/gh",
          containerMountGitConfig: false,
          containerGitUserName: "Code UX",
          containerGitUserEmail: "agents@codeux.ai",
        },
        git: {
          githubMode: "REMOTE",
          defaultBranch: "main",
          featureBranchPrefix: "feature/",
          sprintBranchScheme: "feature/sprint{sprint}",
          autoCreatePr: true,
        },
      },
      systemSettings: {
        integrations: {
          providers: {},
          githubToken: "",
          gitlabToken: "",
        },
      },
      projectSources: {},
      selectedIntegration: "github",
      setSelectedIntegration: vi.fn(),
      integrations: [
        { id: "github", label: "GitHub", description: "Git provider" },
      ],
      importingHints: false,
      externalHints: {
        resolved: {
          julesApiKey: "",
          geminiApiKey: "",
          codexApiKey: "",
          claudeCodeApiKey: "",
          githubToken: "",
          gitlabToken: "",
        },
      },
      handleImportHints: vi.fn(),
      updateEditableSettings: vi.fn(),
      updateSystem: vi.fn(),
    } as any;

    const { container, rerender } = render(<SettingsIntegrationsPanel state={baseState} />);

    await waitFor(() => {
      expect(container.textContent).toContain("Git user name");
    });
    expect(container.textContent).toContain("Git email");

    rerender(
      <SettingsIntegrationsPanel
        state={{
          ...baseState,
          editableSettings: {
            ...baseState.editableSettings,
            cliWorkflow: {
              ...baseState.editableSettings.cliWorkflow,
              containerMountGitConfig: true,
            },
          },
        }}
      />,
    );

    await waitFor(() => {
      expect(container.textContent).not.toContain("Git user name");
    });
    expect(container.textContent).not.toContain("Git email");
  });

  describe("External importer configuration", () => {
    const providerCases = [
      { id: "notion", label: "Notion", fieldLabel: "Database ID", fieldKey: "databaseId" },
      { id: "asana", label: "Asana", fieldLabel: "Workspace GID", fieldKey: "workspaceId" },
      { id: "linear", label: "Linear", fieldLabel: "Team key", fieldKey: "teamKey" },
      { id: "miro", label: "Miro", fieldLabel: "Board ID", fieldKey: "boardId" },
      { id: "lucid", label: "Lucid", fieldLabel: "Document ID", fieldKey: "documentId" },
      { id: "figma", label: "Figma / FigJam", fieldLabel: "File key", fieldKey: "fileKey" },
      { id: "mural", label: "Mural", fieldLabel: "Mural ID", fieldKey: "boardId" },
    ] as const;

    it("renders German importer chrome while preserving credential and identifier values", async () => {
      const state = createImporterState({
        selectedIntegration: "notion",
        integrations: [{ id: "notion", label: "Notion", description: "Read-only importer" }],
      });
      state.systemSettings.integrations.notion = createImporterSettings({
        enabled: true,
        apiToken: "credential-value-verbatim",
        databaseId: "database-id-verbatim",
      });

      render(<SettingsIntegrationsPanel state={state as any} />, "de");

      expect(await screen.findByText("Importer-Konfiguration")).toBeTruthy();
      expect(screen.getByText("Unterstützung für schreibgeschützte Importe")).toBeTruthy();
      expect(screen.getByText("Datenbank-ID")).toBeTruthy();
      expect((screen.getByLabelText("Notion API-Token") as HTMLInputElement).value).toBe("credential-value-verbatim");
      expect((screen.getByLabelText("Notion Datenbank-ID") as HTMLInputElement).value).toBe("database-id-verbatim");
    });

    it.each(providerCases)("edits %s importer credentials and defaults", async ({ id, label, fieldLabel, fieldKey }) => {
      let updatedSystem: any = null;
      const state = createImporterState({
        selectedIntegration: id,
        integrations: [{ id, label, description: "Read-only importer" }],
      });
      state.updateSystem = vi.fn((recipe) => {
        updatedSystem = recipe(state.systemSettings);
      });

      const { container } = render(<SettingsIntegrationsPanel state={state as any} />);

      await waitFor(() => {
        expect(container.textContent).toContain(`${label} Configuration`);
      });
      expect(container.textContent).toContain("Read-only importer support");

      fireEvent.click(screen.getByLabelText(`Enable ${label} importer`));
      expect(updatedSystem.integrations[id].enabled).toBe(true);

      fireEvent.input(screen.getByLabelText(`${label} API token`), { target: { value: "token-value" } });
      expect(updatedSystem.integrations[id].apiToken).toBe("token-value");

      fireEvent.input(screen.getByPlaceholderText("https://api.example.com"), { target: { value: "https://api.example.test" } });
      expect(updatedSystem.integrations[id].baseUrl).toBe("https://api.example.test");

      fireEvent.input(screen.getByLabelText(`${label} ${fieldLabel}`), { target: { value: "default-id" } });
      expect(updatedSystem.integrations[id][fieldKey]).toBe("default-id");

      fireEvent.input(screen.getByLabelText(`${label} search limit`), { target: { value: "50" } });
      expect(updatedSystem.integrations[id].defaultSearchLimit).toBe(50);
    });

    it("shows project override badges and writes importer project overrides", async () => {
      const editableSettings = {
        cliWorkflow: {
          executionMode: "DOCKER",
          containerMountGithubAuth: false,
          containerGithubAuthPath: "~/.config/gh",
          containerMountGitConfig: true,
        },
        git: {
          githubMode: "REMOTE",
          defaultBranch: "main",
          featureBranchPrefix: "feature/",
          sprintBranchScheme: "feature/sprint{sprint}",
          autoCreatePr: true,
        },
        asana: createImporterSettings({ enabled: true, apiToken: "project-token", workspaceId: "workspace" }),
      };
      let updatedProject: any = null;
      const state = createImporterState({
        activeScope: "project",
        selectedProject: { id: "project-1", name: "Project" },
        editableSettings,
        selectedIntegration: "asana",
        integrations: [{ id: "asana", label: "Asana", description: "Read-only importer" }],
        projectSources: {
          "asana.enabled": "project",
          "asana.apiToken": "project",
          "asana.workspaceId": "project",
        },
      });
      state.updateEditableSettings = vi.fn((recipe) => {
        updatedProject = recipe(editableSettings);
      });

      const { container } = render(<SettingsIntegrationsPanel state={state as any} />);

      await waitFor(() => {
        expect(container.textContent).toContain("Project-scope importer override");
      });
      expect(container.textContent).toContain("Project override");

      fireEvent.input(screen.getByLabelText("Asana API token"), { target: { value: "override-token" } });
      expect(updatedProject.asana.apiToken).toBe("override-token");
    });
  });

  describe("Provider authentication mode switching", () => {
    const createBaseState = (providerId: string, initialProviderConfig: any) => {
      const providerNames: Record<string, string> = {
        gemini: "Gemini Primary",
        codex: "Codex Primary",
        "claude-code": "Claude Primary",
        "qwen-code": "Qwen Primary",
        opencode: "OpenCode Primary",
      };
      const name = providerNames[providerId] || `${providerId} Primary`;
      return {
        activeScope: "system",
        selectedProject: null,
        editableSettings: {
          cliWorkflow: {
            executionMode: "DOCKER",
          },
        },
        systemSettings: {
          integrations: {
            providers: {
              [providerId]: {
                provider: providerId,
                name,
                ...initialProviderConfig,
              },
            },
            githubToken: "",
            gitlabToken: "",
          },
          defaults: {
            aiProvider: {
              provider: null,
              providers: {
                [providerId]: {
                  provider: providerId,
                  name,
                  model: "test-model",
                },
              },
              invocationRouting: {},
            },
            workers: {
              virtualWorkerProvider: providerId,
            },
          },
        },
        projectSources: {},
        selectedIntegration: providerId,
        setSelectedIntegration: vi.fn(),
        integrations: [
          { id: providerId, label: providerId, description: "Test provider" },
        ],
        importingHints: false,
        externalHints: {
          resolved: {},
        },
        handleImportHints: vi.fn(),
        updateEditableSettings: vi.fn(),
        updateSystem: vi.fn(),
      };
    };

    afterEach(() => {
      cleanup();
    });

    it("clears API key and sanitizes state when switching Gemini to Local Copy", async () => {
      const state = createBaseState("gemini", {
        apiKey: "gemini-api-key",
        authType: "apiKey",
        mountAuth: false,
        authPath: "",
      });

      let updatedSystem: any = null;
      state.updateSystem = vi.fn((fn) => {
        updatedSystem = fn(state.systemSettings);
      });

      const { container } = render(<SettingsIntegrationsPanel state={state as any} />);

      await waitFor(() => {
        expect(container.textContent).toContain("Gemini Primary");
      });

      const localCopyBtn = screen.getByRole("radio", { name: /Local Copy/i });
      fireEvent.click(localCopyBtn);

      expect(state.updateSystem).toHaveBeenCalled();
      expect(updatedSystem.integrations.providers.gemini.authType).toBe("localAuth");
      expect(updatedSystem.integrations.providers.gemini.mountAuth).toBe(true);
      expect(updatedSystem.integrations.providers.gemini.apiKey).toBe("");
      expect(screen.getAllByRole("status").some((status) => status.textContent?.includes("Gemini Primary authentication mode changed locally"))).toBe(true);
    });

    it("exposes dashboard login as a dialog-launching busy control when dashboard auth is selected", async () => {
      const state = createBaseState("codex", {
        apiKey: "",
        authType: "dashboardAuth",
        mountAuth: true,
        authPath: "~/.code-ux/credentials/codex",
      });

      const { container } = render(<SettingsIntegrationsPanel state={state as any} />);

      await waitFor(() => {
        expect(container.textContent).toContain("Dashboard Login");
      });

      const loginButton = screen.getByRole("button", { name: "Connect and log in to Codex Primary" });
      expect(loginButton.getAttribute("aria-haspopup")).toBe("dialog");
      expect(loginButton.getAttribute("aria-expanded")).toBe("false");
      expect(loginButton.getAttribute("aria-busy")).toBe("false");
    });

    it("clears API key and disables base URL / model fields when switching Codex to Local Copy", async () => {
      const state = createBaseState("codex", {
        apiKey: "codex-api-key",
        authType: "apiKey",
        mountAuth: false,
        authPath: "",
        customBaseUrl: "https://custom.endpoint",
        customModel: "custom-model-name",
      });

      let updatedSystem: any = null;
      state.updateSystem = vi.fn((fn) => {
        updatedSystem = fn(state.systemSettings);
      });

      const { container, rerender } = render(<SettingsIntegrationsPanel state={state as any} />);

      await waitFor(() => {
        expect(container.textContent).toContain("Codex Primary");
      });

      const localCopyBtn = screen.getByRole("radio", { name: /Local Copy/i });
      fireEvent.click(localCopyBtn);

      expect(state.updateSystem).toHaveBeenCalled();
      expect(updatedSystem.integrations.providers.codex.authType).toBe("localAuth");
      expect(updatedSystem.integrations.providers.codex.mountAuth).toBe(true);
      expect(updatedSystem.integrations.providers.codex.apiKey).toBe("");
      expect(updatedSystem.integrations.providers.codex.customBaseUrl).toBe("");
      expect(updatedSystem.integrations.providers.codex.customModel).toBe("");

      // Rerender with localAuth state to check disabled controls
      const stateLocal = createBaseState("codex", {
        apiKey: "",
        authType: "localAuth",
        mountAuth: true,
        authPath: "~/.codex",
        customBaseUrl: "",
        customModel: "",
      });

      rerender(<SettingsIntegrationsPanel state={stateLocal as any} />);
      const disabledReason = await screen.findByText(/Custom endpoint fields are disabled while local auth is selected/i);
      const providerPicker = screen.getByRole("button", { name: "Codex Primary API provider" });
      const baseUrlInput = screen.getByLabelText("Codex Primary Base URL");
      const modelPicker = screen.getByRole("button", { name: "Codex Primary Custom model" });
      expect(providerPicker.getAttribute("aria-describedby")).toContain(disabledReason.id);
      expect(baseUrlInput.getAttribute("aria-disabled")).toBe("true");
      expect(baseUrlInput.getAttribute("aria-describedby")).toContain(disabledReason.id);
      expect(modelPicker.getAttribute("aria-describedby")).toContain(disabledReason.id);
    });

    it("clears API key and disables base URL / model fields when switching Claude Code to Local Copy", async () => {
      const state = createBaseState("claude-code", {
        apiKey: "claude-api-key",
        authType: "apiKey",
        mountAuth: false,
        authPath: "",
        customBaseUrl: "https://custom.endpoint",
        customModel: "custom-model-name",
      });

      let updatedSystem: any = null;
      state.updateSystem = vi.fn((fn) => {
        updatedSystem = fn(state.systemSettings);
      });

      const { container } = render(<SettingsIntegrationsPanel state={state as any} />);

      await waitFor(() => {
        expect(container.textContent).toContain("Claude Primary");
      });

      const localCopyBtn = screen.getByRole("radio", { name: /Local Copy/i });
      fireEvent.click(localCopyBtn);

      expect(state.updateSystem).toHaveBeenCalled();
      const providerConfig = updatedSystem.integrations.providers["claude-code"];
      expect(providerConfig.authType).toBe("localAuth");
      expect(providerConfig.mountAuth).toBe(true);
      expect(providerConfig.apiKey).toBe("");
      expect(providerConfig.customBaseUrl).toBe("");
      expect(providerConfig.customModel).toBe("");
    });

    it("clears API key and updates qwenAuthMode when switching Qwen Code to Local Copy", async () => {
      const state = createBaseState("qwen-code", {
        apiKey: "qwen-api-key",
        authType: "apiKey",
        mountAuth: false,
        authPath: "",
        qwenAuthMode: "MODEL_PROVIDER",
      });

      let updatedSystem: any = null;
      state.updateSystem = vi.fn((fn) => {
        updatedSystem = fn(state.systemSettings);
      });

      const { container } = render(<SettingsIntegrationsPanel state={state as any} />);

      await waitFor(() => {
        expect(container.textContent).toContain("Qwen Primary");
      });

      const localCopyBtn = screen.getByRole("radio", { name: /Local Copy/i });
      fireEvent.click(localCopyBtn);

      expect(state.updateSystem).toHaveBeenCalled();
      const providerConfig = updatedSystem.integrations.providers["qwen-code"];
      expect(providerConfig.authType).toBe("localAuth");
      expect(providerConfig.mountAuth).toBe(true);
      expect(providerConfig.apiKey).toBe("");
      expect(providerConfig.qwenAuthMode).toBe("LOCAL_AUTH");
    });

    it("clears API key and updates openCodeAuthMode when switching OpenCode to Local Copy", async () => {
      const state = createBaseState("opencode", {
        apiKey: "opencode-api-key",
        authType: "apiKey",
        mountAuth: false,
        authPath: "",
        openCodeAuthMode: "ENV_KEY",
      });

      let updatedSystem: any = null;
      state.updateSystem = vi.fn((fn) => {
        updatedSystem = fn(state.systemSettings);
      });

      const { container } = render(<SettingsIntegrationsPanel state={state as any} />);

      await waitFor(() => {
        expect(container.textContent).toContain("OpenCode Primary");
      });

      const localCopyBtn = screen.getByRole("radio", { name: /Local Copy/i });
      fireEvent.click(localCopyBtn);

      expect(state.updateSystem).toHaveBeenCalled();
      const providerConfig = updatedSystem.integrations.providers.opencode;
      expect(providerConfig.authType).toBe("localAuth");
      expect(providerConfig.mountAuth).toBe(true);
      expect(providerConfig.apiKey).toBe("");
      expect(providerConfig.openCodeAuthMode).toBe("LOCAL_AUTH");
    });
  });

  describe("Google Drive mount", () => {
    it("groups the mount under storage and requires both enablement and a path for active status", async () => {
      const state = createGoogleDriveState({
        editableSettings: {
          cliWorkflow: { executionMode: "DOCKER" },
          googleDrive: { enabled: true, hostPath: "", accessMode: "read-only" },
        },
      });
      const { container, rerender } = render(<SettingsIntegrationsPanel state={state as any} />);

      await waitFor(() => expect(container.textContent).toContain("STORAGE & MOUNTS"));
      expect(container.textContent).toContain("Not configured");
      expect(container.textContent).not.toContain("Active");
      expect(container.textContent).not.toContain("/host/");

      rerender(<SettingsIntegrationsPanel state={{
        ...state,
        editableSettings: {
          ...state.editableSettings,
          googleDrive: { enabled: true, hostPath: "/host/Drive", accessMode: "read-only" },
        },
      } as any} />);

      await waitFor(() => expect(container.textContent).toContain("Configured"));
      expect(container.textContent).toContain("Active");
      expect(container.textContent).not.toContain("/host/Drive");
    });

    it("renders accessible system controls, browses a path, and updates the scoped draft", async () => {
      vi.mocked(fetchLocalFiles).mockResolvedValue({
        currentPath: "/host",
        parentPath: "/",
        homePath: "/home/test",
        directories: [],
        files: [{ name: "Drive", path: "/host/Drive", size: 0, modifiedAt: "" }],
      } as any);
      const editableSettings = {
        cliWorkflow: { executionMode: "DOCKER" },
        googleDrive: { enabled: false, hostPath: "", accessMode: "read-only" as const },
      };
      let draft: any = editableSettings;
      const state = createGoogleDriveState({
        selectedIntegration: "google-drive",
        editableSettings,
      });
      state.updateEditableSettings = vi.fn((recipe) => {
        draft = recipe(draft);
      });

      const { container } = render(<SettingsIntegrationsPanel state={state as any} />);
      await waitFor(() => expect(container.textContent).toContain("Google Drive Configuration"));

      expect(screen.getByLabelText("Enable Google Drive mount")).toBeTruthy();
      expect(screen.getByLabelText("Linked Drive directory")).toBeTruthy();
      const modeTrigger = screen.getByRole("button", { name: "Google Drive access mode" });
      expect(modeTrigger.textContent).toContain("Read-only (recommended)");
      expect(screen.getByText("/mnt/code-ux/google-drive", { selector: "code", exact: true })).toBeTruthy();
      expect(container.textContent).toContain("Docker runs only");

      fireEvent.click(screen.getByLabelText("Enable Google Drive mount"));
      expect(draft.googleDrive.enabled).toBe(true);

      fireEvent.input(screen.getByLabelText("Linked Drive directory"), { target: { value: "/typed/Drive" } });
      expect(draft.googleDrive.hostPath).toBe("/typed/Drive");

      fireEvent.click(screen.getByRole("button", { name: "Browse" }));
      await waitFor(() => expect(fetchLocalFiles).toHaveBeenCalled());
      fireEvent.click(await screen.findByRole("button", { name: "Drive" }));
      expect(draft.googleDrive.hostPath).toBe("/host/Drive");

      fireEvent.keyDown(modeTrigger, { key: "ArrowDown" });
      const listbox = await screen.findByRole("listbox");
      fireEvent.keyDown(listbox, { key: "End" });
      fireEvent.keyDown(listbox, { key: "Enter" });
      expect(draft.googleDrive.accessMode).toBe("read-write");
      expect(state.updateSystem).not.toHaveBeenCalled();
    });

    it("renders project source badges and writes project-scoped Google Drive values", async () => {
      const editableSettings = {
        cliWorkflow: { executionMode: "DOCKER" },
        googleDrive: { enabled: true, hostPath: "/host/Drive", accessMode: "read-write" as const },
      };
      let updatedProject: any = editableSettings;
      const state = createGoogleDriveState({
        activeScope: "project",
        selectedProject: { id: "project-1", name: "Project" },
        selectedIntegration: "google-drive",
        editableSettings,
        projectSources: {
          "googleDrive.enabled": "project",
          "googleDrive.hostPath": "project",
          "googleDrive.accessMode": "project",
        },
      });
      state.updateEditableSettings = vi.fn((recipe) => {
        updatedProject = recipe(updatedProject);
      });

      const { container } = render(<SettingsIntegrationsPanel state={state as any} />);
      await waitFor(() => expect(container.textContent).toContain("Google Drive Configuration"));

      expect(screen.getAllByText("Project override").length).toBeGreaterThanOrEqual(3);
      fireEvent.input(screen.getByLabelText("Linked Drive directory"), { target: { value: "/project/Drive" } });
      expect(updatedProject.googleDrive.hostPath).toBe("/project/Drive");
      expect(state.updateProject).not.toHaveBeenCalled();
    });
  });
});
