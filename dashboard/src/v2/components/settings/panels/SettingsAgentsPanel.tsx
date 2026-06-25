import type { FunctionComponent } from "preact";
import type { SettingsPageState } from "../../../hooks/use-settings-page-state.js";
import { Row, Toggle, SelectInput, PillChoiceGroup } from "../SettingsFormFields.js";
import { SectionCard, getBadge as getBadgeHelper, getFieldBadge as getFieldBadgeHelper } from "./SharedPanelComponents.js";
import { FileText, Route } from "lucide-preact";
import { QAPanel } from "./QAPanel.js";
import type { ProjectSettings } from "../../../../types.js";
import { AgentSelectAvatarIcon } from "../../agents/AgentSelectAvatarIcon.js";

const DEFAULT_AGENT_ROUTING: ProjectSettings["agents"]["routing"] = {
  planning: { agentPresetId: null },
  taskCoding: { mode: "MANUAL", agentPresetId: null, orchestratorAgentPresetIds: [] },
  ciFix: { agentPresetId: null },
  mergeConflict: { agentPresetId: null },
  dashboardReply: { agentPresetId: null },
  clarificationReply: { agentPresetId: null },
};

const normalizeAgentRoutingSettings = (
  routing: Partial<ProjectSettings["agents"]["routing"]> | undefined,
): ProjectSettings["agents"]["routing"] => ({
  planning: { ...DEFAULT_AGENT_ROUTING.planning, ...routing?.planning },
  taskCoding: {
    ...DEFAULT_AGENT_ROUTING.taskCoding,
    ...routing?.taskCoding,
    orchestratorAgentPresetIds: routing?.taskCoding?.orchestratorAgentPresetIds
      ? [...routing.taskCoding.orchestratorAgentPresetIds]
      : [],
  },
  ciFix: { ...DEFAULT_AGENT_ROUTING.ciFix, ...routing?.ciFix },
  mergeConflict: { ...DEFAULT_AGENT_ROUTING.mergeConflict, ...routing?.mergeConflict },
  dashboardReply: { ...DEFAULT_AGENT_ROUTING.dashboardReply, ...routing?.dashboardReply },
  clarificationReply: { ...DEFAULT_AGENT_ROUTING.clarificationReply, ...routing?.clarificationReply },
});

