/** @vitest-environment jsdom */
/** @vitest-environment happy-dom */
/** @jsx h */
/** @jsxFrag Fragment */
import { h, Fragment } from "preact";
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, waitFor, screen, fireEvent, cleanup } from "@testing-library/preact";
import { SettingsIntegrationsPanel } from "../../../dashboard/src/v2/components/settings/panels/SettingsIntegrationsPanel.js";

vi.mock("gsap", () => {
  const applyStyles = (target: unknown, props: Record<string, unknown>) => {
    if (!(target instanceof HTMLElement)) return;
    for (const [key, value] of Object.entries(props)) {
      (target.style as CSSStyleDeclaration & Record<string, string>)[key] = String(value);
    }
  };

  return {
    default: {
      set: vi.fn((target: unknown, props: Record<string, unknown>) => applyStyles(target, props)),
      to: vi.fn((target: unknown, props: Record<string, unknown>) => applyStyles(target, props)),
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
    expect(container.textContent).toContain("Auto-close Jira issues");
    const inputValues = Array.from(container.querySelectorAll("input")).map((input) => input.value);
    expect(inputValues).toContain("https://acme.atlassian.net");
    expect(inputValues).toContain("OPS");
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

      const localCopyBtn = screen.getByRole("button", { name: /Local Copy/i });
      fireEvent.click(localCopyBtn);

      expect(state.updateSystem).toHaveBeenCalled();
      expect(updatedSystem.integrations.providers.gemini.authType).toBe("localAuth");
      expect(updatedSystem.integrations.providers.gemini.mountAuth).toBe(true);
      expect(updatedSystem.integrations.providers.gemini.apiKey).toBe("");
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

      const localCopyBtn = screen.getByRole("button", { name: /Local Copy/i });
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
      const inputs = container.querySelectorAll("input");
      const baseUrlInput = Array.from(inputs).find((inp) => inp.value === "");
      expect(baseUrlInput).toBeDefined();
      expect(baseUrlInput?.disabled).toBe(true);
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

      const localCopyBtn = screen.getByRole("button", { name: /Local Copy/i });
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

      const localCopyBtn = screen.getByRole("button", { name: /Local Copy/i });
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

      const localCopyBtn = screen.getByRole("button", { name: /Local Copy/i });
      fireEvent.click(localCopyBtn);

      expect(state.updateSystem).toHaveBeenCalled();
      const providerConfig = updatedSystem.integrations.providers.opencode;
      expect(providerConfig.authType).toBe("localAuth");
      expect(providerConfig.mountAuth).toBe(true);
      expect(providerConfig.apiKey).toBe("");
      expect(providerConfig.openCodeAuthMode).toBe("LOCAL_AUTH");
    });
  });
});
