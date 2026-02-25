import * as fs from "fs";
import os from "os";
import * as path from "path";
import { DatabaseSync } from "node:sqlite";
import type { DashboardSettings, ExternalSettingsHints, SkillToggle } from "./types.js";
import { DEFAULT_SPRINT_BRANCH_SCHEME } from "./branch-scheme.js";

interface RowResult {
  payload: string;
}

const INTERNAL_SKILL_NAMES = [
  "orchestrator",
  "worker",
  "watch",
  "watch-skill",
  "sprint_agent_guide",
  "git_manager",
  "git_manager_remote",
  "git_manager_local",
] as const;
const INTERNAL_SKILL_SET = new Set<string>(INTERNAL_SKILL_NAMES);

const DEFAULT_SKILLS: SkillToggle[] = INTERNAL_SKILL_NAMES.map((name) => ({
  name,
  enabled: name === "git_manager_local" ? false : true,
  isInternal: true,
}));

export const DEFAULT_DASHBOARD_SETTINGS: DashboardSettings = {
  automationLevel: "SEMI_AUTO",
  aiProvider: {
    provider: "jules",
    julesApiKey: "",
  },
  git: {
    githubMode: "REMOTE",
    githubToken: "",
    defaultBranch: "main",
    autoCreatePr: true,
    featureBranchPrefix: "feature/",
    sprintBranchScheme: DEFAULT_SPRINT_BRANCH_SCHEME,
  },
  ciIntelligence: {
    enabled: true,
    waitForCiBeforeMainMerge: true,
    resolveAllCommentsBeforeMainMerge: true,
    waitForCiBeforeFeatureMerge: true,
    resolveAllCommentsBeforeFeatureMerge: true,
  },
  sprintLoopSteps: {
    branchPreflight: true,
    planningPreflight: true,
    loadSubtasks: true,
    sessionSync: true,
    statusDerivation: true,
    startReadyTasks: true,
    mergeProtocol: true,
    actionRequiredProtocol: true,
    statusTable: true,
    watchLoop: true,
  },
  skills: DEFAULT_SKILLS,
};

const SETTINGS_DIR = path.join(os.homedir(), ".jules-subagents");
const SETTINGS_DB_PATH = path.join(SETTINGS_DIR, "settings.db");
const LEGACY_SETTINGS_DB_PATH = path.join(os.homedir(), "jules-subagents", "settings.db");

const readBoolean = (value: unknown, fallback: boolean): boolean => (typeof value === "boolean" ? value : fallback);

const resolveSettingsDbPath = (dbPath?: string): string => {
  if (dbPath && dbPath.trim().length > 0) {
    return dbPath;
  }

  fs.mkdirSync(SETTINGS_DIR, { recursive: true });

  if (!fs.existsSync(SETTINGS_DB_PATH) && fs.existsSync(LEGACY_SETTINGS_DB_PATH)) {
    try {
      fs.copyFileSync(LEGACY_SETTINGS_DB_PATH, SETTINGS_DB_PATH);
    } catch {
      // Continue with clean db if migration copy fails.
    }
  }

  return SETTINGS_DB_PATH;
};

const enforceGitManagerSkillset = (skills: SkillToggle[], githubMode: "REMOTE" | "LOCAL"): SkillToggle[] => {
  return skills.map((skill) => {
    if (skill.name === "git_manager_remote") {
      return { ...skill, enabled: githubMode === "REMOTE" };
    }
    if (skill.name === "git_manager_local") {
      return { ...skill, enabled: githubMode === "LOCAL" };
    }
    if (skill.name === "git_manager") {
      return { ...skill, enabled: true };
    }
    return skill;
  });
};

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

const cloneDefaults = (externalHints?: ExternalSettingsHints): DashboardSettings => ({
  automationLevel: DEFAULT_DASHBOARD_SETTINGS.automationLevel,
  aiProvider: {
    ...DEFAULT_DASHBOARD_SETTINGS.aiProvider,
    julesApiKey: externalHints?.resolved.julesApiKey || DEFAULT_DASHBOARD_SETTINGS.aiProvider.julesApiKey,
  },
  git: {
    ...DEFAULT_DASHBOARD_SETTINGS.git,
    githubToken: externalHints?.resolved.githubToken || DEFAULT_DASHBOARD_SETTINGS.git.githubToken,
  },
  ciIntelligence: {
    ...DEFAULT_DASHBOARD_SETTINGS.ciIntelligence,
  },
  sprintLoopSteps: {
    ...DEFAULT_DASHBOARD_SETTINGS.sprintLoopSteps,
  },
  skills: DEFAULT_DASHBOARD_SETTINGS.skills.map((skill) => ({ ...skill })),
});

