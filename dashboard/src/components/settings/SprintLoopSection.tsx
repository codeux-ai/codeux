import type { FunctionComponent } from "preact";
import { updateSprintLoopStep } from "../../lib/settings-updaters.js";
import { SettingsCard } from "./primitives.js";
import { loopStepOptions } from "./settings-options.js";
import type { SettingsSectionProps } from "./types.js";

export const SprintLoopSection: FunctionComponent<SettingsSectionProps> = ({ settings, onChange }) => (
  <SettingsCard
    title="Sprint Loop Steps"
    description="Every sprint loop step is independently toggleable for custom orchestration flows."
  >
    <label className="block space-y-2">
      <span className="text-xs text-slate-400">Watch Loop Interval (seconds)</span>
      <input
        type="number"
        min={1}
        max={3600}
        value={settings.sprintLoopSteps.watchLoopIntervalSeconds}
        onInput={(event) =>
          onChange(updateSprintLoopStep(settings, "watchLoopIntervalSeconds", Number(event.currentTarget.value)))
        }
        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500/50"
      />
      <p className="text-[11px] text-slate-500">
        Controls pause duration between watch-loop cycles. Lower values give faster updates but increase background activity.
      </p>
    </label>
    <label className="block space-y-2">
      <span className="text-xs text-slate-400">Watch Loop Output Interval (seconds)</span>
      <input
        type="number"
        min={60}
        max={3600}
        value={settings.sprintLoopSteps.watchLoopOutputIntervalSeconds}
        onInput={(event) =>
          onChange(updateSprintLoopStep(settings, "watchLoopOutputIntervalSeconds", Number(event.currentTarget.value)))
        }
        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500/50"
      />
      <p className="text-[11px] text-slate-500">
        Forces a periodic status return in wait mode so callers can rerun the loop. Default: 300 seconds (5 minutes).
      </p>
    </label>
    <div className="space-y-2">
      {loopStepOptions.map((step) => (
        <label key={step.key} className="flex items-start justify-between gap-3 rounded-lg border border-slate-700/70 bg-slate-950/50 px-3 py-2">
          <span className="text-sm text-slate-200">
            {step.label}
            <span className="block text-[11px] text-slate-500">{step.detail}</span>
          </span>
          <input
            type="checkbox"
            checked={settings.sprintLoopSteps[step.key]}
            onChange={(event) =>
              onChange(updateSprintLoopStep(settings, step.key, event.currentTarget.checked))
            }
            className="mt-1 h-4 w-4 rounded border-slate-700 bg-slate-900"
          />
        </label>
      ))}
    </div>
  </SettingsCard>
);
