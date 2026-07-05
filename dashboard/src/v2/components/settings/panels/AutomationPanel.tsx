import type { FunctionComponent } from "preact";
import type { ProjectSettings } from "../../../../types.js";
import { SelectInput, Toggle } from "../SettingsFormFields.js";
import { Card, Row } from "./SharedPanelComponents.js";

export const AutomationPanel: FunctionComponent<{
  settings: ProjectSettings;
  update: (patch: Partial<ProjectSettings>) => void;
  getBadge: (path: string) => string | undefined;
  sourceLabel: string | undefined;
}> = ({ settings, update, getBadge, sourceLabel }) => {
  return (
      <Card
        title="Automation"
        description="Project-level operating posture and intervention policy."
        badge={sourceLabel}
      >
        <Row label="Automation level" description="Choose whether the system runs autonomously or pauses for operator approval." badge={getBadge("automationLevel")}>
          <SelectInput
            value={settings.automationLevel}
            onChange={(value) => update({ automationLevel: value as ProjectSettings["automationLevel"] })}
            options={[
              { value: "FULL", label: "Full" },
              { value: "SEMI_AUTO", label: "Semi-auto" },
              { value: "ALWAYS_ASK", label: "Always ask" },
            ]}
          />
        </Row>
        <Row label="Auto-approve plans" description="Approve planning checkpoints automatically when the sprint asks for plan confirmation." badge={getBadge("automationInterventions.autoApprovePlan")}>
          <Toggle aria-label="Toggle setting"             value={settings.automationInterventions.autoApprovePlan}
            onChange={(value) => update({
              automationInterventions: {
                ...settings.automationInterventions,
                autoApprovePlan: value,
              },
            })}
          />
        </Row>
        <Row label="Auto-resume paused runs" description="Resume paused sessions automatically after a transient pause condition clears." badge={getBadge("automationInterventions.autoResumePaused")}>
          <Toggle aria-label="Toggle setting"             value={settings.automationInterventions.autoResumePaused}
            onChange={(value) => update({
              automationInterventions: {
                ...settings.automationInterventions,
                autoResumePaused: value,
              },
            })}
          />
        </Row>
      </Card>
  );
};
