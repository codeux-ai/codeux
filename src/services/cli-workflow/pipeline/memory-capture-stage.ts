import { readFile, unlink } from "fs/promises";
import { join } from "path";
import type { MemoryCategory } from "../../../contracts/memory-types.js";
import type { PipelineContext } from "./pipeline-context.js";

export const LEARNINGS_FILENAME = ".task-learnings.md";

const VALID_CATEGORIES = new Set<MemoryCategory>([
  "architecture", "codebase", "context", "preferences", "patterns", "decision", "error", "learning",
]);

function parseCategory(header: string): MemoryCategory {
  const name = header.trim().toLowerCase();
  return VALID_CATEGORIES.has(name as MemoryCategory) ? (name as MemoryCategory) : "learning";
}

interface ParsedEntry {
  category: MemoryCategory;
  content: string;
}

export function parseLearningsMarkdown(raw: string): ParsedEntry[] {
  const entries: ParsedEntry[] = [];
  let currentCategory: MemoryCategory = "learning";

  for (const line of raw.split("\n")) {
    const headerMatch = line.match(/^##\s+Category:\s*(.+)/i);
    if (headerMatch) {
      currentCategory = parseCategory(headerMatch[1]!);
      continue;
    }

    const bulletMatch = line.match(/^[-*]\s+(.+)/);
    if (bulletMatch) {
      const content = bulletMatch[1]!.trim();
      if (content.length > 0) {
        entries.push({ category: currentCategory, content });
      }
    }
  }

  return entries;
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

  if (ctx.taskRunId && ctx.deps.executionRepository) {
    const taskRun = ctx.deps.executionRepository.getTaskRun(ctx.taskRunId);
    if (taskRun) {
      projectId = taskRun.projectId;
      sprintId = taskRun.sprintId ?? undefined;
    }
  }

  if (!projectId) {
    return { memoriesCaptured: 0 };
  }

  const filePath = join(ctx.worktreePath, LEARNINGS_FILENAME);
  let raw: string;
  try {
    raw = await readFile(filePath, "utf-8");
  } catch {
    return { memoriesCaptured: 0 };
  }

  const entries = parseLearningsMarkdown(raw);
  if (entries.length === 0) {
    await unlink(filePath).catch(() => {});
    return { memoriesCaptured: 0 };
  }

  let captured = 0;
  for (const entry of entries) {
    memoryService.createMemory(projectId, {
      scope: "sprint",
      sprintId,
      content: entry.content,
      category: entry.category,
      strength: 0.6,
      source: {
        type: "auto_capture",
        originType: "worker_learnings_file",
        originId: ctx.taskRunId || ctx.sessionId,
      },
    }).catch((err) => {
      ctx.deps.logger?.warn("Failed to capture worker learning memory", {
        sessionId: ctx.sessionId,
        error: err instanceof Error ? err.message : String(err),
      });
    });
    captured++;
  }

  await unlink(filePath).catch(() => {});

  ctx.deps.sessionTracking.appendActivity(ctx.sessionId, {
    originator: "system",
    description: `Captured ${captured} learnings from ${LEARNINGS_FILENAME}.`,
  });

  return { memoriesCaptured: captured };
}
