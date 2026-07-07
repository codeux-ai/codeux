import type { PipelineContext } from "./pipeline-context.js";
import { LEARNINGS_FILENAME } from "../../../contracts/memory-types.js";
import type {
  TaskSelfReflectionSectionRating,
  UpsertTaskSelfReflectionRatingInput,
} from "../../../contracts/task-self-reflection-types.js";
import { readFile, unlink } from "fs/promises";
import { join } from "path";

interface ParsedSelfReflectionRating {
  overallRating: number;
  sections: TaskSelfReflectionSectionRating[];
}

interface LearningsContent {
  raw: string;
  unlinkAfterCapture: boolean;
}

const SELF_REFLECTION_HEADER_PATTERN = /^##\s+Self Reflection Rating\s*$/i;

function normalizeSectionLabel(label: string): string {
  return label.trim().toLowerCase().replace(/\s+/g, "-");
}

function parseRatingValue(raw: string): number | null {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return Math.min(5, Math.max(0, parsed));
}

function splitSelfReflectionSection(raw: string): { memoryMarkdown: string; ratingMarkdown: string | null } {
  const memoryLines: string[] = [];
  const ratingLines: string[] = [];
  let inRatingSection = false;

  for (const line of raw.split("\n")) {
    if (SELF_REFLECTION_HEADER_PATTERN.test(line.trim())) {
      inRatingSection = true;
      continue;
    }
    if (inRatingSection && /^##\s+/.test(line) && !SELF_REFLECTION_HEADER_PATTERN.test(line.trim())) {
      inRatingSection = false;
    }

    if (inRatingSection) {
      ratingLines.push(line);
    } else {
      memoryLines.push(line);
    }
  }

  const ratingMarkdown = ratingLines.join("\n").trim();
  return {
    memoryMarkdown: memoryLines.join("\n"),
    ratingMarkdown: ratingMarkdown.length > 0 ? ratingMarkdown : null,
  };
}

export function parseSelfReflectionRatingMarkdown(raw: string): ParsedSelfReflectionRating | null {
  let overallRating: number | null = null;
  const sections: TaskSelfReflectionSectionRating[] = [];

  for (const line of raw.split("\n")) {
    const overallMatch = line.match(/^\s*Overall\s*:\s*([+-]?\d+(?:\.\d+)?)\s*\/\s*5\b/i);
    if (overallMatch) {
      overallRating = parseRatingValue(overallMatch[1]!);
      continue;
    }

    const sectionMatch = line.match(/^\s*[-*]\s+([^:]+):\s*([+-]?\d+(?:\.\d+)?)\s*\/\s*5\b(?:\s*-\s*(.*))?\s*$/);
    if (sectionMatch) {
      const label = sectionMatch[1]!.trim().replace(/\s+/g, " ");
      const rating = parseRatingValue(sectionMatch[2]!);
      if (label.length === 0 || rating === null) {
        continue;
      }
      sections.push({
        label,
        normalizedLabel: normalizeSectionLabel(label),
        rating,
        note: sectionMatch[3]?.trim() || null,
      });
    }
  }

  if (overallRating === null) {
    return null;
  }

  return { overallRating, sections };
}

async function readLearningsContent(ctx: PipelineContext): Promise<LearningsContent | null> {
  if (ctx.worktreePath.startsWith("docker-volume://")) {
    const raw = await ctx.workspaceManager.readWorkspaceFile(ctx.worktreePath, LEARNINGS_FILENAME);
    return raw ? { raw, unlinkAfterCapture: false } : null;
  }

  try {
    return {
      raw: await readFile(join(ctx.worktreePath, LEARNINGS_FILENAME), "utf-8"),
      unlinkAfterCapture: true,
    };
  } catch {
    return null;
  }
}

function buildRatingInput(
  taskRun: { projectId: string; sprintId?: string | null; taskId?: string | null },
  sourceTaskRunId: string,
  parsed: ParsedSelfReflectionRating,
): UpsertTaskSelfReflectionRatingInput | null {
  if (!taskRun.sprintId || !taskRun.taskId) {
    return null;
  }
  return {
    projectId: taskRun.projectId,
    sprintId: taskRun.sprintId,
    taskId: taskRun.taskId,
    sourceTaskRunId,
    overallRating: parsed.overallRating,
    sections: parsed.sections,
  };
}

export async function executeMemoryCaptureStage(
  ctx: PipelineContext,
): Promise<{ memoriesCaptured: number }> {
  if (!ctx.settings.memory?.enabled || !ctx.settings.memory.autoCaptureSprint) {
    return { memoriesCaptured: 0 };
  }

  const memoryService = ctx.deps.memoryService;
  if (!memoryService) {
    return { memoriesCaptured: 0 };
  }

  let projectId: string | undefined;
  let sprintId: string | undefined;
  let taskRun: { projectId: string; sprintId?: string | null; taskId?: string | null } | null = null;

  if (ctx.taskRunId && ctx.deps.executionRepository) {
    taskRun = ctx.deps.executionRepository.getTaskRun(ctx.taskRunId);
    if (taskRun) {
      projectId = taskRun.projectId;
      sprintId = taskRun.sprintId ?? undefined;
    }
  }

  if (!projectId) {
    return { memoriesCaptured: 0 };
  }

  const learnings = await readLearningsContent(ctx);
  if (!learnings) {
    return { memoriesCaptured: 0 };
  }

  const { memoryMarkdown, ratingMarkdown } = splitSelfReflectionSection(learnings.raw);
  const captured = await memoryService.captureMemoriesFromContent(
      projectId,
      sprintId,
      ctx.agentPresetId ?? null,
      memoryMarkdown,
      ctx.taskRunId || ctx.sessionId,
    );

  if (learnings.unlinkAfterCapture) {
    await unlink(join(ctx.worktreePath, LEARNINGS_FILENAME)).catch(() => {});
  }

  if (ratingMarkdown && ctx.taskRunId && taskRun && ctx.deps.taskSelfReflectionRatingRepository) {
    const parsedRating = parseSelfReflectionRatingMarkdown(ratingMarkdown);
    const input = parsedRating ? buildRatingInput(taskRun, ctx.taskRunId, parsedRating) : null;
    if (input) {
      try {
        ctx.deps.taskSelfReflectionRatingRepository.upsertForTaskRun(input);
      } catch (error) {
        ctx.deps.logger?.warn("Failed to capture task self-reflection rating", {
          taskRunId: ctx.taskRunId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  if (captured > 0) {
    ctx.deps.sessionTracking.appendActivity(ctx.sessionId, {
      originator: "system",
      description: `Captured ${captured} learnings from ${LEARNINGS_FILENAME}.`,
    });
  }

  return { memoriesCaptured: captured };
}
