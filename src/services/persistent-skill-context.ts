import type { AgentPresetRepository } from "../repositories/agent-preset-repository.js";
import type { Logger } from "../shared/logging/logger.js";
import type {
  PersistentSkillStorageRuntime,
  PersistentSkillStorageRuntimeMount,
  SkillService,
} from "./skill-service.js";

export const PERSISTENT_SKILL_SECTION_HEADING = "## PERSISTENT SKILL STORAGE (Opt-in)";

export interface PersistentSkillContext {
  prompt: string;
  runtime: PersistentSkillStorageRuntime | null;
}

export interface PersistentSkillContextDependencies {
  agentPresetRepository?: Pick<AgentPresetRepository, "getAgentPreset">;
  skillService?: Pick<SkillService, "resolvePersistentSkillStorageRuntime">;
  logger?: Pick<Logger, "warn">;
}

export const buildPersistentSkillStorageInstruction = (
  projectId: string,
  agentPresetId: string,
  mounts: PersistentSkillStorageRuntimeMount[],
): string => {
  const storageLines = mounts.map((mount) =>
    `- ${mount.storageName} (\`${mount.storageId}\`): mounted at \`${mount.containerPath}\` in Docker and \`${mount.hostPath}\` on host runs.`,
  );

  return [
    PERSISTENT_SKILL_SECTION_HEADING,
    "This agent has persistent skill storage enabled. Use it only for reusable skills that should survive this invocation; do not treat it as project workspace state.",
    "",
    "Before creating a new skill, search existing attached skills with the `search_skills` MCP tool using:",
    `- \`projectId: ${projectId}\``,
    `- \`agentPresetId: ${agentPresetId}\``,
    "- a natural-language query for the guidance you need",
    "",
    "Attached writable storage paths:",
    ...storageLines,
    "",
    "When you create a durable new skill, prefer MCP storage APIs if `manage_skills` is available, for example `manage_skills import_markdown` with the target storage id. If MCP write access is not available, save a markdown skill file under the matching mounted storage path. Keep skill markdown concise, include searchable frontmatter, and do not duplicate an existing skill found by search.",
  ].join("\n");
};

export const composePersistentSkillPrompt = (prompt: string, instructionMarkdown: string): string => {
  const alreadyComposed = prompt
    .split(/\r?\n/u)
    .some((line) => line.trim() === PERSISTENT_SKILL_SECTION_HEADING);
  return alreadyComposed ? prompt : `${prompt}\n\n${instructionMarkdown}`;
};

export const resolvePersistentSkillContext = async (
  args: {
    projectId?: string | null;
    agentPresetId?: string | null;
    prompt: string;
  },
  deps: PersistentSkillContextDependencies,
): Promise<PersistentSkillContext> => {
  const projectId = args.projectId?.trim();
  const agentPresetId = args.agentPresetId?.trim();
  if (!projectId || !agentPresetId || !deps.skillService || !deps.agentPresetRepository) {
    return { prompt: args.prompt, runtime: null };
  }

  const agent = deps.agentPresetRepository.getAgentPreset(agentPresetId);
  if (!agent || agent.projectId !== projectId || !agent.persistentSkillStorage?.enabled) {
    return { prompt: args.prompt, runtime: null };
  }

  try {
    const runtime = await deps.skillService.resolvePersistentSkillStorageRuntime({
      projectId,
      agentPresetId: agent.id,
      enabled: true,
    });
    if (!runtime || runtime.mounts.length === 0) {
      return { prompt: args.prompt, runtime: null };
    }
    return {
      prompt: composePersistentSkillPrompt(args.prompt, runtime.instructionMarkdown),
      runtime,
    };
  } catch (error) {
    deps.logger?.warn("Failed to resolve persistent skill storage runtime", {
      projectId,
      agentPresetId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { prompt: args.prompt, runtime: null };
  }
};
