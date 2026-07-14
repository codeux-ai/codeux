import type { FunctionComponent } from "preact";
import type { ProjectSettings } from "../../../../types.js";
import { SelectInput, Toggle } from "../SettingsFormFields.js";
import { Card, Row } from "./SharedPanelComponents.js";
import { useSettingsOperationsTranslations } from "../../../i18n/messages/settings-operations.js";

export const AutomationPanel: FunctionComponent<{
  settings: ProjectSettings;
  update: (patch: Partial<ProjectSettings>) => void;
  getBadge: (path: string) => string | undefined;
  sourceLabel: string | undefined;
}> = ({ settings, update, getBadge, sourceLabel }) => {
  const { t } = useSettingsOperationsTranslations();
  return (
      <Card
        title={t("Automation")}
        description={t("Project-level operating posture and intervention policy.")}
        badge={sourceLabel}
      >
        <Row label={t("Automation level")} description={t("Choose whether the system runs autonomously or pauses for operator approval.")} badge={getBadge("automationLevel")}>
          <SelectInput
            value={settings.automationLevel}
            onChange={(value) => update({ automationLevel: value as ProjectSettings["automationLevel"] })}
            options={[
              { value: "FULL", label: t("Full") },
              { value: "SEMI_AUTO", label: t("Semi-auto") },
              { value: "ALWAYS_ASK", label: t("Always ask") },
            ]}
          />
        </Row>
        <Row label={t("Auto-approve plans")} description={t("Approve planning checkpoints automatically when the sprint asks for plan confirmation.")} badge={getBadge("automationInterventions.autoApprovePlan")}>
          <Toggle aria-label={t("Toggle setting")} value={settings.automationInterventions.autoApprovePlan}
            onChange={(value) => update({
              automationInterventions: {
                ...settings.automationInterventions,
                autoApprovePlan: value,
              },
            })}
          />
        </Row>
        <Row label={t("Auto-resume paused runs")} description={t("Resume paused sessions automatically after a transient pause condition clears.")} badge={getBadge("automationInterventions.autoResumePaused")}>
          <Toggle aria-label={t("Toggle setting")} value={settings.automationInterventions.autoResumePaused}
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