export const SettingsAgentsPanel: FunctionComponent<{ state: SettingsPageState }> = ({ state }) => {
  const {
    activeScope,
    setActiveScope,
    selectedProject,
    editableSettings,
    projectSettings,
    projectSources,
    projectAgentPresetOptions,
    updateProject,
    updateEditableSettings,
  } = state;

  const getBadge = (...prefixes: string[]) => getBadgeHelper(activeScope, projectSources, ...prefixes);
  const getFieldBadge = (path: string) => getFieldBadgeHelper(activeScope, projectSources, path);

  if (!editableSettings) {
    return null;
  }

  const agentRoutingSettings = normalizeAgentRoutingSettings(projectSettings?.agents.routing ?? editableSettings.agents.routing);
  const qaSettings = projectSettings?.agents.qualityAssurance ?? editableSettings.agents.qualityAssurance;
  const projectAgentSelectOptions = projectAgentPresetOptions.map((option) => ({
    ...option,
    icon: () => <AgentSelectAvatarIcon avatarConfig={option.avatarConfig} seed={`${option.value}:${option.label}`} />,
  }));
  const qaPresetOptions = [{ value: "", label: "Built-in QA agent", icon: () => <AgentSelectAvatarIcon seed="built-in:qa" /> }, ...projectAgentSelectOptions];
  const agentPresetSelectorsDisabled = !selectedProject || !projectSettings;
  const qaPresetSelectorsDisabled = agentPresetSelectorsDisabled;
  const agentSectionBadge = selectedProject
    ? getBadgeHelper("project", projectSources, "agents.routing")
    : getBadge("agents.routing");
  const qaSectionBadge = selectedProject
    ? getBadgeHelper("project", projectSources, "agents", "agents.qualityAssurance")
    : getBadge("agents", "agents.qualityAssurance");
  const qaFieldBadge = (path: string) => (
    selectedProject
      ? getFieldBadgeHelper("project", projectSources, path)
      : getFieldBadge(path)
  );

  const updateQaSettings = (recipe: (current: typeof qaSettings) => typeof qaSettings) => {
    if (selectedProject && projectSettings) {
      if (activeScope !== "project") {
        setActiveScope("project");
      }
      updateProject((current) => ({
        ...current,
        agents: {
          ...current.agents,
          qualityAssurance: recipe(current.agents.qualityAssurance),
        },
      }));
      return;
    }

    updateEditableSettings((current) => ({
      ...current,
      agents: {
        ...current.agents,
        qualityAssurance: recipe(current.agents.qualityAssurance),
      },
    }));
  };
  const updateAgentRoutingSettings = (recipe: (current: typeof agentRoutingSettings) => typeof agentRoutingSettings) => {
    if (selectedProject && projectSettings) {
      if (activeScope !== "project") {
        setActiveScope("project");
      }
      updateProject((current) => ({
        ...current,
        agents: {
          ...current.agents,
          routing: recipe(normalizeAgentRoutingSettings(current.agents.routing)),
        },
      }));
      return;
    }

    updateEditableSettings((current) => ({
      ...current,
      agents: {
        ...current.agents,
        routing: recipe(normalizeAgentRoutingSettings(current.agents.routing)),
      },
    }));
  };

  const toggleOrchestratorAgent = (agentPresetId: string): void => {
    updateAgentRoutingSettings((current) => {
      const selected = current.taskCoding.orchestratorAgentPresetIds;
      return {
        ...current,
        taskCoding: {
          ...current.taskCoding,
          orchestratorAgentPresetIds: selected.includes(agentPresetId)
            ? selected.filter((id) => id !== agentPresetId)
            : [...selected, agentPresetId],
        },
      };
    });
  };

  return (
    <div className="flex flex-col gap-5">
      <SectionCard title="Project Markdown Mirror" watermark="AGT" badge={getBadge("agents")} icon={<FileText strokeWidth={2.4} />}>
        <Row
          label="Save agent markdown to project directory"
          description="When enabled, dashboard edits write a companion markdown file under `.code-ux/agents` for the selected project. Default and home agent files are never modified."
          badge={getFieldBadge("agents.saveToProjectDirectory")}
        >
          <Toggle aria-label="Toggle setting"             value={editableSettings.agents.saveToProjectDirectory}
            onChange={() => updateEditableSettings((current) => ({
              ...current,
              agents: {
                ...current.agents,
                saveToProjectDirectory: !current.agents.saveToProjectDirectory,
              },
            }))}
          />
        </Row>
        <Row label="Mirror directory" description="Dashboard-authored markdown companions live alongside other project-local Code UX files." last>
          <div className="rounded-xl bg-black/[0.04] px-3 py-2 font-mono text-sm text-slate-600 dark:bg-white/[0.04] dark:text-slate-300">
            .code-ux/agents
          </div>
        </Row>
      </SectionCard>

      <SectionCard title="Agent Routing" watermark="RTE" badge={agentSectionBadge} icon={<Route strokeWidth={2.4} />}>
        <div className="grid gap-4 xl:grid-cols-[280px_minmax(0,1fr)]">
          <div className="rounded-[1.35rem] border border-black/[0.06] bg-black/[0.02] p-4 text-xs leading-relaxed text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-slate-400">
            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Coding tasks</div>
            <div className="mt-2">
              Manual pins all coding work to one preset. Orchestrator gives the Planning agent a roster and lets it assign the best specialist per task.
            </div>
            {selectedProject && activeScope !== "project" ? (
              <div className="mt-3 rounded-xl border border-signal-500/18 bg-signal-500/[0.08] px-3 py-2 text-signal-700 dark:border-signal-400/18 dark:bg-signal-400/[0.08] dark:text-signal-200">
                Routing edits switch to Project scope for {selectedProject.name}.
              </div>
            ) : null}
          </div>

          <div className="rounded-[1.35rem] border border-black/[0.06] bg-white/78 p-5 dark:border-white/[0.06] dark:bg-void-900/52 md:p-6">
            <Row label="Coding task routing" description="Choose whether coding tasks use one fixed agent or a Planning-agent-selected specialist.">
              <PillChoiceGroup
                value={agentRoutingSettings.taskCoding.mode}
                onChange={(value) => updateAgentRoutingSettings((current) => ({
                  ...current,
                  taskCoding: {
                    ...current.taskCoding,
                    mode: value === "ORCHESTRATOR" ? "ORCHESTRATOR" : "MANUAL",
                  },
                }))}
                options={[
                  { value: "MANUAL", label: "Manual", hint: "Pin one coding agent." },
                  { value: "ORCHESTRATOR", label: "Orchestrator", hint: "Planner selects per task." },
                ]}
              />
            </Row>

            {agentRoutingSettings.taskCoding.mode === "ORCHESTRATOR" ? (
              <div className="py-5">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Available to orchestrator</div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    {agentRoutingSettings.taskCoding.orchestratorAgentPresetIds.length} selected
                  </div>
                </div>
                <div className="rounded-2xl border border-black/[0.05] bg-black/[0.015] p-3 dark:border-white/[0.06] dark:bg-white/[0.025]">
                  <div className="flex flex-wrap gap-2">
                    {projectAgentPresetOptions.map((option) => {
                      const active = agentRoutingSettings.taskCoding.orchestratorAgentPresetIds.includes(option.value);
                      return (
                        <button
                          key={option.value}
                          type="button"
                          disabled={agentPresetSelectorsDisabled}
                          onClick={() => toggleOrchestratorAgent(option.value)}
                          className={`rounded-full border px-3 py-2 text-[11px] font-semibold tracking-wide transition-colors disabled:opacity-50 ${
                            active
                              ? "border-signal-500/35 bg-signal-500/12 text-signal-700 dark:border-signal-400/35 dark:bg-signal-400/12 dark:text-signal-200"
                              : "border-black/[0.08] bg-white/78 text-slate-500 dark:border-white/[0.08] dark:bg-void-900/60 dark:text-slate-400"
                          }`}
                        >
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
                {projectAgentPresetOptions.length === 0 ? (
                  <div className="mt-3 rounded-[1.15rem] border border-dashed border-black/[0.06] bg-black/[0.02] px-4 py-3 text-xs leading-relaxed text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.02] dark:text-slate-400">
                    Create project agents first, then return here to expose coding specialists to the orchestrator.
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="mt-5 grid gap-3 md:grid-cols-2">
              {([
                ["planning", "Planning agent", "Used for sprint planning and prompt improvement.", "Built-in Planning agent"],
                ...(agentRoutingSettings.taskCoding.mode === "MANUAL"
                  ? [["taskCoding", "Coding agent", "Used for task coding when no task-level orchestrator assignment exists.", "Built-in Worker agent"] as const]
                  : []),
                ["ciFix", "CI fix", "Used for automated CI repair loops.", "Built-in Worker agent"],
                ["mergeConflict", "Merge conflict", "Used for automated conflict resolution.", "Built-in Worker agent"],
                ["dashboardReply", "Dashboard reply", "Used for generated dashboard chat replies.", "Built-in Worker agent"],
                ["clarificationReply", "Clarification reply", "Used for automatic worker clarification replies.", "Built-in Project manager agent"],
              ] as const).map(([key, label, description, builtInLabel]) => (
                <div
                  key={key}
                  className="flex min-w-0 flex-col gap-3 rounded-2xl border border-black/[0.05] bg-white/55 p-4 dark:border-white/[0.06] dark:bg-white/[0.025]"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">{label}</div>
                    <div className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">{description}</div>
                  </div>
                  <SelectInput
                    value={agentRoutingSettings[key].agentPresetId || ""}
                    onChange={(value) => updateAgentRoutingSettings((current) => ({
                      ...current,
                      [key]: key === "taskCoding"
                        ? { ...current.taskCoding, agentPresetId: value || null }
                        : { agentPresetId: value || null },
                    }))}
                    options={[{ value: "", label: builtInLabel, icon: () => <AgentSelectAvatarIcon seed={`built-in:${key}:${builtInLabel}`} /> }, ...projectAgentSelectOptions]}
                    disabled={agentPresetSelectorsDisabled}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      </SectionCard>

      <QAPanel
        settings={qaSettings}
        update={(patch) => updateQaSettings((current) => ({ ...current, ...patch }))}
        getBadge={qaFieldBadge}
        sectionBadge={qaSectionBadge}
        presetOptions={qaPresetOptions}
        selectorsDisabled={qaPresetSelectorsDisabled}
        selectedProjectName={selectedProject?.name}
        activeScope={activeScope}
      />
    </div>
  );
};
