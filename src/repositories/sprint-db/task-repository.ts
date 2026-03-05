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
  dependencies?: string[];
}

export interface UpdateTaskInput {
  title?: string;
  description?: string | null;
  status?: string;
  type?: string;
  sortIndex?: number;
  dependencies?: string[];
}

export class TaskRepository {
  constructor(private readonly db: SprintDatabase) {}

  private validateDependencies(sprintId: string, taskId: string | null, newDependencies: string[]): void {
    if (!newDependencies || newDependencies.length === 0) return;

    // Fetch all tasks in the sprint to check references and build adjacency list
    const allTasks = this.listTasks(sprintId);
    const existingTaskIds = new Set(allTasks.map(t => t.id));

    // Check for missing references
    for (const depId of newDependencies) {
      if (!existingTaskIds.has(depId)) {
        throw new Error(`Invalid dependency: Task '${depId}' does not exist in sprint '${sprintId}'.`);
      }
    }

    // Build adjacency list for cycle detection
    // Graph representation: Task -> Dependencies it points to
    const adjList: Map<string, string[]> = new Map();
    const depsStmt = this.db.db.prepare("SELECT depends_on_task_id FROM pm_dependencies WHERE task_id = ?");
    for (const task of allTasks) {
      // For tasks in the DB, fetch their dependencies using the prepared statement
      const rows = depsStmt.all(task.id) as any[];
      adjList.set(task.id, rows.map(r => r.depends_on_task_id));
    }

    // If we're updating an existing task, overwrite its dependencies in the graph with the new ones
    if (taskId) {
      adjList.set(taskId, newDependencies);
    } else {
      // If we are creating a new task, we don't have a taskId yet or it's not in the DB
      // But we can just use a dummy ID or the actual ID if provided.
      // Wait, the new task ID might not be in the listTasks output yet, so let's add it.
      // But a new task can't be part of a cycle yet unless it depends on itself.
      // Let's just say if newDependencies includes the new task itself, it's a cycle.
      if (taskId && newDependencies.includes(taskId)) {
         throw new Error(`Dependency cycle detected involving tasks: ${taskId}`);
      }
    }

    // Detect cycles using DFS
    // states: 0 = unvisited, 1 = visiting, 2 = visited
    const states = new Map<string, number>();

    const dfs = (currentId: string, path: string[]) => {
      states.set(currentId, 1);
      path.push(currentId);

      const neighbors = adjList.get(currentId) || [];
      for (const neighbor of neighbors) {
        const state = states.get(neighbor) || 0;
        if (state === 1) {
          // Cycle found!
          // Build cycle path
          const cycleStartIndex = path.indexOf(neighbor);
          const cycle = path.slice(cycleStartIndex);
          cycle.push(neighbor); // Complete the loop
          throw new Error(`Dependency cycle detected involving tasks: ${cycle.join(" -> ")}`);
        } else if (state === 0) {
          dfs(neighbor, path);
        }
      }

      states.set(currentId, 2);
      path.pop();
    };

    for (const node of adjList.keys()) {
      if (!states.has(node) || states.get(node) === 0) {
        dfs(node, []);
      }
    }
  }


  public createTask(input: CreateTaskInput): void {
    if (input.dependencies && input.dependencies.length > 0) {
      this.validateDependencies(input.sprintId, input.id, input.dependencies);
    }

    const now = new Date().toISOString();

    this.db.db.exec("BEGIN TRANSACTION;");
    try {
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

      if (input.dependencies && input.dependencies.length > 0) {
        const insertDepStmt = this.db.db.prepare(`
          INSERT INTO pm_dependencies (id, task_id, depends_on_task_id, type, created_at)
          VALUES (?, ?, ?, 'BLOCKS', ?)
        `);
        for (const depId of input.dependencies) {
          insertDepStmt.run(`dep-${input.id}-${depId}`, input.id, depId, now);
        }
      }

      this.db.db.exec("COMMIT;");
    } catch (err) {
      this.db.db.exec("ROLLBACK;");
      throw err;
    }
  }

  public updateTask(taskId: string, input: UpdateTaskInput): void {
    const now = new Date().toISOString();
    const updates: string[] = [];
    const values: any[] = [];

    // Get existing task to know sprintId for validation
    const existingTask = this.getTask(taskId);
    if (!existingTask) {
      throw new Error(`Task '${taskId}' not found.`);
    }

    if (input.dependencies !== undefined) {
      this.validateDependencies(existingTask.sprint_id, taskId, input.dependencies);
    }

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

    if (updates.length === 0 && input.dependencies === undefined) {
      return;
    }

    this.db.db.exec("BEGIN TRANSACTION;");
    try {
      if (updates.length > 0) {
        updates.push("updated_at = ?");
        values.push(now);

        const updateStmt = this.db.db.prepare(`
          UPDATE pm_tasks
          SET ${updates.join(", ")}
          WHERE id = ?
        `);

        updateStmt.run(...values, taskId);
      }

      if (input.dependencies !== undefined) {
        // Clear old dependencies
        this.db.db.prepare("DELETE FROM pm_dependencies WHERE task_id = ?").run(taskId);

        if (input.dependencies.length > 0) {
          const insertDepStmt = this.db.db.prepare(`
            INSERT INTO pm_dependencies (id, task_id, depends_on_task_id, type, created_at)
            VALUES (?, ?, ?, 'BLOCKS', ?)
          `);
          for (const depId of input.dependencies) {
            insertDepStmt.run(`dep-${taskId}-${depId}`, taskId, depId, now);
          }
        }
      }

      this.db.db.exec("COMMIT;");
    } catch (err) {
      this.db.db.exec("ROLLBACK;");
      throw err;
    }
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
