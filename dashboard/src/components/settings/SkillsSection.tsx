import type { FunctionComponent } from "preact";
import { useState } from "preact/hooks";
import type { SkillToggle } from "../../types.js";
import { SettingsCard } from "./primitives.js";
import type { SettingsSectionProps } from "./types.js";

const updateSkill = (skills: SkillToggle[], index: number, enabled: boolean): SkillToggle[] => {
  return skills.map((skill, currentIndex) => (currentIndex === index ? { ...skill, enabled } : skill));
};

export const SkillsSection: FunctionComponent<SettingsSectionProps> = ({ settings, onChange }) => {
  const [internalSkillsUnlocked, setInternalSkillsUnlocked] = useState<boolean>(false);

  const handleUnlockInternalSkills = (): void => {
    const confirmed = window.confirm(
      "Warning: Disabling internal MCP skills can break orchestration and task execution. Continue and unlock internal skill editing?"
    );
    if (confirmed) {
      setInternalSkillsUnlocked(true);
    }
  };

  const handleSkillToggle = (skill: SkillToggle, index: number, enabled: boolean): void => {
    if (skill.isInternal && !internalSkillsUnlocked) {
      return;
    }
    if (skill.isInternal) {
      const confirmed = window.confirm(
        "You are changing an internal skill. This may break core MCP behavior. Do you want to continue?"
      );
      if (!confirmed) {
        return;
      }
    }
    if (skill.name === "git_manager_remote" || skill.name === "git_manager_local") {
      const nextMode = skill.name === "git_manager_remote" ? "REMOTE" : "LOCAL";
      onChange({
        ...settings,
        git: {
          ...settings.git,
          githubMode: nextMode,
        },
        skills: settings.skills.map((entry) => {
          if (entry.name === "git_manager_remote") return { ...entry, enabled: nextMode === "REMOTE" };
          if (entry.name === "git_manager_local") return { ...entry, enabled: nextMode === "LOCAL" };
          if (entry.name === "git_manager") return { ...entry, enabled: true };
          return entry;
        }),
      });
      return;
    }

    onChange({
      ...settings,
      skills: updateSkill(settings.skills, index, enabled),
    });
  };

  return (
    <SettingsCard title="Skills">
      {!internalSkillsUnlocked && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
          <p className="text-xs text-amber-200">
            Internal skills are protected. Disabling them can break orchestration, task execution, and automation flows.
          </p>
          <button
            type="button"
            onClick={handleUnlockInternalSkills}
            className="mt-3 px-3 py-1.5 text-xs font-semibold rounded-lg border border-amber-500/40 bg-amber-500/15 text-amber-200 hover:bg-amber-500/25 transition-colors"
          >
            Unlock Internal Skills
          </button>
        </div>
      )}
      <div className="space-y-3">
        {settings.skills.length === 0 ? (
          <p className="text-sm text-slate-500">No skills configured.</p>
        ) : (
          settings.skills.map((skill, index) => (
            <label
              key={skill.name}
              className={`flex items-center justify-between rounded-lg border px-3 py-2 ${
                skill.isInternal && !internalSkillsUnlocked
                  ? "border-slate-700/50 bg-slate-950/30 opacity-70"
                  : "border-slate-700/70 bg-slate-950/50"
              }`}
            >
              <span className="text-sm text-slate-200">
                {skill.name}
                {skill.isInternal ? " (internal)" : " (custom)"}
              </span>
              <input
                type="checkbox"
                checked={skill.enabled}
                disabled={skill.name === "git_manager" || (skill.isInternal && !internalSkillsUnlocked)}
                onChange={(event) => handleSkillToggle(skill, index, event.currentTarget.checked)}
                className="h-4 w-4 rounded border-slate-700 bg-slate-900"
              />
            </label>
          ))
        )}
      </div>
    </SettingsCard>
  );
};
