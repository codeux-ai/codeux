import type { FunctionComponent } from "preact";
import { Route } from "lucide-preact";
import type { ProjectSettings } from "../../../../types.js";
import type { SettingsPageState } from "../../../hooks/use-settings-page-state.js";
import { AgentSelectAvatarIcon } from "../../agents/AgentSelectAvatarIcon.js";
import { Row, SelectInput } from "../SettingsFormFields.js";
import { OptionCardChoiceGroup, SectionCard, getBadge } from "./SharedPanelComponents.js";

const DEFAULT_AGENT_ROUTING: ProjectSettings["agents"]["routing"] = {
  planning: { agentPresetId: null },
  taskCoding: { mode: "MANUAL", agentPresetId: null, orchestratorAgentPresetIds: [] },
  ciFix: { agentPresetId: null },
  mergeConflict: { agentPresetId: null },
  dashboardReply: { agentPresetId: null },
  clarificationReply: { agentPresetId: null },
};

const normalizeRouting = (
  routing: Partial<ProjectSettings["agents"]["routing"]> | undefined,
): ProjectSettings["agents"]["routing"] => ({
  planning: { ...DEFAULT_AGENT_ROUTING.planning, ...routing?.planning },
  taskCoding: {
    ...DEFAULT_AGENT_ROUTING.taskCoding,
    ...routing?.taskCoding,
    orchestratorAgentPresetIds: [...(routing?.taskCoding?.orchestratorAgentPresetIds ?? [])],
  },
  ciFix: { ...DEFAULT_AGENT_ROUTING.ciFix, ...routing?.ciFix },
  mergeConflict: { ...DEFAULT_AGENT_ROUTING.mergeConflict, ...routing?.mergeConflict },
  dashboardReply: { ...DEFAULT_AGENT_ROUTING.dashboardReply, ...routing?.dashboardReply },
  clarificationReply: { ...DEFAULT_AGENT_ROUTING.clarificationReply, ...routing?.clarificationReply },
});

export interface SettingsAgentRoutingPanelProps {
  state: SettingsPageState;
}

