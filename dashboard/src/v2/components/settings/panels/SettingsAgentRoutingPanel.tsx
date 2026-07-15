import type { FunctionComponent } from "preact";
import { Route } from "lucide-preact";
import type { ProjectSettings } from "../../../../types.js";
import type { SettingsPageState } from "../../../hooks/use-settings-page-state.js";
import { useDashboardI18n } from "../../../i18n/index.js";
import { settingsAgentsGuidanceMessages } from "../../../i18n/messages/settings-agents-guidance.js";
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
  const { translate, translatePlural } = useDashboardI18n();
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
  const disabledReason = translate(settingsAgentsGuidanceMessages, "routingDisabledReason");
  const selectedCount = routing.taskCoding.orchestratorAgentPresetIds.length;
  const sectionBadge = selectedProject
    ? getBadge("project", projectSources, "agents.routing")
    : getBadge(activeScope, projectSources, "agents.routing");
  const localizedSectionBadge = sectionBadge
    ? translate(settingsAgentsGuidanceMessages, "projectOverride")
    : undefined;

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
    description: translate(settingsAgentsGuidanceMessages, "routingRosterDescription"),
    disabled: selectorsDisabled,
    disabledReason: selectorsDisabled ? disabledReason : undefined,
  }));

  return (
    <SectionCard
      title={translate(settingsAgentsGuidanceMessages, "routingTitle")}
      watermark="RTE"
      badge={localizedSectionBadge}
      helpId="agent-routing"
      icon={<Route strokeWidth={2.4} />}
      accent="indigo"
      summary={translate(settingsAgentsGuidanceMessages, "routingSummary")}
      configureLabel={translate(settingsAgentsGuidanceMessages, "routingConfigure")}
      highlights={[
        { label: translate(settingsAgentsGuidanceMessages, "routingCodingMode"), value: translate(settingsAgentsGuidanceMessages, routing.taskCoding.mode === "ORCHESTRATOR" ? "routingOrchestrator" : "routingManual"), tone: "active" },
        { label: translate(settingsAgentsGuidanceMessages, "routingSpecialists"), value: routing.taskCoding.mode === "ORCHESTRATOR" ? translatePlural(settingsAgentsGuidanceMessages, "routingSelectedCount", selectedCount) : translate(settingsAgentsGuidanceMessages, routing.taskCoding.agentPresetId ? "routingCustomAgent" : "routingBuiltInWorker") },
        { label: translate(settingsAgentsGuidanceMessages, "routingProjectAgents"), value: projectAgentPresetOptions.length },
      ]}
    >
      <div className="grid min-w-0 items-start gap-4 xl:grid-cols-[minmax(14rem,17.5rem)_minmax(0,1fr)]">
        <div className="min-w-0 rounded-[1.35rem] border border-black/[0.06] bg-black/[0.02] p-4 text-xs leading-relaxed text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-slate-400">
          <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">{translate(settingsAgentsGuidanceMessages, "routingCodingTasks")}</div>
          <div className="mt-2">{translate(settingsAgentsGuidanceMessages, "routingExplanation")}</div>
          {selectedProject && activeScope !== "project" ? (
            <div role="status" className="mt-3 rounded-xl border border-signal-500/18 bg-signal-500/[0.08] px-3 py-2 text-signal-700 dark:border-signal-400/18 dark:bg-signal-400/[0.08] dark:text-signal-200">
              {translate(settingsAgentsGuidanceMessages, "routingProjectScopeStatus")}
            </div>
          ) : null}
        </div>

        <div className="min-w-0 rounded-[1.35rem] border border-black/[0.06] bg-white/78 p-4 dark:border-white/[0.06] dark:bg-void-900/52 sm:p-5 md:p-6">
          <Row label={translate(settingsAgentsGuidanceMessages, "routingTaskLabel")} description={translate(settingsAgentsGuidanceMessages, "routingTaskDescription")}>
            <OptionCardChoiceGroup
              value={routing.taskCoding.mode}
              aria-label={translate(settingsAgentsGuidanceMessages, "routingModeAria")}
              selectedSummaryLabel={translate(settingsAgentsGuidanceMessages, "routingModeSummary", {
                mode: translate(settingsAgentsGuidanceMessages, routing.taskCoding.mode === "ORCHESTRATOR" ? "routingOrchestrator" : "routingManual"),
              })}
              onChange={(value) => updateRouting((current) => ({
                ...current,
                taskCoding: { ...current.taskCoding, mode: value === "ORCHESTRATOR" ? "ORCHESTRATOR" : "MANUAL" },
              }))}
              options={[
                { value: "MANUAL", label: translate(settingsAgentsGuidanceMessages, "routingManual"), description: translate(settingsAgentsGuidanceMessages, "routingManualDescription") },
                { value: "ORCHESTRATOR", label: translate(settingsAgentsGuidanceMessages, "routingOrchestrator"), description: translate(settingsAgentsGuidanceMessages, "routingOrchestratorDescription") },
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
                aria-label={translate(settingsAgentsGuidanceMessages, "routingRosterAria")}
                selectedSummaryLabel={selectedCount === 0
                  ? translate(settingsAgentsGuidanceMessages, "routingRosterNone")
                  : translatePlural(settingsAgentsGuidanceMessages, "routingRosterCount", selectedCount)}
                helperText={translate(settingsAgentsGuidanceMessages, "routingRosterHelper")}
              />
              {options.length === 0 ? (
                <div role="status" className="mt-3 rounded-[1.15rem] border border-dashed border-black/[0.06] bg-black/[0.02] px-4 py-3 text-xs leading-relaxed text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.02] dark:text-slate-400">
                  {translate(settingsAgentsGuidanceMessages, "routingNoProjectAgents")}
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="mt-5 grid min-w-0 gap-3 md:grid-cols-2">
            {([
              ["planning", translate(settingsAgentsGuidanceMessages, "routingPlanningAgent"), translate(settingsAgentsGuidanceMessages, "routingPlanningDescription"), translate(settingsAgentsGuidanceMessages, "routingBuiltInPlanning")],
              ...(routing.taskCoding.mode === "MANUAL"
                ? [["taskCoding", translate(settingsAgentsGuidanceMessages, "routingCodingAgent"), translate(settingsAgentsGuidanceMessages, "routingCodingDescription"), translate(settingsAgentsGuidanceMessages, "routingBuiltInWorkerAgent")] as const]
                : []),
              ["ciFix", translate(settingsAgentsGuidanceMessages, "routingCiFix"), translate(settingsAgentsGuidanceMessages, "routingCiFixDescription"), translate(settingsAgentsGuidanceMessages, "routingBuiltInWorkerAgent")],
              ["mergeConflict", translate(settingsAgentsGuidanceMessages, "routingMergeConflict"), translate(settingsAgentsGuidanceMessages, "routingMergeConflictDescription"), translate(settingsAgentsGuidanceMessages, "routingBuiltInWorkerAgent")],
              ["dashboardReply", translate(settingsAgentsGuidanceMessages, "routingDashboardReply"), translate(settingsAgentsGuidanceMessages, "routingDashboardReplyDescription"), translate(settingsAgentsGuidanceMessages, "routingBuiltInProjectManager")],
              ["clarificationReply", translate(settingsAgentsGuidanceMessages, "routingClarificationReply"), translate(settingsAgentsGuidanceMessages, "routingClarificationReplyDescription"), translate(settingsAgentsGuidanceMessages, "routingBuiltInProjectManager")],
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
                  aria-label={translate(settingsAgentsGuidanceMessages, "routingPresetAria", { label })}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </SectionCard>
  );
};