const sanitizeSettings = (value: unknown, externalHints?: ExternalSettingsHints): DashboardSettings => {
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
    julesApiKey: typeof aiProviderInput.julesApiKey === "string"
      ? aiProviderInput.julesApiKey
      : (externalHints?.resolved.julesApiKey || ""),
  };

  const gitInput = (input.git && typeof input.git === "object" ? input.git : {}) as Partial<DashboardSettings["git"]>;
  const git = {
    githubMode: gitInput.githubMode === "LOCAL" ? "LOCAL" as const : "REMOTE" as const,
    githubToken: typeof gitInput.githubToken === "string" ? gitInput.githubToken : (externalHints?.resolved.githubToken || ""),
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

  const ciInput = (input.ciIntelligence && typeof input.ciIntelligence === "object"
    ? input.ciIntelligence
    : {}) as Partial<DashboardSettings["ciIntelligence"]>;
  const ciIntelligence = {
    enabled: readBoolean(ciInput.enabled, DEFAULT_DASHBOARD_SETTINGS.ciIntelligence.enabled),
    waitForCiBeforeMainMerge: readBoolean(
      ciInput.waitForCiBeforeMainMerge,
      DEFAULT_DASHBOARD_SETTINGS.ciIntelligence.waitForCiBeforeMainMerge
    ),
    resolveAllCommentsBeforeMainMerge: readBoolean(
      ciInput.resolveAllCommentsBeforeMainMerge,
      DEFAULT_DASHBOARD_SETTINGS.ciIntelligence.resolveAllCommentsBeforeMainMerge
    ),
    waitForCiBeforeFeatureMerge: readBoolean(
      ciInput.waitForCiBeforeFeatureMerge,
      DEFAULT_DASHBOARD_SETTINGS.ciIntelligence.waitForCiBeforeFeatureMerge
    ),
    resolveAllCommentsBeforeFeatureMerge: readBoolean(
      ciInput.resolveAllCommentsBeforeFeatureMerge,
      DEFAULT_DASHBOARD_SETTINGS.ciIntelligence.resolveAllCommentsBeforeFeatureMerge
    ),
  };

  const loopInput = (input.sprintLoopSteps && typeof input.sprintLoopSteps === "object"
    ? input.sprintLoopSteps
    : {}) as Partial<DashboardSettings["sprintLoopSteps"]>;
  const sprintLoopSteps = {
    branchPreflight: readBoolean(loopInput.branchPreflight, DEFAULT_DASHBOARD_SETTINGS.sprintLoopSteps.branchPreflight),
    planningPreflight: readBoolean(loopInput.planningPreflight, DEFAULT_DASHBOARD_SETTINGS.sprintLoopSteps.planningPreflight),
    loadSubtasks: readBoolean(loopInput.loadSubtasks, DEFAULT_DASHBOARD_SETTINGS.sprintLoopSteps.loadSubtasks),
    sessionSync: readBoolean(loopInput.sessionSync, DEFAULT_DASHBOARD_SETTINGS.sprintLoopSteps.sessionSync),
    statusDerivation: readBoolean(loopInput.statusDerivation, DEFAULT_DASHBOARD_SETTINGS.sprintLoopSteps.statusDerivation),
    startReadyTasks: readBoolean(loopInput.startReadyTasks, DEFAULT_DASHBOARD_SETTINGS.sprintLoopSteps.startReadyTasks),
    mergeProtocol: readBoolean(loopInput.mergeProtocol, DEFAULT_DASHBOARD_SETTINGS.sprintLoopSteps.mergeProtocol),
    actionRequiredProtocol: readBoolean(loopInput.actionRequiredProtocol, DEFAULT_DASHBOARD_SETTINGS.sprintLoopSteps.actionRequiredProtocol),
    statusTable: readBoolean(loopInput.statusTable, DEFAULT_DASHBOARD_SETTINGS.sprintLoopSteps.statusTable),
    watchLoop: readBoolean(loopInput.watchLoop, DEFAULT_DASHBOARD_SETTINGS.sprintLoopSteps.watchLoop),
  };

  const normalizedSkills = enforceGitManagerSkillset(sanitizeSkills(input.skills), git.githubMode);

  return {
    automationLevel: validAutomationLevel,
    aiProvider,
    git,
    ciIntelligence,
    sprintLoopSteps,
    skills: normalizedSkills,
  };
};

export class SettingsRepository {
  private readonly db: DatabaseSync;
  private readonly externalHints: ExternalSettingsHints | undefined;

  constructor(dbPath?: string, externalHints?: ExternalSettingsHints) {
    const resolvedDbPath = resolveSettingsDbPath(dbPath);
    fs.mkdirSync(path.dirname(resolvedDbPath), { recursive: true });
    this.db = new DatabaseSync(resolvedDbPath);
    this.externalHints = externalHints;
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
      return cloneDefaults(this.externalHints);
    }

    try {
      const parsed = JSON.parse(row.payload) as unknown;
      return sanitizeSettings(parsed, this.externalHints);
    } catch {
      return cloneDefaults(this.externalHints);
    }
  }

  saveSettings(input: DashboardSettings): DashboardSettings {
    const normalized = sanitizeSettings(input, this.externalHints);
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
