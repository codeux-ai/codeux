import { randomUUID } from "crypto";
import type {
  TaskSelfReflectionRating,
  TaskSelfReflectionSectionRating,
  UpsertTaskSelfReflectionRatingInput,
} from "../contracts/task-self-reflection-types.js";
import { AppDbStorage } from "./app-db-storage.js";
import type { DatabaseAdapter } from "./db/database-adapter.js";
import { executeChunkedInQuery } from "./repository-utils.js";

interface TaskSelfReflectionRatingRow {
  id: string;
  project_id: string;
  sprint_id: string;
  task_id: string;
  source_task_run_id: string;
  overall_rating: number | string;
  sections_json: string;
  captured_at: string;
  created_at: string;
  updated_at: string;
}

function normalizeRating(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(5, Math.max(0, value));
}

function normalizeSections(sections: TaskSelfReflectionSectionRating[]): TaskSelfReflectionSectionRating[] {
  return sections
    .map((section) => ({
      label: section.label.trim().replace(/\s+/g, " "),
      normalizedLabel: section.normalizedLabel.trim().toLowerCase().replace(/\s+/g, "-"),
      rating: normalizeRating(section.rating),
      note: section.note?.trim() ? section.note.trim() : null,
    }))
    .filter((section) => section.label.length > 0 && section.normalizedLabel.length > 0);
}

function parseSectionsJson(raw: string): TaskSelfReflectionSectionRating[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return normalizeSections(parsed.filter((item): item is TaskSelfReflectionSectionRating => (
      item !== null
        && typeof item === "object"
        && typeof (item as TaskSelfReflectionSectionRating).label === "string"
        && typeof (item as TaskSelfReflectionSectionRating).normalizedLabel === "string"
        && typeof (item as TaskSelfReflectionSectionRating).rating === "number"
    )));
  } catch {
    return [];
  }
}

export class TaskSelfReflectionRatingRepository {
  private readonly db: DatabaseAdapter;

  constructor(storage: AppDbStorage = new AppDbStorage()) {
    this.db = storage.getDatabase();
  }

  upsertForTaskRun(input: UpsertTaskSelfReflectionRatingInput): TaskSelfReflectionRating {
    const now = new Date().toISOString();
    const capturedAt = input.capturedAt ?? now;
    const sections = normalizeSections(input.sections);
    const existing = this.db.prepare(`
      SELECT id, created_at
      FROM task_self_reflection_ratings
      WHERE source_task_run_id = ?
    `).get(input.sourceTaskRunId) as { id: string; created_at: string } | undefined;
    const id = existing?.id ?? randomUUID();
    const createdAt = existing?.created_at ?? now;

    this.db.prepare(`
      INSERT INTO task_self_reflection_ratings (
        id, project_id, sprint_id, task_id, source_task_run_id,
        overall_rating, sections_json, captured_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source_task_run_id) DO UPDATE SET
        project_id = excluded.project_id,
        sprint_id = excluded.sprint_id,
        task_id = excluded.task_id,
        overall_rating = excluded.overall_rating,
        sections_json = excluded.sections_json,
        captured_at = excluded.captured_at,
        updated_at = excluded.updated_at
    `).run(
      id,
      input.projectId,
      input.sprintId,
      input.taskId,
      input.sourceTaskRunId,
      normalizeRating(input.overallRating),
      JSON.stringify(sections),
      capturedAt,
      createdAt,
      now,
    );

    return this.requireByTaskRun(input.sourceTaskRunId);
  }

  getByTaskRun(sourceTaskRunId: string): TaskSelfReflectionRating | null {
    const row = this.db.prepare(`
      SELECT *
      FROM task_self_reflection_ratings
      WHERE source_task_run_id = ?
    `).get(sourceTaskRunId) as TaskSelfReflectionRatingRow | undefined;

    return row ? this.mapRow(row) : null;
  }

  getLatestByTaskIds(taskIds: string[]): Map<string, TaskSelfReflectionRating> {
    const rows = executeChunkedInQuery<TaskSelfReflectionRatingRow>(
      (sql) => this.db.prepare(sql),
      {
        sqlPrefix: `
          SELECT *
          FROM (
            SELECT
              r.*,
              ROW_NUMBER() OVER (
                PARTITION BY r.task_id
                ORDER BY r.captured_at DESC, r.updated_at DESC, r.id DESC
              ) AS row_number
            FROM task_self_reflection_ratings r
            WHERE r.task_id
        `,
        items: taskIds,
        sqlSuffix: `
          )
          WHERE row_number = 1
        `,
      },
    );

    const latest = new Map<string, TaskSelfReflectionRating>();
    for (const row of rows) {
      latest.set(row.task_id, this.mapRow(row));
    }
    return latest;
  }

  private requireByTaskRun(sourceTaskRunId: string): TaskSelfReflectionRating {
    const rating = this.getByTaskRun(sourceTaskRunId);
    if (!rating) {
      throw new Error(`Task self-reflection rating not found: ${sourceTaskRunId}`);
    }
    return rating;
  }

  private mapRow(row: TaskSelfReflectionRatingRow): TaskSelfReflectionRating {
    return {
      id: row.id,
      projectId: row.project_id,
      sprintId: row.sprint_id,
      taskId: row.task_id,
      sourceTaskRunId: row.source_task_run_id,
      overallRating: normalizeRating(Number(row.overall_rating)),
      sections: parseSectionsJson(row.sections_json),
      capturedAt: row.captured_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
