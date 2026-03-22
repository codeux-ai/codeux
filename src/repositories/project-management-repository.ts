import * as path from "path";
import { randomUUID } from "crypto";
import type { DatabaseSync } from "node:sqlite";
import type {
  CreateProjectInput,
  CreateSprintInput,
  CreateTaskInput,
  ProjectCollectionResponse,
  ProjectSourceType,
  ProjectSummary,
  SprintRecord,
  TaskRecord,
  UpdateProjectInput,
  UpdateSprintInput,
  UpdateTaskInput,
} from "../contracts/project-management-types.js";
import { AppDbStorage } from "./app-db-storage.js";
import { slugify } from "../shared/slug.js";
import type { DashboardRealtimeMutationNotifier } from "../services/dashboard-realtime-service.js";

const SELECTED_PROJECT_KEY = "selected_project_id";

interface ProjectRow {
  id: string;
  slug: string;
  name: string;
  base_dir: string;
  repo_url: string | null;
  default_branch: string | null;
  feature_branch_prefix: string | null;
  status: ProjectSummary["status"];
  created_at: string;
  updated_at: string;
  source_type: ProjectSourceType | null;
  source_ref: string | null;
  sprints_count: number | string | null;
  open_tasks: number | string | null;
  completed_tasks: number | string | null;
  has_active_runs: number | string | null;
}

interface SprintRow {
  id: string;
  project_id: string;
  number: number | string | null;
  slug: string;
  name: string;
  original_prompt: string | null;
  goal: string | null;
  status: SprintRecord["status"];
  showcase_pinned: number | string | null;
  start_date: string | null;
  end_date: string | null;
  feature_branch: string | null;
  created_at: string;
  updated_at: string;
  tasks_count: number | string | null;
  completed_tasks: number | string | null;
  latest_run_status: string | null;
}

interface TaskRow {
  id: string;
  project_id: string;
  sprint_id: string;
  task_key: string;
  title: string;
  prompt_markdown: string;
  description: string | null;
  status: TaskRecord["status"];
  priority: TaskRecord["priority"];
  executor_type: TaskRecord["executorType"];
  sort_order: number | string;
  is_independent: number | string;
  is_merged: number | string;
  merge_indicator: string | null;
  source_type: string | null;
  source_path: string | null;
  created_at: string;
  updated_at: string;
}

interface DependencyRow {
  task_id: string;
  depends_on_task_id: string;
}

export class ProjectManagementRepository {
  private readonly db: DatabaseSync;

  constructor(
    storage: AppDbStorage = new AppDbStorage(),
    private readonly realtimeNotifier?: DashboardRealtimeMutationNotifier,
  ) {
    this.db = storage.getDatabase();
  }

  listProjects(): ProjectCollectionResponse {
    const rows = this.db.prepare(`
      SELECT
        p.id,
        p.slug,
        p.name,
        p.base_dir,
        p.repo_url,
        p.default_branch,
        p.feature_branch_prefix,
        p.status,
        p.created_at,
        p.updated_at,
        ps.source_type,
        ps.source_ref,
        (SELECT COUNT(*) FROM sprints s WHERE s.project_id = p.id) AS sprints_count,
        (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status = 'completed') AS completed_tasks,
        (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status != 'completed') AS open_tasks,
        (SELECT MAX(CASE WHEN sr.status IN ('running', 'queued') THEN 1 ELSE 0 END) FROM sprint_runs sr WHERE sr.project_id = p.id) AS has_active_runs
      FROM projects p
      LEFT JOIN project_sources ps ON ps.project_id = p.id
      ORDER BY p.updated_at DESC, p.name ASC
    `).all() as unknown as ProjectRow[];

    return {
      projects: rows.map((row) => this.mapProjectRow(row)),
      selectedProjectId: this.getSelectedProjectId(),
    };
  }

