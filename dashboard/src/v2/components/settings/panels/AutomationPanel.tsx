import type { FunctionComponent } from "preact";
import type { ProjectSettings } from "../../../../types.js";
import { SelectInput, Toggle, TextAreaInput } from "../SettingsFormFields.js";
import { Card, Row, OverrideBadge } from "./SharedPanelComponents.js";

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
        <Row label="Auto-answer clarifications" description="Use the clarification template when a task asks for routine clarification." badge={getBadge("automationInterventions.autoAnswerClarification")}>
          <Toggle aria-label="Toggle setting"             value={settings.automationInterventions.autoAnswerClarification}
            onChange={(value) => update({
              automationInterventions: {
                ...settings.automationInterventions,
                autoAnswerClarification: value,
              },
            })}
          />
        </Row>
        {settings.automationInterventions.autoAnswerClarification && (
          <Row label="Clarification answer mode" description="Choose whether to use a static template or let a worker generate a contextual answer." badge={getBadge("automationInterventions.autoAnswerClarificationMode")}>
            <div className="flex gap-1 p-1 rounded-xl bg-black/[0.04] dark:bg-white/[0.04]">
              <button
                onClick={() => update({
                  automationInterventions: { ...settings.automationInterventions, autoAnswerClarificationMode: "TEMPLATE" },
                })}
                className={`px-3 py-1.5 text-xs font-semibold tracking-wide rounded-lg transition-all duration-200 ${
                  settings.automationInterventions.autoAnswerClarificationMode === "TEMPLATE"
                    ? "bg-white dark:bg-void-700 text-slate-900 dark:text-white shadow-[0_1px_4px_rgba(0,0,0,0.08)] dark:shadow-[0_1px_4px_rgba(0,0,0,0.3)]"
                    : "text-slate-500 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
                }`}
              >
                Template
              </button>
              <button
                onClick={() => update({
                  automationInterventions: { ...settings.automationInterventions, autoAnswerClarificationMode: "WORKER" },
                })}
                className={`px-3 py-1.5 text-xs font-semibold tracking-wide rounded-lg transition-all duration-200 ${
                  settings.automationInterventions.autoAnswerClarificationMode === "WORKER"
                    ? "bg-white dark:bg-void-700 text-slate-900 dark:text-white shadow-[0_1px_4px_rgba(0,0,0,0.08)] dark:shadow-[0_1px_4px_rgba(0,0,0,0.3)]"
                    : "text-slate-500 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
                }`}
              >
                Worker
              </button>
            </div>
          </Row>
        )}
        {(!settings.automationInterventions.autoAnswerClarification || settings.automationInterventions.autoAnswerClarificationMode === "TEMPLATE") && (
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">Clarification answer template</div>
              {getBadge("automationInterventions.clarificationAnswerTemplate") ? <OverrideBadge label={getBadge("automationInterventions.clarificationAnswerTemplate")!} /> : null}
            </div>
            <TextAreaInput
              value={settings.automationInterventions.clarificationAnswerTemplate}
              onChange={(value) => update({
                automationInterventions: {
                  ...settings.automationInterventions,
                  clarificationAnswerTemplate: value,
                },
              })}
            />
          </div>
        )}
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
