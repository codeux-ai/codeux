import type { DashboardSettings, SkillToggle } from "../../../contracts/app-types.js";
import { DEFAULT_SKILLS, INTERNAL_SKILL_NAMES } from "../../../repositories/settings-defaults.js";

export function cloneSkills(skills: SkillToggle[]): SkillToggle[] {
  return skills.map((skill) => ({ ...skill }));
}

export function sanitizeSkills(value: unknown, githubMode?: DashboardSettings["git"]["githubMode"]): SkillToggle[] {
  const input = Array.isArray(value) ? value : DEFAULT_SKILLS;
  const validSkills = input
    .filter((item): item is SkillToggle => {
      if (!item || typeof item !== "object") {
        return false;
      }
      const skill = item as Partial<SkillToggle>;
      return typeof skill.name === "string" && typeof skill.enabled === "boolean";
    })
    .map((skill) => ({
      name: skill.name.trim(),
      enabled: skill.enabled,
      isInternal: Boolean(skill.isInternal),
    }))
    .filter((skill) => skill.name.length > 0);

  const enabledByName = new Map(validSkills.map((skill) => [skill.name, skill.enabled]));
  const internalSkills: SkillToggle[] = INTERNAL_SKILL_NAMES.map((name) => ({
    name,
    enabled: enabledByName.get(name) ?? true,
    isInternal: true,
  }));

  const customSkills = validSkills
    .filter((skill) => !INTERNAL_SKILL_NAMES.includes(skill.name as any))
    .map((skill) => ({ ...skill, isInternal: false }))
    .sort((left, right) => left.name.localeCompare(right.name));

  const normalized = [...internalSkills, ...customSkills];

  if (githubMode) {
    return enforceGitManagerSkillset(normalized, githubMode);
  }
  return normalized;
}

export const enforceGitManagerSkillset = (skills: SkillToggle[], githubMode: "REMOTE" | "LOCAL"): SkillToggle[] => {
  const needsLocal = githubMode === "LOCAL";
  return skills.map((skill) => {
    if (skill.name === "git_manager_remote") {
      return { ...skill, enabled: !needsLocal };
    }
    if (skill.name === "git_manager_local") {
      return { ...skill, enabled: needsLocal };
    }
    if (skill.name === "git_manager") {
      return { ...skill, enabled: true }; // Legacy compat
    }
    return skill;
  });
};