  getProject(projectId: string): ProjectSummary | null {
    const row = this.db.prepare(`
      SELECT
        p.id,
        p.slug,
        p.name,
        p.base_dir,
        p.repo_url,
        p.default_branch,
        p.feature_branch_prefix,
        p.status,
        p.created_at,
        p.updated_at,
        ps.source_type,
        ps.source_ref,
        (SELECT COUNT(*) FROM sprints s WHERE s.project_id = p.id) AS sprints_count,
        (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status = 'completed') AS completed_tasks,
        (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status != 'completed') AS open_tasks,
        (SELECT MAX(CASE WHEN sr.status IN ('running', 'queued') THEN 1 ELSE 0 END) FROM sprint_runs sr WHERE sr.project_id = p.id) AS has_active_runs
      FROM projects p
      LEFT JOIN project_sources ps ON ps.project_id = p.id
      WHERE p.id = ?
    `).get(projectId) as ProjectRow | undefined;

    return row ? this.mapProjectRow(row) : null;
  }

  findProjectByBaseDir(repoPath: string): ProjectSummary | null {
    const normalizedRepoPath = path.resolve(repoPath);
    const row = this.db.prepare(`
      SELECT
        p.id,
        p.slug,
        p.name,
        p.base_dir,
        p.repo_url,
        p.default_branch,
        p.feature_branch_prefix,
        p.status,
        p.created_at,
        p.updated_at,
        ps.source_type,
        ps.source_ref,
        (SELECT COUNT(*) FROM sprints s WHERE s.project_id = p.id) AS sprints_count,
        (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status = 'completed') AS completed_tasks,
        (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status != 'completed') AS open_tasks,
        (SELECT MAX(CASE WHEN sr.status IN ('running', 'queued') THEN 1 ELSE 0 END) FROM sprint_runs sr WHERE sr.project_id = p.id) AS has_active_runs
      FROM projects p
      LEFT JOIN project_sources ps ON ps.project_id = p.id
      WHERE p.base_dir = ?
         OR ps.source_ref = ?
      ORDER BY p.updated_at DESC
      LIMIT 1
    `).get(normalizedRepoPath, normalizedRepoPath) as ProjectRow | undefined;

    return row ? this.mapProjectRow(row) : null;
  }

