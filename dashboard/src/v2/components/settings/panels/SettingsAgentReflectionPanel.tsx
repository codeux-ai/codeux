import type { FunctionComponent } from "preact";
import { Sparkles } from "lucide-preact";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../../../lib/settings.js";
import type { ProjectSettings } from "../../../../types.js";
import type { SettingsPageState } from "../../../hooks/use-settings-page-state.js";
import { SelfReflectionControls } from "./QAPanel.js";
import { SectionCard, getFieldBadge } from "./SharedPanelComponents.js";

export interface SettingsAgentReflectionPanelProps {
  state: SettingsPageState;
}

export const SettingsAgentReflectionPanel: FunctionComponent<SettingsAgentReflectionPanelProps> = ({ state }) => {
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

  const badgeFor = (path: string): string | undefined => getFieldBadge(activeScope, projectSources, path);

  return (
    <SectionCard title="Self-Reflection" watermark="REF" icon={<Sparkles strokeWidth={2.4} />}>
      <SelfReflectionControls
        title="Planning self-reflection"
        description="Optionally rates sprint planning output against editable criteria and can request improved planning before accepting it."
        settings={planning}
        update={(next) => updateReflection("planning", next)}
        getBadge={badgeFor}
        basePath="agents.selfReflection.planning"
      />
      <SelfReflectionControls
        title="QA self-reflection"
        description="Optionally rates QA review output against editable criteria and can request improved QA output before accepting it."
        settings={qualityAssurance}
        update={(next) => updateReflection("qualityAssurance", next)}
        getBadge={badgeFor}
        basePath="agents.selfReflection.qualityAssurance"
        last
      />
    </SectionCard>
  );
};
