import type { FunctionComponent, ComponentChildren } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import gsap from "gsap";
import { ArrowLeft } from "lucide-preact";
import type { SettingsPageState, IntegrationId } from "../../../hooks/use-settings-page-state.js";
import { NoticePanel, ActionButton } from "../SettingsSurface.js";
import { Row, TextInput, Toggle, PillChoiceGroup } from "../SettingsFormFields.js";
import type { ProjectSettings } from "../../../../types.js";
import { SectionCard, IntegrationConfigRow, getBadge as getBadgeHelper, getFieldBadge as getFieldBadgeHelper } from "./SharedPanelComponents.js";
import { InfoIconPopover } from "../../ui/InfoIconPopover.js";

  export const SettingsIntegrationsPanel: FunctionComponent<{ state: SettingsPageState }> = ({ state }) => {
  const {
    activeScope,
    selectedProject,
    editableSettings,
    systemSettings,
    projectSources,
    selectedIntegration,
    setSelectedIntegration,
    integrations,
    importingHints,
    externalHints,
    handleImportHints,
    updateEditableSettings,
    updateSystem,
  } = state;

  const getBadge = (...prefixes: string[]) => getBadgeHelper(activeScope, projectSources, ...prefixes);
  const getFieldBadge = (path: string) => getFieldBadgeHelper(activeScope, projectSources, path);

  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const [activeIntegrationDetail, setActiveIntegrationDetail] = useState<IntegrationId | null>(selectedIntegration);

  const isInitialMount = useRef(true);

  useLayoutEffect(() => {
    if (!containerRef.current || !listRef.current || !detailRef.current) return;

    if (isInitialMount.current) {
      isInitialMount.current = false;
      if (selectedIntegration === null) {
        gsap.set(listRef.current, { position: "relative", top: 0, left: 0 });
        gsap.set(detailRef.current, { display: "none", position: "absolute", top: 0, left: 0 });
      } else {
        gsap.set(listRef.current, { position: "absolute", top: 0, left: 0, x: "-100%", opacity: 0 });
        gsap.set(detailRef.current, { display: "block", position: "relative", top: 0, left: 0 });
      }
      return;
    }

    const isEnteringDetail = selectedIntegration !== null;
    const tl = gsap.timeline();

    if (isEnteringDetail) {
      setActiveIntegrationDetail(selectedIntegration);
      const startHeight = containerRef.current.offsetHeight;

      gsap.set(listRef.current, { position: "absolute", top: 0, left: 0 });
      gsap.set(detailRef.current, { display: "block", position: "relative", top: 0, left: 0, x: "100%", opacity: 0 });

      const targetHeight = detailRef.current.offsetHeight;

      tl.fromTo(containerRef.current, { height: startHeight }, {
        height: targetHeight,
        duration: 0.4,
        ease: "power3.inOut",
        clearProps: "height",
        onComplete: () => {
          if (containerRef.current) gsap.set(containerRef.current, { height: "auto" });
        }
      }, 0).to(listRef.current, {
        x: "-100%",
        opacity: 0,
        duration: 0.4,
        ease: "power3.inOut",
      }, 0).to(detailRef.current, {
        x: "0%",
        opacity: 1,
        duration: 0.4,
        ease: "power3.inOut",
      }, 0);
    } else {
      const startHeight = containerRef.current.offsetHeight;

      gsap.set(listRef.current, { position: "relative", top: 0, left: 0 });
      gsap.set(detailRef.current, { position: "absolute", top: 0, left: 0 });

      const targetHeight = listRef.current.offsetHeight;

      tl.fromTo(containerRef.current, { height: startHeight }, {
        height: targetHeight,
        duration: 0.4,
        ease: "power3.inOut",
        clearProps: "height",
        onComplete: () => {
          if (containerRef.current) gsap.set(containerRef.current, { height: "auto" });
        }
      }, 0).to(detailRef.current, {
        x: "100%",
        opacity: 0,
        duration: 0.4,
        ease: "power3.inOut",
        onComplete: () => {
          setActiveIntegrationDetail(null);
          if (detailRef.current) gsap.set(detailRef.current, { display: "none" });
        }
      }, 0).to(listRef.current, {
        x: "0%",
        opacity: 1,
        duration: 0.4,
        ease: "power3.inOut",
      }, 0);
    }
  }, [selectedIntegration]);

    if (!editableSettings || !systemSettings) {
      return null;
    }

    const hasCliProviderConnection = (
      providerId: "gemini" | "codex" | "claude-code",
      mountEnabled: boolean,
    ): boolean => {
      const hasSystemKey = providerId === "gemini"
        ? Boolean(systemSettings.integrations.geminiApiKey.trim() || externalHints?.resolved.geminiApiKey.trim())
        : providerId === "codex"
          ? Boolean(systemSettings.integrations.codexApiKey.trim() || externalHints?.resolved.codexApiKey.trim())
          : Boolean(systemSettings.integrations.claudeCodeApiKey.trim() || externalHints?.resolved.claudeCodeApiKey.trim());
      const hasLocalAuth = providerId === "gemini"
        ? Boolean(externalHints?.providerAvailability.gemini?.hasLocalAuth)
        : providerId === "codex"
          ? Boolean(externalHints?.providerAvailability.codex?.hasLocalAuth)
          : Boolean(externalHints?.providerAvailability.claudeCode?.hasLocalAuth);

      return hasSystemKey || hasLocalAuth || mountEnabled;
    };

    const connectedState: Record<IntegrationId, boolean> = {
      jules: Boolean(systemSettings.integrations.julesApiKey.trim() || externalHints?.resolved.julesApiKey.trim()),
      gemini: hasCliProviderConnection("gemini", editableSettings.cliWorkflow.containerMountGeminiAuth),
      codex: hasCliProviderConnection("codex", editableSettings.cliWorkflow.containerMountCodexAuth),
      "claude-code": hasCliProviderConnection("claude-code", editableSettings.cliWorkflow.containerMountClaudeCodeAuth),
      github: Boolean(systemSettings.integrations.githubToken.trim() || externalHints?.resolved.githubToken.trim() || editableSettings.cliWorkflow.containerMountGithubAuth),
    };
    const dockerExecutionEnabled = editableSettings.cliWorkflow.executionMode === "DOCKER";

    const renderIntegrationConfig = (): ComponentChildren => {
      const integrationToRender = activeIntegrationDetail || selectedIntegration;
      if (!integrationToRender) return null;

      const backButton = (
        <button
          className="flex items-center gap-2 text-sm text-neutral-400 hover:text-white transition-colors mb-4"
          onClick={() => setSelectedIntegration(null)}
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Integrations
        </button>
      );

      const renderConfig = () => {
        switch (integrationToRender) {
        case "jules":
          if (activeScope === "project") {
            return (
              <SectionCard title="Jules Configuration" watermark="JUL">
                <NoticePanel title="System-owned credential">
                  The Jules API key is shared system infrastructure. Configure it from system scope here, and use the AI Models category for project-level routing and model choices.
                </NoticePanel>
              </SectionCard>
            );
          }
          return (
            <SectionCard title="Jules Configuration" watermark="JUL">
              <Row label="Jules API key" description="System-wide credential for the Jules provider integration." last>
                <TextInput
                  value={systemSettings.integrations.julesApiKey}
                  onChange={(value) => updateSystem((current) => ({
                    ...current,
                    integrations: {
                      ...current.integrations,
                      julesApiKey: value,
                    },
                  }))}
                  mono
                />
              </Row>
            </SectionCard>
          );
        case "gemini":
          if (activeScope === "project") {
            return (
              <SectionCard title="Gemini Configuration" watermark="GEM">
                <NoticePanel title="System-owned credential">
                  The Gemini API key is shared at system scope so hosted worker integrations can reuse it across projects.
                </NoticePanel>
                <Row label="Mount Gemini auth" description="Copy Gemini CLI auth into Docker for this scope." badge={getFieldBadge("cliWorkflow.containerMountGeminiAuth")}>
                  <Toggle value={editableSettings.cliWorkflow.containerMountGeminiAuth} onChange={() => updateEditableSettings((current) => ({
                    ...current,
                    cliWorkflow: {
                      ...current.cliWorkflow,
                      containerMountGeminiAuth: !current.cliWorkflow.containerMountGeminiAuth,
                    },
                  }))} />
                </Row>
                <Row label="Gemini auth path" description="Host path copied into the Docker runtime for Gemini auth." badge={getFieldBadge("cliWorkflow.containerGeminiAuthPath")} last>
                  <TextInput
                    value={editableSettings.cliWorkflow.containerGeminiAuthPath}
                    onChange={(value) => updateEditableSettings((current) => ({
                      ...current,
                      cliWorkflow: {
                        ...current.cliWorkflow,
                        containerGeminiAuthPath: value,
                      },
                    }))}
                    disabled={!editableSettings.cliWorkflow.containerMountGeminiAuth}
                    mono
                  />
                </Row>
              </SectionCard>
            );
          }
          return (
            <SectionCard title="Gemini Configuration" watermark="GEM">
              <Row label="Gemini API key" description="Shared credential for Gemini-backed execution and future hosted workers. Disabled while Docker auth mount is active.">
                <TextInput
                  value={systemSettings.integrations.geminiApiKey}
                  onChange={(value) => updateSystem((current) => ({
                    ...current,
                    integrations: {
                      ...current.integrations,
                      geminiApiKey: value,
                    },
                  }))}
                  disabled={dockerExecutionEnabled && editableSettings.cliWorkflow.containerMountGeminiAuth}
                  mono
                />
              </Row>
              <Row label="Mount Gemini auth" description="Copy Gemini CLI auth into Docker instead of passing the API key." badge={getFieldBadge("cliWorkflow.containerMountGeminiAuth")}>
                <Toggle value={editableSettings.cliWorkflow.containerMountGeminiAuth} onChange={() => updateEditableSettings((current) => ({
                  ...current,
                  cliWorkflow: {
                    ...current.cliWorkflow,
                    containerMountGeminiAuth: !current.cliWorkflow.containerMountGeminiAuth,
                  },
                }))} />
              </Row>
              <Row label="Gemini auth path" description="Host path copied into the Docker runtime for Gemini auth." badge={getFieldBadge("cliWorkflow.containerGeminiAuthPath")} last>
                <TextInput
                  value={editableSettings.cliWorkflow.containerGeminiAuthPath}
                  onChange={(value) => updateEditableSettings((current) => ({
                    ...current,
                    cliWorkflow: {
                      ...current.cliWorkflow,
                      containerGeminiAuthPath: value,
                    },
                  }))}
                  disabled={!editableSettings.cliWorkflow.containerMountGeminiAuth}
                  mono
                />
              </Row>
            </SectionCard>
          );
        case "codex":
          if (activeScope === "project") {
            return (
              <SectionCard title="Codex Configuration" watermark="CDX">
                <NoticePanel title="System-owned credential">
                  The Codex API key is managed once at system scope and then reused by projects and future worker providers.
                </NoticePanel>
                <Row label="Mount Codex auth" description="Copy Codex auth into Docker for this scope." badge={getFieldBadge("cliWorkflow.containerMountCodexAuth")}>
                  <Toggle value={editableSettings.cliWorkflow.containerMountCodexAuth} onChange={() => updateEditableSettings((current) => ({
                    ...current,
                    cliWorkflow: {
                      ...current.cliWorkflow,
                      containerMountCodexAuth: !current.cliWorkflow.containerMountCodexAuth,
                    },
                  }))} />
                </Row>
                <Row label="Codex auth path" description="Host path copied into the Docker runtime for Codex auth." badge={getFieldBadge("cliWorkflow.containerCodexAuthPath")} last>
                  <TextInput
                    value={editableSettings.cliWorkflow.containerCodexAuthPath}
                    onChange={(value) => updateEditableSettings((current) => ({
                      ...current,
                      cliWorkflow: {
                        ...current.cliWorkflow,
                        containerCodexAuthPath: value,
                      },
                    }))}
                    disabled={!editableSettings.cliWorkflow.containerMountCodexAuth}
                    mono
                  />
                </Row>
              </SectionCard>
            );
          }
          return (
            <SectionCard title="Codex Configuration" watermark="CDX">
              <Row label="Codex API key" description="Shared credential for Codex-backed execution and worker routing. Disabled while Docker auth mount is active.">
                <TextInput
                  value={systemSettings.integrations.codexApiKey}
                  onChange={(value) => updateSystem((current) => ({
                    ...current,
                    integrations: {
                      ...current.integrations,
                      codexApiKey: value,
                    },
                  }))}
                  disabled={dockerExecutionEnabled && editableSettings.cliWorkflow.containerMountCodexAuth}
                  mono
                />
              </Row>
              <Row label="Mount Codex auth" description="Copy Codex auth into Docker instead of passing the API key." badge={getFieldBadge("cliWorkflow.containerMountCodexAuth")}>
                <Toggle value={editableSettings.cliWorkflow.containerMountCodexAuth} onChange={() => updateEditableSettings((current) => ({
                  ...current,
                  cliWorkflow: {
                    ...current.cliWorkflow,
                    containerMountCodexAuth: !current.cliWorkflow.containerMountCodexAuth,
                  },
                }))} />
              </Row>
              <Row label="Codex auth path" description="Host path copied into the Docker runtime for Codex auth." badge={getFieldBadge("cliWorkflow.containerCodexAuthPath")} last>
                <TextInput
                  value={editableSettings.cliWorkflow.containerCodexAuthPath}
                  onChange={(value) => updateEditableSettings((current) => ({
                    ...current,
                    cliWorkflow: {
                      ...current.cliWorkflow,
                      containerCodexAuthPath: value,
                    },
                  }))}
                  disabled={!editableSettings.cliWorkflow.containerMountCodexAuth}
                  mono
                />
              </Row>
            </SectionCard>
          );
        case "claude-code":
          if (activeScope === "project") {
            return (
              <SectionCard title="Claude Code Configuration" watermark="CCD">
                <NoticePanel title="System-owned credential">
                  The Claude Code API key is shared system-wide. Project-level provider selection still lives under AI Models.
                </NoticePanel>
                <Row label="Mount Claude Code auth" description="Copy Claude Code auth into Docker for this scope." badge={getFieldBadge("cliWorkflow.containerMountClaudeCodeAuth")}>
                  <Toggle value={editableSettings.cliWorkflow.containerMountClaudeCodeAuth} onChange={() => updateEditableSettings((current) => ({
                    ...current,
                    cliWorkflow: {
                      ...current.cliWorkflow,
                      containerMountClaudeCodeAuth: !current.cliWorkflow.containerMountClaudeCodeAuth,
                    },
                  }))} />
                </Row>
                <Row label="Claude Code auth path" description="Host path copied into the Docker runtime for Claude Code auth." badge={getFieldBadge("cliWorkflow.containerClaudeCodeAuthPath")} last>
                  <TextInput
                    value={editableSettings.cliWorkflow.containerClaudeCodeAuthPath}
                    onChange={(value) => updateEditableSettings((current) => ({
                      ...current,
                      cliWorkflow: {
                        ...current.cliWorkflow,
                        containerClaudeCodeAuthPath: value,
                      },
                    }))}
                    disabled={!editableSettings.cliWorkflow.containerMountClaudeCodeAuth}
                    mono
                  />
                </Row>
              </SectionCard>
            );
          }
          return (
            <SectionCard title="Claude Code Configuration" watermark="CCD">
              <Row label="Claude Code API key" description="Shared credential for Claude Code-backed execution. Disabled while Docker auth mount is active.">
                <TextInput
                  value={systemSettings.integrations.claudeCodeApiKey}
                  onChange={(value) => updateSystem((current) => ({
                    ...current,
                    integrations: {
                      ...current.integrations,
                      claudeCodeApiKey: value,
                    },
                  }))}
                  disabled={dockerExecutionEnabled && editableSettings.cliWorkflow.containerMountClaudeCodeAuth}
                  mono
                />
              </Row>
              <Row label="Mount Claude Code auth" description="Copy Claude Code auth into Docker instead of passing the API key." badge={getFieldBadge("cliWorkflow.containerMountClaudeCodeAuth")}>
                <Toggle value={editableSettings.cliWorkflow.containerMountClaudeCodeAuth} onChange={() => updateEditableSettings((current) => ({
                  ...current,
                  cliWorkflow: {
                    ...current.cliWorkflow,
                    containerMountClaudeCodeAuth: !current.cliWorkflow.containerMountClaudeCodeAuth,
                  },
                }))} />
              </Row>
              <Row label="Claude Code auth path" description="Host path copied into the Docker runtime for Claude Code auth." badge={getFieldBadge("cliWorkflow.containerClaudeCodeAuthPath")} last>
                <TextInput
                  value={editableSettings.cliWorkflow.containerClaudeCodeAuthPath}
                  onChange={(value) => updateEditableSettings((current) => ({
                    ...current,
                    cliWorkflow: {
                      ...current.cliWorkflow,
                      containerClaudeCodeAuthPath: value,
                    },
                  }))}
                  disabled={!editableSettings.cliWorkflow.containerMountClaudeCodeAuth}
                  mono
                />
              </Row>
            </SectionCard>
          );
        case "github":
        default:
          return (
            <SectionCard title="GitHub Configuration" watermark="GTH" badge={getBadge("git")}>
              {activeScope === "system" ? (
                <Row label="GitHub token" description="Shared token for repository, pull request, branch, and CI integration.">
                  <TextInput
                    value={systemSettings.integrations.githubToken}
                    onChange={(value) => updateSystem((current) => ({
                      ...current,
                      integrations: {
                        ...current.integrations,
                        githubToken: value,
                      },
                    }))}
                    disabled={dockerExecutionEnabled && editableSettings.cliWorkflow.containerMountGithubAuth}
                    mono
                  />
                </Row>
              ) : null}
              <Row label="Mount GitHub auth" description="Copy GitHub CLI auth into Docker instead of passing the token." badge={getFieldBadge("cliWorkflow.containerMountGithubAuth")}>
                <Toggle value={editableSettings.cliWorkflow.containerMountGithubAuth} onChange={() => updateEditableSettings((current) => ({
                  ...current,
                  cliWorkflow: {
                    ...current.cliWorkflow,
                    containerMountGithubAuth: !current.cliWorkflow.containerMountGithubAuth,
                  },
                }))} />
              </Row>
              <Row label="GitHub auth path" description="Host path copied into the Docker runtime for GitHub CLI auth." badge={getFieldBadge("cliWorkflow.containerGithubAuthPath")}>
                <TextInput
                  value={editableSettings.cliWorkflow.containerGithubAuthPath}
                  onChange={(value) => updateEditableSettings((current) => ({
                    ...current,
                    cliWorkflow: {
                      ...current.cliWorkflow,
                      containerGithubAuthPath: value,
                    },
                  }))}
                  disabled={!editableSettings.cliWorkflow.containerMountGithubAuth}
                  mono
                />
              </Row>
              <Row label="GitHub mode" description="Remote uses GitHub APIs; local keeps workflow on the local repository only." badge={getFieldBadge("git.githubMode")}>
                <PillChoiceGroup
                  value={editableSettings.git.githubMode}
                  onChange={(value) => updateEditableSettings((current) => ({
                    ...current,
                    git: {
                      ...current.git,
                      githubMode: value as ProjectSettings["git"]["githubMode"],
                    },
                  }))}
                  options={[
                    { value: "REMOTE", label: "Remote", hint: "Use PRs, checks, and GitHub APIs." },
                    { value: "LOCAL", label: "Local", hint: "Stay inside the repository only." },
                  ]}
                />
              </Row>
              <Row label="Default branch" description="Main GitHub integration branch used for merge and release flow." badge={getFieldBadge("git.defaultBranch")}>
                <TextInput
                  value={editableSettings.git.defaultBranch}
                  onChange={(value) => updateEditableSettings((current) => ({
                    ...current,
                    git: {
                      ...current.git,
                      defaultBranch: value,
                    },
                  }))}
                  mono
                />
              </Row>
              <Row label="Feature branch prefix" description="Prefix used when workers or automation create GitHub feature branches." badge={getFieldBadge("git.featureBranchPrefix")}>
                <TextInput
                  value={editableSettings.git.featureBranchPrefix}
                  onChange={(value) => updateEditableSettings((current) => ({
                    ...current,
                    git: {
                      ...current.git,
                      featureBranchPrefix: value,
                    },
                  }))}
                  mono
                />
              </Row>
              <Row label="Sprint branch scheme" description="Naming scheme for sprint-level GitHub branches and aggregation flow." badge={getFieldBadge("git.sprintBranchScheme")} info={<InfoIconPopover items={[
                { key: "{sprint}", desc: "Sprint identifier" },
                { key: "{sprintNumber}", desc: "Sprint sequence number" },
                { key: "{sprintName}", desc: "Name of the sprint" },
                { key: "{date}", desc: "Current date" },
                { key: "{taskCount}", desc: "Number of tasks" },
              ]} />}>
                <TextInput
                  value={editableSettings.git.sprintBranchScheme}
                  onChange={(value) => updateEditableSettings((current) => ({
                    ...current,
                    git: {
                      ...current.git,
                      sprintBranchScheme: value,
                    },
                  }))}
                  mono
                />
              </Row>
              <Row label="Auto-create pull requests" description="Open GitHub pull requests automatically when work completes and the flow supports it." badge={getFieldBadge("git.autoCreatePr")} last>
                <Toggle
                  value={editableSettings.git.autoCreatePr}
                  onChange={() => updateEditableSettings((current) => ({
                    ...current,
                    git: {
                      ...current.git,
                      autoCreatePr: !current.git.autoCreatePr,
                    },
                  }))}
                />
              </Row>
            </SectionCard>
          );
        }
      };

      return (
        <div>
          {backButton}
          {renderConfig()}
        </div>
      );
    };

    return (
      <div className="flex flex-col gap-5">
        <div ref={containerRef} className="relative overflow-hidden w-full">
          <div ref={listRef} className="w-full">
            <SectionCard title="Connected Integrations" watermark="INT">
              {integrations.map((integration, index) => (
                <IntegrationConfigRow
                  key={integration.id}
                  label={integration.label}
                  description={integration.description}
                  connected={connectedState[integration.id]}
                  active={selectedIntegration === integration.id}
                  onConfigure={() => setSelectedIntegration(integration.id)}
                  last={index === integrations.length - 1}
                />
              ))}
            </SectionCard>
          </div>

          <div ref={detailRef} className="absolute top-0 left-0 w-full" style={{ display: "none" }}>
            {renderIntegrationConfig()}
          </div>
        </div>

        {activeScope === "system" ? (
          <SectionCard title="Integration Import" watermark="ENV">
            <Row label="Import from environment" description="Pull missing provider credentials from `.env` or `settings.json` without overwriting filled fields." last>
              <ActionButton label="Import Hints" onClick={() => void handleImportHints()} busy={importingHints} />
            </Row>
          </SectionCard>
        ) : null}

        <NoticePanel title="Integration ownership">
          Shared provider credentials remain system-owned. GitHub workflow defaults can be set at system scope and overridden at project scope, which keeps integration ownership clean while still letting each repository tune its behavior.
        </NoticePanel>
      </div>
    );
  };