  createProject(input: CreateProjectInput): ProjectSummary {
    const id = randomUUID();
    const now = new Date().toISOString();
    const slug = this.createUniqueProjectSlug(input.name);
    const sourceType = input.sourceType;
    const sourceRef = input.sourceRef.trim();
    const baseDir = this.resolveBaseDir(sourceType, sourceRef, input.cloneDir);
    const repoUrl = sourceType === "git" ? sourceRef : null;

    const insert = this.db.prepare(`
      INSERT INTO projects (
        id, slug, name, base_dir, repo_url, source_id, default_branch, feature_branch_prefix, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertSource = this.db.prepare(`
      INSERT INTO project_sources (id, project_id, source_type, source_ref, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);

    this.runInTransaction(() => {
      insert.run(
        id,
        slug,
        input.name.trim(),
        baseDir,
        repoUrl,
        null,
        input.defaultBranch?.trim() || "main",
        input.featureBranchPrefix?.trim() || "feature/",
        input.status || "idle",
        now,
        now
      );
      insertSource.run(randomUUID(), id, sourceType, sourceRef, now);

      if (!this.getSelectedProjectId()) {
        this.setSelectedProjectId(id);
      }
    });

    const created = this.requireProject(id);
    this.publishProjectStructureRefresh(id);
    this.publishProjectsRefresh();
    return created;
  }

  updateProject(projectId: string, input: UpdateProjectInput): ProjectSummary {
    const current = this.requireProject(projectId);
    const now = new Date().toISOString();
    const nextName = input.name?.trim() || current.name;
    const nextSlug = nextName === current.name ? current.slug : this.createUniqueProjectSlug(nextName, projectId);
    const nextSourceType = input.sourceType || current.sourceType;
    const nextSourceRef = input.sourceRef?.trim() || current.sourceRef;
    const nextBaseDir = input.baseDir?.trim() || this.resolveBaseDir(nextSourceType, nextSourceRef, undefined, current.baseDir);
    const nextRepoUrl = nextSourceType === "git" ? nextSourceRef : null;

    const updateProject = this.db.prepare(`
      UPDATE projects
      SET slug = ?, name = ?, base_dir = ?, repo_url = ?, default_branch = ?, feature_branch_prefix = ?, status = ?, updated_at = ?
      WHERE id = ?
    `);
    const updateSource = this.db.prepare(`
      UPDATE project_sources
      SET source_type = ?, source_ref = ?
      WHERE project_id = ?
    `);

    this.runInTransaction(() => {
      updateProject.run(
        nextSlug,
        nextName,
        nextBaseDir,
        nextRepoUrl,
        input.defaultBranch === undefined ? current.defaultBranch : input.defaultBranch,
        input.featureBranchPrefix === undefined ? current.featureBranchPrefix : input.featureBranchPrefix,
        input.status || current.status,
        now,
        projectId
      );
      updateSource.run(nextSourceType, nextSourceRef, projectId);
    });

    const updated = this.requireProject(projectId);
    this.publishProjectStructureRefresh(projectId);
    this.publishProjectsRefresh();
    return updated;
  }

  deleteProject(projectId: string): void {
    this.db.prepare(`DELETE FROM projects WHERE id = ?`).run(projectId);
    if (this.getSelectedProjectId() === projectId) {
      const nextProject = this.db.prepare(`SELECT id FROM projects ORDER BY updated_at DESC LIMIT 1`).get() as { id: string } | undefined;
      this.setSelectedProjectId(nextProject?.id ?? null);
    }
    this.publishProjectsRefresh();
  }

  listSprints(projectId: string): SprintRecord[] {
    const rows = this.db.prepare(`
      SELECT
        s.id,
        s.project_id,
        s.number,
        s.slug,
        s.name,
        s.original_prompt,
        s.goal,
        s.status,
        s.showcase_pinned,
        s.start_date,
        s.end_date,
        s.feature_branch,
        s.created_at,
        s.updated_at,
        COUNT(t.id) AS tasks_count,
        COALESCE(SUM(CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END), 0) AS completed_tasks,
        (
          SELECT sr.status
          FROM sprint_runs sr
          WHERE sr.sprint_id = s.id
          ORDER BY COALESCE(sr.started_at, sr.created_at) DESC, sr.created_at DESC, sr.rowid DESC
          LIMIT 1
        ) AS latest_run_status
      FROM sprints s
      LEFT JOIN tasks t ON t.sprint_id = s.id
      WHERE s.project_id = ?
      GROUP BY s.id
      ORDER BY COALESCE(s.number, 0) DESC, s.created_at DESC
    `).all(projectId) as unknown as SprintRow[];

    return rows.map((row) => this.mapSprintRow(row));
  }

  createSprint(projectId: string, input: CreateSprintInput): SprintRecord {
    this.requireProject(projectId);

    const id = randomUUID();
    const now = new Date().toISOString();
    const number = input.number ?? this.getNextSprintNumber(projectId);
    const name = input.name.trim();
    const slug = this.createUniqueSprintSlug(projectId, name);

    this.db.prepare(`
      INSERT INTO sprints (
        id, project_id, number, slug, name, original_prompt, goal, status, showcase_pinned, start_date, end_date, feature_branch, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      projectId,
      number,
      slug,
      name,
      input.originalPrompt?.trim() || null,
      input.goal?.trim() || "",
      input.status || "idle",
      Number(Boolean(input.showcasePinned)),
      input.startDate || null,
      input.endDate || null,
      input.featureBranch || null,
      now,
      now
    );

    this.touchProject(projectId, now);
    const created = this.requireSprint(id);
    this.publishProjectStructureRefresh(projectId);
    return created;
  }

  updateSprint(sprintId: string, input: UpdateSprintInput): SprintRecord {
    const current = this.requireSprint(sprintId);
    const now = new Date().toISOString();
    const nextName = input.name?.trim() || current.name;
    const nextSlug = nextName === current.name ? current.slug : this.createUniqueSprintSlug(current.projectId, nextName, sprintId);

    this.db.prepare(`
      UPDATE sprints
      SET number = ?, slug = ?, name = ?, original_prompt = ?, goal = ?, status = ?, showcase_pinned = ?, start_date = ?, end_date = ?, feature_branch = ?, updated_at = ?
      WHERE id = ?
    `).run(
      input.number === undefined ? current.number : input.number,
      nextSlug,
      nextName,
      input.originalPrompt === undefined ? current.originalPrompt : input.originalPrompt,
      input.goal === undefined ? current.goal : input.goal,
      input.status || current.status,
      input.showcasePinned === undefined ? Number(current.showcasePinned) : Number(Boolean(input.showcasePinned)),
      input.startDate === undefined ? current.startDate : input.startDate,
      input.endDate === undefined ? current.endDate : input.endDate,
      input.featureBranch === undefined ? current.featureBranch : input.featureBranch,
      now,
      sprintId
    );

    this.touchProject(current.projectId, now);
    const updated = this.requireSprint(sprintId);
    this.publishProjectStructureRefresh(current.projectId);
    return updated;
  }

  deleteSprint(sprintId: string): void {
    const sprint = this.requireSprint(sprintId);
    this.db.prepare(`DELETE FROM sprints WHERE id = ?`).run(sprintId);
    this.touchProject(sprint.projectId);
    this.publishProjectStructureRefresh(sprint.projectId);
  }

  listTasks(projectId: string, sprintId?: string): TaskRecord[] {
    this.requireProject(projectId);
    const rows = sprintId
      ? this.db.prepare(`
        SELECT *
        FROM tasks
        WHERE project_id = ? AND sprint_id = ?
        ORDER BY sort_order ASC, created_at ASC, task_key ASC
      `).all(projectId, sprintId)
      : this.db.prepare(`
        SELECT *
        FROM tasks
        WHERE project_id = ?
        ORDER BY sort_order ASC, created_at ASC, task_key ASC
      `).all(projectId);

    return this.inflateTasks(rows as unknown as TaskRow[]);
  }

  createTask(projectId: string, input: CreateTaskInput): TaskRecord {
    this.requireProject(projectId);
    const sprint = this.requireSprint(input.sprintId);
    if (sprint.projectId !== projectId) {
      throw new Error(`Sprint ${input.sprintId} does not belong to project ${projectId}`);
    }

    const id = randomUUID();
    const now = new Date().toISOString();
    const taskKey = input.taskKey?.trim() || this.createNextTaskKey(input.sprintId);
    const sortOrder = input.sortOrder ?? this.getNextSortOrder(input.sprintId);

    const insertTask = this.db.prepare(`
      INSERT INTO tasks (
        id, project_id, sprint_id, task_key, title, prompt_markdown, description, status, priority, executor_type,
        sort_order, is_independent, is_merged, merge_indicator, source_type, source_path, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertDependency = this.db.prepare(`
      INSERT INTO task_dependencies (task_id, depends_on_task_id)
      VALUES (?, ?)
    `);

    this.runInTransaction(() => {
      insertTask.run(
        id,
        projectId,
        input.sprintId,
        taskKey,
        input.title.trim(),
        input.promptMarkdown?.trim() || "",
        input.description?.trim() || "",
        input.status || "pending",
        input.priority || "medium",
        input.executorType || "auto",
        sortOrder,
        input.isIndependent === undefined ? 1 : Number(input.isIndependent),
        Number(!!input.isMerged),
        input.mergeIndicator || null,
        input.sourceType || null,
        input.sourcePath || null,
        now,
        now
      );

      for (const dependencyId of this.normalizeDependencyIds(input.dependsOnTaskIds)) {
        insertDependency.run(id, dependencyId);
      }
    });

    this.touchProject(projectId, now);
    const created = this.requireTask(id);
    this.publishProjectStructureRefresh(projectId);
    return created;
  }

  updateTask(taskId: string, input: UpdateTaskInput): TaskRecord {
    const current = this.requireTask(taskId);
    const now = new Date().toISOString();
    const updateTask = this.db.prepare(`
      UPDATE tasks
      SET title = ?, prompt_markdown = ?, description = ?, status = ?, priority = ?, executor_type = ?, sort_order = ?,
          is_independent = ?, is_merged = ?, merge_indicator = ?, source_type = ?, source_path = ?, updated_at = ?
      WHERE id = ?
    `);
    const deleteDependencies = this.db.prepare(`DELETE FROM task_dependencies WHERE task_id = ?`);
    const insertDependency = this.db.prepare(`
      INSERT INTO task_dependencies (task_id, depends_on_task_id)
      VALUES (?, ?)
    `);

    this.runInTransaction(() => {
      updateTask.run(
        input.title?.trim() || current.title,
        input.promptMarkdown === undefined ? current.promptMarkdown : input.promptMarkdown,
        input.description === undefined ? current.description : input.description,
        input.status || current.status,
        input.priority || current.priority,
        input.executorType || current.executorType,
        input.sortOrder === undefined ? current.sortOrder : input.sortOrder,
        input.isIndependent === undefined ? Number(current.isIndependent) : Number(input.isIndependent),
        input.isMerged === undefined ? Number(current.isMerged) : Number(input.isMerged),
        input.mergeIndicator === undefined ? current.mergeIndicator : input.mergeIndicator,
        input.sourceType === undefined ? current.sourceType : input.sourceType,
        input.sourcePath === undefined ? current.sourcePath : input.sourcePath,
        now,
        taskId
      );

      if (input.dependsOnTaskIds) {
        deleteDependencies.run(taskId);
        for (const dependencyId of this.normalizeDependencyIds(input.dependsOnTaskIds)) {
          insertDependency.run(taskId, dependencyId);
        }
      }
    });

    this.touchProject(current.projectId, now);
    const updated = this.requireTask(taskId);
    this.publishProjectStructureRefresh(current.projectId);
    return updated;
  }

  deleteTask(taskId: string): void {
    const task = this.requireTask(taskId);
    this.db.prepare(`DELETE FROM tasks WHERE id = ?`).run(taskId);
    this.touchProject(task.projectId);
    this.publishProjectStructureRefresh(task.projectId);
  }

  deleteTasksBySprint(sprintId: string): void {
    const sprint = this.requireSprint(sprintId);
    this.db.prepare(`DELETE FROM tasks WHERE sprint_id = ?`).run(sprintId);
    this.touchProject(sprint.projectId);
    this.publishProjectStructureRefresh(sprint.projectId);
  }

  getSelectedProjectId(): string | null {
    const row = this.db.prepare(`
      SELECT payload
      FROM app_settings
      WHERE key = ?
    `).get(SELECTED_PROJECT_KEY) as { payload: string } | undefined;

    if (!row) {
      return null;
    }

    try {
      const parsed = JSON.parse(row.payload) as { projectId?: string | null };
      return parsed.projectId ?? null;
    } catch {
      return null;
    }
  }

  setSelectedProjectId(projectId: string | null): string | null {
    if (projectId) {
      this.requireProject(projectId);
    }
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO app_settings (key, payload, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at
    `).run(
      SELECTED_PROJECT_KEY,
      JSON.stringify({ projectId }),
      now
    );

    return projectId;
  }

  notifyProjectsUpdated(): void {
    this.publishProjectsRefresh();
  }

  getSprint(sprintId: string): SprintRecord | null {
    try {
      return this.requireSprint(sprintId);
    } catch {
      return null;
    }
  }

  findSprintByProjectAndNumber(projectId: string, sprintNumber: number): SprintRecord | null {
    this.requireProject(projectId);
    const row = this.db.prepare(`
      SELECT
        s.id,
        s.project_id,
        s.number,
        s.slug,
        s.name,
        s.original_prompt,
        s.goal,
        s.status,
        s.start_date,
        s.end_date,
        s.feature_branch,
        s.created_at,
        s.updated_at,
        COUNT(t.id) AS tasks_count,
        COALESCE(SUM(CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END), 0) AS completed_tasks,
        (
          SELECT sr.status
          FROM sprint_runs sr
          WHERE sr.sprint_id = s.id
          ORDER BY COALESCE(sr.started_at, sr.created_at) DESC, sr.created_at DESC, sr.rowid DESC
          LIMIT 1
        ) AS latest_run_status
      FROM sprints s
      LEFT JOIN tasks t ON t.sprint_id = s.id
      WHERE s.project_id = ? AND s.number = ?
      GROUP BY s.id
      LIMIT 1
    `).get(projectId, sprintNumber) as SprintRow | undefined;

    return row ? this.mapSprintRow(row) : null;
  }

  getTask(taskId: string): TaskRecord | null {
    try {
      return this.requireTask(taskId);
    } catch {
      return null;
    }
  }

  private requireProject(projectId: string): ProjectSummary {
    const project = this.getProject(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }
    return project;
  }

  private requireSprint(sprintId: string): SprintRecord {
    const row = this.db.prepare(`
      SELECT
        s.id,
        s.project_id,
        s.number,
        s.slug,
        s.name,
        s.original_prompt,
        s.goal,
        s.status,
        s.showcase_pinned,
        s.start_date,
        s.end_date,
        s.feature_branch,
        s.created_at,
        s.updated_at,
        COUNT(t.id) AS tasks_count,
        COALESCE(SUM(CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END), 0) AS completed_tasks,
        (
          SELECT sr.status
          FROM sprint_runs sr
          WHERE sr.sprint_id = s.id
          ORDER BY COALESCE(sr.started_at, sr.created_at) DESC, sr.created_at DESC, sr.rowid DESC
          LIMIT 1
        ) AS latest_run_status
      FROM sprints s
      LEFT JOIN tasks t ON t.sprint_id = s.id
      WHERE s.id = ?
      GROUP BY s.id
    `).get(sprintId) as SprintRow | undefined;

    if (!row) {
      throw new Error(`Sprint not found: ${sprintId}`);
    }

    return this.mapSprintRow(row);
  }

  private requireTask(taskId: string): TaskRecord {
    const row = this.db.prepare(`
      SELECT *
      FROM tasks
      WHERE id = ?
    `).get(taskId) as TaskRow | undefined;

    if (!row) {
      throw new Error(`Task not found: ${taskId}`);
    }

    const [task] = this.inflateTasks([row]);
    return task;
  }

  private inflateTasks(rows: TaskRow[]): TaskRecord[] {
    if (rows.length === 0) {
      return [];
    }

    const dependencyRows = this.db.prepare(`
      SELECT task_id, depends_on_task_id
      FROM task_dependencies
      WHERE task_id IN (${rows.map(() => "?").join(", ")})
      ORDER BY depends_on_task_id ASC
    `).all(...rows.map((row) => row.id)) as unknown as DependencyRow[];

    const dependencyMap = new Map<string, string[]>();
    for (const row of dependencyRows) {
      const current = dependencyMap.get(row.task_id) || [];
      current.push(row.depends_on_task_id);
      dependencyMap.set(row.task_id, current);
    }

    return rows.map((row) => ({
      id: row.id,
      projectId: row.project_id,
      sprintId: row.sprint_id,
      taskKey: row.task_key,
      title: row.title,
      promptMarkdown: row.prompt_markdown,
      description: row.description || "",
      status: row.status,
      priority: row.priority,
      executorType: row.executor_type || "auto",
      sortOrder: toNumber(row.sort_order),
      dependsOnTaskIds: dependencyMap.get(row.id) || [],
      isIndependent: toBoolean(row.is_independent),
      isMerged: toBoolean(row.is_merged),
      mergeIndicator: row.merge_indicator,
      sourceType: row.source_type,
      sourcePath: row.source_path,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  private mapProjectRow(row: ProjectRow): ProjectSummary {
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      baseDir: row.base_dir,
      repoUrl: row.repo_url,
      sourceType: row.source_type || "local",
      sourceRef: row.source_ref || row.base_dir,
      defaultBranch: row.default_branch,
      featureBranchPrefix: row.feature_branch_prefix,
      status: row.status,
      sprintsCount: toNumber(row.sprints_count),
      openTasks: toNumber(row.open_tasks),
      completedTasks: toNumber(row.completed_tasks),
      isRunning: toBoolean(row.has_active_runs),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapSprintRow(row: SprintRow): SprintRecord {
    const tasksCount = toNumber(row.tasks_count);
    const completedTasks = toNumber(row.completed_tasks);

    return {
      id: row.id,
      projectId: row.project_id,
      number: row.number === null ? null : toNumber(row.number),
      slug: row.slug,
      name: row.name,
      originalPrompt: row.original_prompt || null,
      goal: row.goal || "",
      status: mapEffectiveSprintStatus(row.status, row.latest_run_status),
      showcasePinned: toBoolean(row.showcase_pinned),
      startDate: row.start_date,
      endDate: row.end_date,
      featureBranch: row.feature_branch,
      tasksCount,
      completion: tasksCount > 0 ? Math.round((completedTasks / tasksCount) * 100) : 0,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private createUniqueProjectSlug(name: string, ignoreProjectId?: string): string {
    return this.createUniqueSlug(name, `
      SELECT id
      FROM projects
      WHERE slug = ?
      ${ignoreProjectId ? "AND id != ?" : ""}
      LIMIT 1
    `, [], ignoreProjectId ? [ignoreProjectId] : []);
  }

  private createUniqueSprintSlug(projectId: string, name: string, ignoreSprintId?: string): string {
    return this.createUniqueSlug(name, `
      SELECT id
      FROM sprints
      WHERE project_id = ? AND slug = ?
      ${ignoreSprintId ? "AND id != ?" : ""}
      LIMIT 1
    `, [projectId], ignoreSprintId ? [ignoreSprintId] : []);
  }

  private createUniqueSlug(
    name: string,
    sql: string,
    leadingParams: string[],
    trailingParams: string[] = []
  ): string {
    const baseSlug = slugify(name);
    let slug = baseSlug;
    let suffix = 2;

    while (true) {
      const params = [...leadingParams, slug, ...trailingParams];
      const row = this.db.prepare(sql).get(...params) as { id: string } | undefined;
      if (!row) {
        return slug;
      }
      slug = `${baseSlug}-${suffix}`;
      suffix += 1;
    }
  }

  private getNextSprintNumber(projectId: string): number {
    const row = this.db.prepare(`
      SELECT COALESCE(MAX(number), 0) AS max_number
      FROM sprints
      WHERE project_id = ?
    `).get(projectId) as { max_number: number | string | null };

    return toNumber(row?.max_number) + 1;
  }

  private getNextSortOrder(sprintId: string): number {
    const row = this.db.prepare(`
      SELECT COALESCE(MAX(sort_order), -1) AS max_sort_order
      FROM tasks
      WHERE sprint_id = ?
    `).get(sprintId) as { max_sort_order: number | string | null };

    return toNumber(row?.max_sort_order) + 1;
  }

  private createNextTaskKey(sprintId: string): string {
    const row = this.db.prepare(`
      SELECT task_key
      FROM tasks
      WHERE sprint_id = ?
      ORDER BY created_at DESC
      LIMIT 1
    `).get(sprintId) as { task_key: string } | undefined;

    if (!row?.task_key) {
      return "T01";
    }

    const match = row.task_key.match(/(\d+)$/);
    const nextNumber = match ? Number(match[1]) + 1 : 1;
    return `T${String(nextNumber).padStart(2, "0")}`;
  }

  private normalizeDependencyIds(dependencyIds: string[] | undefined): string[] {
    const seen = new Set<string>();
    const output: string[] = [];
    for (const dependencyId of dependencyIds || []) {
      const normalized = dependencyId.trim();
      if (!normalized || seen.has(normalized)) {
        continue;
      }
      this.requireTask(normalized);
      seen.add(normalized);
      output.push(normalized);
    }
    return output;
  }

  private resolveBaseDir(
    sourceType: ProjectSourceType,
    sourceRef: string,
    cloneDir?: string,
    fallback = ""
  ): string {
    if (sourceType === "local") {
      return sourceRef;
    }

    const repoName = deriveRepoName(sourceRef);
    if (cloneDir && cloneDir.trim()) {
      return path.resolve(cloneDir.trim(), repoName);
    }

    return fallback || repoName;
  }

  private touchProject(projectId: string, updatedAt = new Date().toISOString()): void {
    this.db.prepare(`
      UPDATE projects
      SET updated_at = ?
      WHERE id = ?
    `).run(updatedAt, projectId);
  }

  private runInTransaction(callback: () => void): void {
    this.db.exec("BEGIN");
    try {
      callback();
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  private publishProjectStructureRefresh(projectId: string): void {
    this.realtimeNotifier?.scheduleProjectStructureRefresh(projectId, { includeProjects: true });
  }

  private publishProjectsRefresh(): void {
    this.realtimeNotifier?.scheduleProjectsRefresh();
  }
}

function mapEffectiveSprintStatus(
  storedStatus: SprintRecord["status"],
  latestRunStatus: string | null,
): SprintRecord["status"] {
  switch (latestRunStatus) {
    case "queued":
    case "running":
      return "running";
    case "paused":
      return "paused";
    case "cancel_requested":
    case "cancelled":
      return "cancelled";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    default:
      return storedStatus;
  }
}

function toNumber(value: number | string | null | undefined): number {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    return Number(value);
  }
  return 0;
}

function toBoolean(value: number | string | null | undefined): boolean {
  return toNumber(value) > 0;
}

function deriveRepoName(sourceRef: string): string {
  const cleaned = sourceRef
    .trim()
    .replace(/\/+$/, "")
    .replace(/\.git$/i, "");
  const segment = cleaned.split("/").pop() || cleaned;
  return slugify(segment);
}
