import type { FunctionComponent } from "preact";
import type { DashboardSettings } from "../../types.js";
import { automationOptions } from "./settings-options.js";
import { FieldLabel, SettingsCard, ToggleRow } from "./primitives.js";
import type { SettingsSectionProps } from "./types.js";

export const BasicSettingsSection: FunctionComponent<SettingsSectionProps> = ({ settings, onChange }) => (
  <SettingsCard title="Basic Settings">
    <label className="block space-y-2">
      <FieldLabel>Dashboard Port</FieldLabel>
      <input
        type="number"
        min={1}
        max={65535}
        step={1}
        value={settings.dashboardPort}
        onInput={(event) =>
          onChange({
            ...settings,
            dashboardPort: Math.max(1, Math.min(65535, Number.parseInt(event.currentTarget.value || "4444", 10) || 4444)),
          })
        }
        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500/50"
      />
      <p className="text-[11px] text-slate-500">Default `4444`. If the port is occupied, server startup automatically tries the next port.</p>
    </label>
    <label className="block space-y-2">
      <FieldLabel>Automation Level</FieldLabel>
      <select
        value={settings.automationLevel}
        onChange={(event) =>
          onChange({
            ...settings,
            automationLevel: event.currentTarget.value as DashboardSettings["automationLevel"],
          })
        }
        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500/50"
      >
        {automationOptions.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
    <div className="rounded-lg border border-slate-700/70 bg-slate-950/50 p-3 space-y-3">
      <p className="text-xs font-semibold text-slate-300">Jules Action Handling</p>
      <p className="text-[11px] text-slate-500">
        FULL auto-handles plan approvals, clarification replies, and paused sessions. ALWAYS_ASK requires human intervention. SEMI_AUTO follows the toggles below.
      </p>
      <ToggleRow
        label="Auto-approve plan requests"
        checked={settings.automationInterventions.autoApprovePlan}
        disabled={settings.automationLevel !== "SEMI_AUTO"}
        onToggle={(checked) =>
          onChange({
            ...settings,
            automationInterventions: {
              ...settings.automationInterventions,
              autoApprovePlan: checked,
            },
          })
        }
      />
      <ToggleRow
        label="Auto-answer clarification requests"
        checked={settings.automationInterventions.autoAnswerClarification}
        disabled={settings.automationLevel !== "SEMI_AUTO"}
        onToggle={(checked) =>
          onChange({
            ...settings,
            automationInterventions: {
              ...settings.automationInterventions,
              autoAnswerClarification: checked,
            },
          })
        }
      />
      <ToggleRow
        label="Auto-resume paused sessions"
        checked={settings.automationInterventions.autoResumePaused}
        disabled={settings.automationLevel !== "SEMI_AUTO"}
        onToggle={(checked) =>
          onChange({
            ...settings,
            automationInterventions: {
              ...settings.automationInterventions,
              autoResumePaused: checked,
            },
          })
        }
      />
      <label className="block space-y-2">
        <span className="text-[11px] text-slate-500">Clarification auto-answer template</span>
        <textarea
          rows={4}
          value={settings.automationInterventions.clarificationAnswerTemplate}
          disabled={settings.automationLevel !== "SEMI_AUTO" && settings.automationLevel !== "FULL"}
          onInput={(event) =>
            onChange({
              ...settings,
              automationInterventions: {
                ...settings.automationInterventions,
                clarificationAnswerTemplate: event.currentTarget.value,
              },
            })
          }
          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500/50 disabled:opacity-50"
        />
      </label>
    </div>
  </SettingsCard>
);
