import type { FunctionComponent } from "preact";
import { Sparkles } from "lucide-preact";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../../../lib/settings.js";
import type { ProjectSettings } from "../../../../types.js";
import type { SettingsPageState } from "../../../hooks/use-settings-page-state.js";
import { useDashboardI18n } from "../../../i18n/index.js";
import { settingsAgentsGuidanceMessages } from "../../../i18n/messages/settings-agents-guidance.js";
import { getFieldSourceLabel } from "../../../lib/settings-view-models.js";
import { SelfReflectionControls } from "./QAPanel.js";
import { SectionCard } from "./SharedPanelComponents.js";

export interface SettingsAgentReflectionPanelProps {
  state: SettingsPageState;
}

export const SettingsAgentReflectionPanel: FunctionComponent<SettingsAgentReflectionPanelProps> = ({ state }) => {
  const { locale, translate } = useDashboardI18n();
  const {
    activeScope,
    setActiveScope,
    selectedProject,
    editableSettings,
    projectSettings,
    projectSources,
    updateProject,
    updateEditableSettings,
  } = state;
  if (!editableSettings) return null;

  const planning = projectSettings?.agents.selfReflection?.planning
    ?? editableSettings.agents.selfReflection?.planning
    ?? DEFAULT_DASHBOARD_SETTINGS.agents.selfReflection.planning;
  const qualityAssurance = projectSettings?.agents.selfReflection?.qualityAssurance
    ?? editableSettings.agents.selfReflection?.qualityAssurance
    ?? DEFAULT_DASHBOARD_SETTINGS.agents.selfReflection.qualityAssurance;

  const updateReflection = (
    key: keyof ProjectSettings["agents"]["selfReflection"],
    next: ProjectSettings["agents"]["selfReflection"]["planning"],
  ): void => {
    if (selectedProject && projectSettings) {
      if (activeScope !== "project") setActiveScope("project");
      updateProject((current) => ({
        ...current,
        agents: {
          ...current.agents,
          selfReflection: {
            ...(current.agents.selfReflection ?? DEFAULT_DASHBOARD_SETTINGS.agents.selfReflection),
            [key]: next,
          },
        },
      }));
      return;
    }
    updateEditableSettings((current) => ({
      ...current,
      agents: {
        ...current.agents,
        selfReflection: {
          ...(current.agents.selfReflection ?? DEFAULT_DASHBOARD_SETTINGS.agents.selfReflection),
          [key]: next,
        },
      },
    }));
  };

  const badgeFor = (path: string): string | undefined => {
    if (activeScope !== "project") return undefined;
    return getFieldSourceLabel(projectSources[path], "project", locale) ?? undefined;
  };
  return (
    <SectionCard
      title={translate(settingsAgentsGuidanceMessages, "reflectionTitle")}
      watermark="REF"
      icon={<Sparkles strokeWidth={2.4} />}
      accent="fuchsia"
      summary={translate(settingsAgentsGuidanceMessages, "reflectionSummary")}
      configureLabel={translate(settingsAgentsGuidanceMessages, "reflectionConfigure")}
      highlights={[
        { label: translate(settingsAgentsGuidanceMessages, "reflectionPlanning"), value: translate(settingsAgentsGuidanceMessages, planning.enabled ? "enabled" : "off"), tone: planning.enabled ? "active" : "neutral" },
        { label: translate(settingsAgentsGuidanceMessages, "reflectionQa"), value: translate(settingsAgentsGuidanceMessages, qualityAssurance.enabled ? "enabled" : "off"), tone: qualityAssurance.enabled ? "active" : "neutral" },
        { label: translate(settingsAgentsGuidanceMessages, "reflectionCriteria"), value: translate(settingsAgentsGuidanceMessages, "reflectionCriteriaTotal", { count: planning.criteria.length + qualityAssurance.criteria.length }) },
      ]}
    >
      <SelfReflectionControls
        title={translate(settingsAgentsGuidanceMessages, "reflectionPlanningTitle")}
        description={translate(settingsAgentsGuidanceMessages, "reflectionPlanningDescription")}
        settings={planning}
        update={(next) => updateReflection("planning", next)}
        getBadge={badgeFor}
        basePath="agents.selfReflection.planning"
      />
      <SelfReflectionControls
        title={translate(settingsAgentsGuidanceMessages, "reflectionQaTitle")}
        description={translate(settingsAgentsGuidanceMessages, "reflectionQaDescription")}
        settings={qualityAssurance}
        update={(next) => updateReflection("qualityAssurance", next)}
        getBadge={badgeFor}
        basePath="agents.selfReflection.qualityAssurance"
        last
      />
    </SectionCard>
  );
};
