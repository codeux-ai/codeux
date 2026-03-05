import type { SprintDatabase } from "./bootstrap.js";

export interface TaskRecord {
  id: string;
  sprint_id: string;
  title: string;
  description: string | null;
  status: string;
  type: string;
  sort_index: number;
  created_at: string;
  updated_at: string;
}

export interface CreateTaskInput {
  id: string;
  sprintId: string;
  title: string;
  description?: string;
  status: string;
  type: string;
  sortIndex?: number;
}

export interface UpdateTaskInput {
  title?: string;
  description?: string | null;
  status?: string;
  type?: string;
  sortIndex?: number;
}

export class TaskRepository {
  constructor(private readonly db: SprintDatabase) {}

  public createTask(input: CreateTaskInput): void {
    const now = new Date().toISOString();
    const insertStmt = this.db.db.prepare(`
      INSERT INTO pm_tasks (id, sprint_id, title, description, status, type, sort_index, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertStmt.run(
      input.id,
      input.sprintId,
      input.title,
      input.description ?? null,
      input.status,
      input.type,
      input.sortIndex ?? 0,
      now,
      now
    );
  }

  public updateTask(taskId: string, input: UpdateTaskInput): void {
    const now = new Date().toISOString();
    const updates: string[] = [];
    const values: any[] = [];

    if (input.title !== undefined) {
      updates.push("title = ?");
      values.push(input.title);
    }
    if (input.description !== undefined) {
      updates.push("description = ?");
      values.push(input.description);
    }
    if (input.status !== undefined) {
      updates.push("status = ?");
      values.push(input.status);
    }
    if (input.type !== undefined) {
      updates.push("type = ?");
      values.push(input.type);
    }
    if (input.sortIndex !== undefined) {
      updates.push("sort_index = ?");
      values.push(input.sortIndex);
    }

    if (updates.length === 0) {
      return;
    }

    updates.push("updated_at = ?");
    values.push(now);

    const updateStmt = this.db.db.prepare(`
      UPDATE pm_tasks
      SET ${updates.join(", ")}
      WHERE id = ?
    `);

    updateStmt.run(...values, taskId);
  }

  public deleteTask(taskId: string): void {
    // Delete any dependent runs/dependencies/samples first due to foreign keys if they exist
    // However, for this task scope, we assume cascades or direct deletion is fine if no other data exists.
    // We explicitly delete runs and dependencies pointing to this task just in case.

    // Begin transaction for safe deletion
    this.db.db.exec("BEGIN TRANSACTION;");
    try {
      this.db.db.prepare("DELETE FROM pm_dependencies WHERE task_id = ? OR depends_on_task_id = ?").run(taskId, taskId);
      this.db.db.prepare("DELETE FROM pm_runs WHERE task_id = ?").run(taskId);
      this.db.db.prepare("DELETE FROM pm_usage_samples WHERE task_id = ?").run(taskId);
      this.db.db.prepare("DELETE FROM pm_tasks WHERE id = ?").run(taskId);
      this.db.db.exec("COMMIT;");
    } catch (err) {
      this.db.db.exec("ROLLBACK;");
      throw err;
    }
  }

  public getTask(taskId: string): TaskRecord | null {
    const stmt = this.db.db.prepare(`
      SELECT * FROM pm_tasks WHERE id = ?
    `);
    const row = stmt.get(taskId);
    return row ? (row as unknown as TaskRecord) : null;
  }

  public listTasks(sprintId: string): TaskRecord[] {
    const stmt = this.db.db.prepare(`
      SELECT * FROM pm_tasks WHERE sprint_id = ? ORDER BY sort_index ASC, created_at ASC
    `);
    return stmt.all(sprintId) as unknown as TaskRecord[];
  }

  public reorderTasks(sprintId: string, taskIds: string[]): void {
    // We update the sort_index for each task ID in the order provided.
    this.db.db.exec("BEGIN TRANSACTION;");
    try {
      const updateStmt = this.db.db.prepare(`
        UPDATE pm_tasks SET sort_index = ?, updated_at = ? WHERE id = ? AND sprint_id = ?
      `);

      const now = new Date().toISOString();
      for (let i = 0; i < taskIds.length; i++) {
        updateStmt.run(i, now, taskIds[i], sprintId);
      }
      this.db.db.exec("COMMIT;");
    } catch (err) {
      this.db.db.exec("ROLLBACK;");
      throw err;
    }
  }
}