export const SettingsAgentRoutingPanel: FunctionComponent<SettingsAgentRoutingPanelProps> = ({ state }) => {
  const {
    activeScope,
    setActiveScope,
    selectedProject,
    editableSettings,
    projectSettings,
    projectSources,
    projectAgentPresetOptions = [],
    updateProject,
    updateEditableSettings,
  } = state;
  if (!editableSettings) return null;

  const routing = normalizeRouting(projectSettings?.agents.routing ?? editableSettings.agents.routing);
  const options = projectAgentPresetOptions.map((option) => ({
    ...option,
    icon: () => <AgentSelectAvatarIcon avatarConfig={option.avatarConfig} seed={`${option.value}:${option.label}`} />,
  }));
  const selectorsDisabled = !selectedProject || !projectSettings;
  const disabledReason = "Select a project to choose custom project agents. Built-in routing remains available.";
  const selectedCount = routing.taskCoding.orchestratorAgentPresetIds.length;
  const sectionBadge = selectedProject
    ? getBadge("project", projectSources, "agents.routing")
    : getBadge(activeScope, projectSources, "agents.routing");

  const updateRouting = (recipe: (current: typeof routing) => typeof routing): void => {
    if (selectedProject && projectSettings) {
      if (activeScope !== "project") setActiveScope("project");
      updateProject((current) => ({
        ...current,
        agents: { ...current.agents, routing: recipe(normalizeRouting(current.agents.routing)) },
      }));
      return;
    }
    updateEditableSettings((current) => ({
      ...current,
      agents: { ...current.agents, routing: recipe(normalizeRouting(current.agents.routing)) },
    }));
  };

  const rosterOptions = options.map((option) => ({
    ...option,
    description: "Available for Planning-agent task assignment.",
    disabled: selectorsDisabled,
    disabledReason: selectorsDisabled ? disabledReason : undefined,
  }));

  return (
    <SectionCard
      title="Agent Routing"
      watermark="RTE"
      badge={sectionBadge}
      icon={<Route strokeWidth={2.4} />}
      accent="indigo"
      summary="See who handles each stage of a sprint, then refine only the routes that need a specialist."
      configureLabel="Review routes"
      highlights={[
        { label: "Coding mode", value: routing.taskCoding.mode === "ORCHESTRATOR" ? "Orchestrator" : "Manual", tone: "active" },
        { label: "Specialists", value: routing.taskCoding.mode === "ORCHESTRATOR" ? `${selectedCount} selected` : routing.taskCoding.agentPresetId ? "Custom agent" : "Built-in worker" },
        { label: "Project agents", value: projectAgentPresetOptions.length },
      ]}
    >
      <div className="grid min-w-0 items-start gap-4 xl:grid-cols-[minmax(14rem,17.5rem)_minmax(0,1fr)]">
        <div className="min-w-0 rounded-[1.35rem] border border-black/[0.06] bg-black/[0.02] p-4 text-xs leading-relaxed text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-slate-400">
          <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Coding tasks</div>
          <div className="mt-2">Manual pins all coding work to one preset. Orchestrator gives the Planning agent a roster and lets it assign the best specialist per task.</div>
          {selectedProject && activeScope !== "project" ? (
            <div role="status" className="mt-3 rounded-xl border border-signal-500/18 bg-signal-500/[0.08] px-3 py-2 text-signal-700 dark:border-signal-400/18 dark:bg-signal-400/[0.08] dark:text-signal-200">
              Routing edits switch to Project scope for the selected project.
            </div>
          ) : null}
        </div>

        <div className="min-w-0 rounded-[1.35rem] border border-black/[0.06] bg-white/78 p-4 dark:border-white/[0.06] dark:bg-void-900/52 sm:p-5 md:p-6">
          <Row label="Coding task routing" description="Choose whether coding tasks use one fixed agent or a Planning-agent-selected specialist.">
            <OptionCardChoiceGroup
              value={routing.taskCoding.mode}
              aria-label="Coding task routing mode"
              selectedSummaryLabel={`Routing mode: ${routing.taskCoding.mode === "ORCHESTRATOR" ? "Orchestrator" : "Manual"}`}
              onChange={(value) => updateRouting((current) => ({
                ...current,
                taskCoding: { ...current.taskCoding, mode: value === "ORCHESTRATOR" ? "ORCHESTRATOR" : "MANUAL" },
              }))}
              options={[
                { value: "MANUAL", label: "Manual", description: "Pin coding work to one selected preset or the built-in Worker fallback." },
                { value: "ORCHESTRATOR", label: "Orchestrator", description: "Give Planning a roster and let it choose the best specialist per task." },
              ]}
            />
          </Row>

          {routing.taskCoding.mode === "ORCHESTRATOR" ? (
            <div className="py-5">
              <OptionCardChoiceGroup
                selectionMode="multiple"
                value={routing.taskCoding.orchestratorAgentPresetIds}
                onChange={(orchestratorAgentPresetIds) => updateRouting((current) => ({
                  ...current,
                  taskCoding: { ...current.taskCoding, orchestratorAgentPresetIds },
                }))}
                options={rosterOptions}
                aria-label="Orchestrator coding agent roster"
                selectedSummaryLabel={selectedCount === 0 ? "No orchestrator agents selected" : `${selectedCount} orchestrator ${selectedCount === 1 ? "agent" : "agents"} selected`}
                helperText="Selected project agents are the only specialists Planning may assign to coding tasks."
              />
              {options.length === 0 ? (
                <div role="status" className="mt-3 rounded-[1.15rem] border border-dashed border-black/[0.06] bg-black/[0.02] px-4 py-3 text-xs leading-relaxed text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.02] dark:text-slate-400">
                  No project agents are available. Create project agents first, then return here to expose coding specialists to the orchestrator.
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="mt-5 grid min-w-0 gap-3 md:grid-cols-2">
            {([
              ["planning", "Planning agent", "Used for sprint planning and prompt improvement.", "Built-in Planning agent"],
              ...(routing.taskCoding.mode === "MANUAL"
                ? [["taskCoding", "Coding agent", "Used for task coding when no task-level orchestrator assignment exists.", "Built-in Worker agent"] as const]
                : []),
              ["ciFix", "CI fix", "Used for automated CI repair loops.", "Built-in Worker agent"],
              ["mergeConflict", "Merge conflict", "Used for automated conflict resolution.", "Built-in Worker agent"],
              ["dashboardReply", "Dashboard reply", "Used for generated dashboard chat replies.", "Built-in Project manager agent"],
              ["clarificationReply", "Clarification reply", "Used for automatic worker clarification replies.", "Built-in Project manager agent"],
            ] as const).map(([key, label, description, builtInLabel]) => (
              <div key={key} className="flex min-w-0 flex-col gap-3 rounded-2xl border border-black/[0.05] bg-white/55 p-4 dark:border-white/[0.06] dark:bg-white/[0.025]">
                <div className="min-w-0">
                  <div className="break-words text-sm font-semibold text-slate-800 dark:text-slate-100">{label}</div>
                  <div className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">{description}</div>
                </div>
                <SelectInput
                  value={routing[key].agentPresetId || ""}
                  onChange={(value) => updateRouting((current) => ({
                    ...current,
                    [key]: key === "taskCoding" ? { ...current.taskCoding, agentPresetId: value || null } : { agentPresetId: value || null },
                  }))}
                  options={[{ value: "", label: builtInLabel, icon: () => <AgentSelectAvatarIcon seed={`built-in:${key}:${builtInLabel}`} /> }, ...options]}
                  disabled={selectorsDisabled}
                  disabledReason={selectorsDisabled ? disabledReason : undefined}
                  aria-label={`${label} preset`}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </SectionCard>
  );
};
