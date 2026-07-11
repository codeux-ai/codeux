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
    `- ${mount.storageName} (\`${mount.storageId}\`, revision \`${mount.revision.slice(0, 12)}\`): readable at \`${mount.containerPath}\` in containerized runs.`,
  );

  return [
    PERSISTENT_SKILL_SECTION_HEADING,
    "This agent has persistent skill storage enabled. Use it only for reusable skills that should survive this invocation; do not treat it as project workspace state.",
    "",
    "Use the `search_skills` MCP tool before applying or creating skill guidance. Do not claim storage is unavailable until that tool returns an error. Search using:",
    `- \`projectId: ${projectId}\``,
    `- \`agentPresetId: ${agentPresetId}\``,
    "- a natural-language query for the guidance you need",
    "",
    "Attached versioned storage snapshots:",
    ...storageLines,
    "",
    "Storage mounts are read-only snapshots. Create or update durable skills through `manage_skills` so Code UX can validate, version, and re-index every change. Keep skill markdown concise, include searchable frontmatter, and do not duplicate an existing skill found by search.",
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
