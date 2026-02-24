import * as fs from "fs";
import os from "os";
import * as path from "path";
import { DatabaseSync } from "node:sqlite";
import type { DashboardSettings, SkillToggle } from "./types.js";
import { DEFAULT_SPRINT_BRANCH_SCHEME } from "./branch-scheme.js";

interface RowResult {
  payload: string;
}

const INTERNAL_SKILL_NAMES = ["orchestrator", "worker", "watch", "watch-skill", "sprint_agent_guide"] as const;
const INTERNAL_SKILL_SET = new Set<string>(INTERNAL_SKILL_NAMES);

const DEFAULT_SKILLS: SkillToggle[] = INTERNAL_SKILL_NAMES.map((name) => ({
  name,
  enabled: true,
  isInternal: true,
}));

export const DEFAULT_DASHBOARD_SETTINGS: DashboardSettings = {
  automationLevel: "SEMI_AUTO",
  aiProvider: {
    provider: "jules",
    julesApiKey: "",
  },
  git: {
    defaultBranch: "main",
    autoCreatePr: true,
    featureBranchPrefix: "feature/",
    sprintBranchScheme: DEFAULT_SPRINT_BRANCH_SCHEME,
  },
  skills: DEFAULT_SKILLS,
};

const SETTINGS_DIR = path.join(os.homedir(), "jules-subagents");
const SETTINGS_DB_PATH = path.join(SETTINGS_DIR, "settings.db");

const sanitizeSkills = (value: unknown): SkillToggle[] => {
  if (!Array.isArray(value)) return DEFAULT_SKILLS.map((skill) => ({ ...skill }));
  const validSkills = value
    .filter((item): item is SkillToggle => {
      if (!item || typeof item !== "object") return false;
      const skill = item as Partial<SkillToggle>;
      return typeof skill.name === "string" && typeof skill.enabled === "boolean";
    })
    .map((skill) => ({ name: skill.name.trim(), enabled: skill.enabled }))
    .filter((skill) => skill.name.length > 0);
  const enabledByName = new Map(validSkills.map((skill) => [skill.name, skill.enabled]));

  const internalSkills: SkillToggle[] = INTERNAL_SKILL_NAMES.map((name) => ({
    name,
    enabled: enabledByName.get(name) ?? true,
    isInternal: true,
  }));

  const customSkills: SkillToggle[] = validSkills
    .filter((skill) => !INTERNAL_SKILL_SET.has(skill.name))
    .map((skill) => ({
      name: skill.name,
      enabled: skill.enabled,
      isInternal: false,
    }))
    .sort((left, right) => left.name.localeCompare(right.name));

  return [...internalSkills, ...customSkills];
};

const cloneDefaults = (): DashboardSettings => ({
  automationLevel: DEFAULT_DASHBOARD_SETTINGS.automationLevel,
  aiProvider: { ...DEFAULT_DASHBOARD_SETTINGS.aiProvider },
  git: { ...DEFAULT_DASHBOARD_SETTINGS.git },
  skills: DEFAULT_DASHBOARD_SETTINGS.skills.map((skill) => ({ ...skill })),
});

const sanitizeSettings = (value: unknown): DashboardSettings => {
  const input = (value && typeof value === "object" ? value : {}) as Partial<DashboardSettings>;
  const automationLevel = input.automationLevel;
  const validAutomationLevel = automationLevel === "FULL" || automationLevel === "SEMI_AUTO" || automationLevel === "ALWAYS_ASK"
    ? automationLevel
    : DEFAULT_DASHBOARD_SETTINGS.automationLevel;

  const aiProviderInput = (input.aiProvider && typeof input.aiProvider === "object"
    ? input.aiProvider
    : {}) as Partial<DashboardSettings["aiProvider"]>;
  const aiProvider = {
    provider: "jules" as const,
    julesApiKey: typeof aiProviderInput.julesApiKey === "string" ? aiProviderInput.julesApiKey : "",
  };

  const gitInput = (input.git && typeof input.git === "object" ? input.git : {}) as Partial<DashboardSettings["git"]>;
  const git = {
    defaultBranch: typeof gitInput.defaultBranch === "string" && gitInput.defaultBranch.trim().length > 0
      ? gitInput.defaultBranch.trim()
      : DEFAULT_DASHBOARD_SETTINGS.git.defaultBranch,
    autoCreatePr: typeof gitInput.autoCreatePr === "boolean" ? gitInput.autoCreatePr : DEFAULT_DASHBOARD_SETTINGS.git.autoCreatePr,
    featureBranchPrefix: typeof gitInput.featureBranchPrefix === "string" && gitInput.featureBranchPrefix.trim().length > 0
      ? gitInput.featureBranchPrefix.trim()
      : DEFAULT_DASHBOARD_SETTINGS.git.featureBranchPrefix,
    sprintBranchScheme: typeof gitInput.sprintBranchScheme === "string" && gitInput.sprintBranchScheme.trim().length > 0
      ? gitInput.sprintBranchScheme.trim()
      : DEFAULT_DASHBOARD_SETTINGS.git.sprintBranchScheme,
  };

  return {
    automationLevel: validAutomationLevel,
    aiProvider,
    git,
    skills: sanitizeSkills(input.skills),
  };
};

export class SettingsRepository {
  private readonly db: DatabaseSync;

  constructor(dbPath: string = SETTINGS_DB_PATH) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS app_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        payload TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }

  getSettings(): DashboardSettings {
    const row = this.db.prepare("SELECT payload FROM app_settings WHERE id = 1").get() as RowResult | undefined;
    if (!row) {
      return cloneDefaults();
    }

    try {
      const parsed = JSON.parse(row.payload) as unknown;
      return sanitizeSettings(parsed);
    } catch {
      return cloneDefaults();
    }
  }

  saveSettings(input: DashboardSettings): DashboardSettings {
    const normalized = sanitizeSettings(input);
    this.db.prepare(`
      INSERT INTO app_settings (id, payload, updated_at)
      VALUES (1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        payload = excluded.payload,
        updated_at = excluded.updated_at
    `).run(JSON.stringify(normalized), new Date().toISOString());
    return normalized;
  }
}
