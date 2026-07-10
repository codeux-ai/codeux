import * as path from "path";
import os from "os";
import { randomUUID } from "crypto";
import { createLogger, type Logger } from "../shared/logging/logger.js";
import { ValidationError, EntityNotFoundError, RepositoryError, parsePayloadJson } from "./repository-utils.js";
import { DatabaseAdapter } from "./db/database-adapter.js";
import type {
  CreateProjectInput,
  CreateSprintInput,
  CreateTaskInput,
  LinkedIssueProvider,
  LinkedIssueSourceKind,
  ProjectCollectionResponse,
  ProjectSourceType,
  ProjectSummary,
  SprintLinkedIssueInput,
  SprintImportedTaskInput,
  SprintImportedTaskKind,
  SprintLinkedIssueRecord,
  SprintRecord,
  SprintCollectionResponse,
  TaskRecord,
  UpdateProjectInput,
  UpdateSprintInput,
  UpdateTaskInput,
  SprintReviewSummary,
} from "../contracts/project-management-types.js";
import { AppDbStorage } from "./app-db-storage.js";
import { slugify } from "../shared/slug.js";
import type { DashboardRealtimeMutationNotifier } from "../services/dashboard-realtime-service.js";
import { toNumber, toBoolean } from "./repository-utils.js";
import { SettingsRepository } from "./settings-repository.js";
import { ProjectWorkerAssignmentRepository } from "./project-worker-assignment-repository.js";
import type { ProjectSettingsOverride } from "../contracts/settings-scope-types.js";
import type { ProjectWorkerAssignmentRecord } from "../contracts/worker-types.js";
import { resolveRepositoryHost } from "../infrastructure/git/repository-host-resolver.js";
import { readLocalGitOriginUrl } from "../infrastructure/git/local-git-origin.js";
import { loadProjectSummaryAggregationMap, projectSummaryQuery, type ProjectSummaryAggregation } from "./project-management/project-summary-query.js";
import { loadSprintSummaryAggregationMap, sprintSummaryQuery, type SprintSummaryAggregation } from "./project-management/sprint-summary-query.js";
import { validateTaskDependencies } from "./project-management/task-dependency-graph.js";
import { getHomeCodeUxPath } from "../shared/config/code-ux-paths.js";
import { TaskSelfReflectionRatingRepository } from "./task-self-reflection-rating-repository.js";

const SELECTED_PROJECT_KEY = "selected_project_id";
const GENERATED_SPRINT_NAME_PREFIX = "Untitled sprint";

export function createGeneratedSprintName(sprintNumber: number | null | undefined): string {
  return typeof sprintNumber === "number" && Number.isFinite(sprintNumber)
    ? `${GENERATED_SPRINT_NAME_PREFIX} ${Math.trunc(sprintNumber)}`
    : GENERATED_SPRINT_NAME_PREFIX;
}

export function isGeneratedSprintName(name: string | null | undefined): boolean {
  const trimmed = typeof name === "string" ? name.trim() : "";
  return trimmed === GENERATED_SPRINT_NAME_PREFIX || /^Untitled sprint \d+$/.test(trimmed);
}

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
}

interface SprintRow {
  id: string;
  project_id: string;
  number: number | string | null;
  slug: string;
  name: string;
  is_generated_name: number | string;
  original_prompt: string | null;
  goal: string | null;
  status: SprintRecord["status"];
  showcase_pinned: number | string | null;
  start_date: string | null;
  end_date: string | null;
  feature_branch: string | null;
  base_commit_sha: string | null;
  created_at: string;
  updated_at: string;
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
  agent_preset_id: string | null;
  sort_order: number | string;
  is_independent: number | string;
  is_merged: number | string;
  merge_indicator: string | null;
  source_type: string | null;
  source_path: string | null;
  model: string | null;
  created_at: string;
  updated_at: string;
}

interface DependencyRow {
  task_id: string;
  depends_on_task_id: string;
}

interface TaskReviewSummaryRow {
  task_id: string;
  latest_task_review_json: string | null;
}

interface LinkedIssueRow {
  id: string;
  project_id: string;
  sprint_id: string;
  provider: SprintLinkedIssueRecord["provider"];
  host_domain: string;
  project_key: string | null;
  repository: string;
  issue_number: number | string | null;
  external_id: string | null;
  source_kind: string | null;
  issue_key: string;
  title: string;
  url: string;
  state: string;
  labels_json: string | null;
  assignees_json: string | null;
  issue_body_markdown: string | null;
  issue_conversation_markdown: string | null;
  include_conversation: number | string | null;
  issue_author: string | null;
  issue_created_at: string | null;
  issue_updated_at: string | null;
  metadata_json: string | null;
  imported_at: string;
  closed_at: string | null;
  close_state: SprintLinkedIssueRecord["closeState"];
  close_error: string | null;
  updated_at: string;
}

export class ProjectManagementRepository {
  private readonly db: DatabaseAdapter;

  constructor(
    private readonly storage: AppDbStorage = new AppDbStorage(),
    private readonly realtimeNotifier?: DashboardRealtimeMutationNotifier,
    private readonly settingsRepository: SettingsRepository = new SettingsRepository(),
    private readonly projectWorkerAssignmentRepository: ProjectWorkerAssignmentRepository = new ProjectWorkerAssignmentRepository(storage),
    private readonly logger: Logger = createLogger({ bindings: { component: "ProjectManagementRepository" } }),
    private readonly taskSelfReflectionRatingRepository: TaskSelfReflectionRatingRepository = new TaskSelfReflectionRatingRepository(storage)
  ) {
    this.db = storage.getDatabase();
  }

  listProjects(): ProjectCollectionResponse {
    const rows = this.db.prepare(`
      ${projectSummaryQuery.select}
      ${projectSummaryQuery.from}
      ORDER BY p.updated_at DESC, p.name ASC
    `).all() as unknown as ProjectRow[];

    return {
      projects: this.hydrateProjects(rows),
      selectedProjectId: this.getSelectedProjectId(),
    };
  }

  getProject(projectId: string): ProjectSummary | null {
    const row = this.db.prepare(`
      ${projectSummaryQuery.select}
      ${projectSummaryQuery.from}
      WHERE p.id = ?
    `).get(projectId) as ProjectRow | undefined;

    if (!row) return null;
    return this.hydrateProjects([row])[0];
  }

  findProjectByBaseDir(repoPath: string): ProjectSummary | null {
    const normalizedRepoPath = path.resolve(repoPath);
    // Also match paths stored with a trailing slash
    const withTrailingSlash = normalizedRepoPath + "/";
    const row = this.db.prepare(`
      ${projectSummaryQuery.select}
      ${projectSummaryQuery.from}
      WHERE p.base_dir IN (?, ?)
         OR ps.source_ref IN (?, ?)
      ORDER BY p.updated_at DESC
      LIMIT 1
    `).get(normalizedRepoPath, withTrailingSlash, normalizedRepoPath, withTrailingSlash) as ProjectRow | undefined;

    if (!row) return null;
    return this.hydrateProjects([row])[0];
  }

  createProject(input: CreateProjectInput): ProjectSummary {
    try {
      const id = randomUUID();
      const now = new Date().toISOString();
      const slug = this.createUniqueProjectSlug(input.name);
      const sourceType = input.sourceType;
      const sourceRef = input.sourceRef.trim();
      const baseDir = this.resolveBaseDir(sourceType, sourceRef, slug, input.cloneDir);
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

        if (input.settingsOverrides) {
          this.settingsRepository.saveProjectSettings(id, input.settingsOverrides);
        }
      });

      const created = this.requireProject(id);
      this.publishProjectStructureRefresh(id);
      this.publishProjectsRefresh();
      return created;
      } catch (error) {
      if (error instanceof RepositoryError) throw error;
      if (error instanceof Error && (error.message.toLowerCase().includes('depend') || error.message.includes('constraint failed') || error.message.includes('FOREIGN KEY'))) throw new ValidationError(error.message);
      this.logger.error("Operation failed", { error, projectName: input.name });
      throw new RepositoryError(error instanceof Error ? error.message : "Operation failed", error);
    }
  }

  updateProject(projectId: string, input: UpdateProjectInput): ProjectSummary {
    try {
      const current = this.requireProject(projectId);
      const now = new Date().toISOString();
      const nextName = input.name?.trim() || current.name;
      const nextSlug = nextName === current.name ? current.slug : this.createUniqueProjectSlug(nextName, projectId);
      const nextSourceType = input.sourceType || current.sourceType;
      const nextSourceRef = input.sourceRef?.trim() || current.sourceRef;
      const nextBaseDir = input.baseDir?.trim() || this.resolveBaseDir(nextSourceType, nextSourceRef, nextSlug, undefined, current.baseDir);
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
      } catch (error) {
      if (error instanceof RepositoryError) throw error;
      if (error instanceof Error && (error.message.toLowerCase().includes('depend') || error.message.includes('constraint failed') || error.message.includes('FOREIGN KEY'))) throw new ValidationError(error.message);
      this.logger.error("Operation failed", { error, projectId });
      throw new RepositoryError(error instanceof Error ? error.message : "Operation failed", error);
    }
  }

  deleteProject(projectId: string): void {
    try {
      this.db.prepare(`DELETE FROM projects WHERE id = ?`).run(projectId);
      if (this.getSelectedProjectId() === projectId) {
        const nextProject = this.db.prepare(`SELECT id FROM projects ORDER BY updated_at DESC LIMIT 1`).get() as { id: string } | undefined;
        this.setSelectedProjectId(nextProject?.id ?? null);
      }
      this.publishProjectsRefresh();
      } catch (error) {
      if (error instanceof RepositoryError) throw error;
      if (error instanceof Error && (error.message.toLowerCase().includes('depend') || error.message.includes('constraint failed') || error.message.includes('FOREIGN KEY'))) throw new ValidationError(error.message);
      this.logger.error("Operation failed", { error, projectId });
      throw new RepositoryError(error instanceof Error ? error.message : "Operation failed", error);
    }
  }

  listSprints(projectId: string): SprintCollectionResponse {
    const selectedSprintId = this.getSelectedSprintId(projectId);
    const rows = this.db.prepare(`
      ${sprintSummaryQuery.select}
      ${sprintSummaryQuery.from}
      WHERE s.project_id = ?
      ORDER BY COALESCE(s.number, 0) DESC, s.created_at DESC
    `).all(projectId) as unknown as SprintRow[];

    return {
      sprints: this.hydrateSprints(rows),
      selectedSprintId,
    };
  }

  createSprint(projectId: string, input: CreateSprintInput): SprintRecord {
    try {
      this.requireProject(projectId);

      const id = randomUUID();
      const now = new Date().toISOString();
      const nextSprintNumber = this.getNextSprintNumber(projectId);
      const number = typeof input.number === "number" && input.number > nextSprintNumber - 1
        ? input.number
        : nextSprintNumber;
      const userProvidedName = input.name?.trim() || "";
      const name = userProvidedName || createGeneratedSprintName(number);
      const isGeneratedName = userProvidedName.length === 0;
      const slug = input.slug ? input.slug.toLowerCase() : this.createUniqueSprintSlug(projectId, name);

      this.db.prepare(`
        INSERT INTO sprints (
          id, project_id, number, slug, name, is_generated_name, original_prompt, goal, status, showcase_pinned, start_date, end_date, feature_branch, base_commit_sha, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        projectId,
        number,
        slug,
        name,
        Number(isGeneratedName),
        input.originalPrompt?.trim() || null,
        input.goal?.trim() || "",
        input.status || "idle",
        Number(Boolean(input.showcasePinned)),
        input.startDate || null,
        input.endDate || null,
        input.featureBranch || null,
        input.baseCommitSha || null,
        now,
        now
      );

      this.touchProject(projectId, now);
      const created = this.requireSprint(id);
      if (input.linkedIssues) {
        this.replaceSprintLinkedIssues(projectId, id, input.linkedIssues);
        created.linkedIssues = this.listSprintLinkedIssues(projectId, id);
      }
      this.setSelectedSprintId(projectId, id);
      this.publishProjectStructureRefresh(projectId);
      return created;
      } catch (error) {
      if (error instanceof RepositoryError) throw error;
      if (error instanceof Error && (error.message.toLowerCase().includes('depend') || error.message.includes('constraint failed') || error.message.includes('FOREIGN KEY'))) throw new ValidationError(error.message);
      this.logger.error("Operation failed", { error, projectId });
      throw new RepositoryError(error instanceof Error ? error.message : "Operation failed", error);
    }
  }

  updateSprint(sprintId: string, input: UpdateSprintInput): SprintRecord {
    try {
      const current = this.requireSprint(sprintId);
      const now = new Date().toISOString();
      const nextName = input.name?.trim() || current.name;
      const nextIsGeneratedName = input.name === undefined ? current.isGeneratedName : false;
      const nextSlug = input.slug
        ? input.slug.toLowerCase()
        : (nextName === current.name ? current.slug : this.createUniqueSprintSlug(current.projectId, nextName, sprintId));

      this.db.prepare(`
        UPDATE sprints
        SET number = ?, slug = ?, name = ?, is_generated_name = ?, original_prompt = ?, goal = ?, status = ?, showcase_pinned = ?, start_date = ?, end_date = ?, feature_branch = ?, base_commit_sha = ?, updated_at = ?
        WHERE id = ?
      `).run(
        input.number === undefined ? current.number : input.number,
        nextSlug,
        nextName,
        Number(nextIsGeneratedName),
        input.originalPrompt === undefined ? current.originalPrompt : input.originalPrompt,
        input.goal === undefined ? current.goal : input.goal,
        input.status || current.status,
        input.showcasePinned === undefined ? Number(current.showcasePinned) : Number(Boolean(input.showcasePinned)),
        input.startDate === undefined ? current.startDate : input.startDate,
        input.endDate === undefined ? current.endDate : input.endDate,
        input.featureBranch === undefined ? current.featureBranch : input.featureBranch,
        input.baseCommitSha === undefined ? current.baseCommitSha : input.baseCommitSha,
        now,
        sprintId
      );

      this.touchProject(current.projectId, now);
      const updated = this.requireSprint(sprintId);
      if (input.linkedIssues) {
        this.replaceSprintLinkedIssues(current.projectId, sprintId, input.linkedIssues);
        updated.linkedIssues = this.listSprintLinkedIssues(current.projectId, sprintId);
      }
      this.publishProjectStructureRefresh(current.projectId);
      return updated;
      } catch (error) {
      if (error instanceof RepositoryError) throw error;
      if (error instanceof Error && (error.message.toLowerCase().includes('depend') || error.message.includes('constraint failed') || error.message.includes('FOREIGN KEY'))) throw new ValidationError(error.message);
      this.logger.error("Operation failed", { error, sprintId });
      throw new RepositoryError(error instanceof Error ? error.message : "Operation failed", error);
    }
  }

  deleteSprint(sprintId: string): void {
    try {
      const sprint = this.requireSprint(sprintId);
      const activeRun = this.db.prepare(`
        SELECT id, status
        FROM sprint_runs
        WHERE sprint_id = ?
          AND status IN ('queued', 'running', 'cancel_requested')
        ORDER BY created_at DESC, rowid DESC
        LIMIT 1
      `).get(sprintId) as { id: string; status: string } | undefined;
      if (activeRun) {
        throw new ValidationError(`Sprint ${sprintId} has active run ${activeRun.id} (${activeRun.status}); cancel, pause, or finish it before deleting the sprint.`);
      }

      const activeDispatch = this.db.prepare(`
        SELECT id, status
        FROM task_dispatches
        WHERE sprint_id = ?
          AND status IN ('queued', 'claimed', 'running', 'cancel_requested', 'paused')
        ORDER BY updated_at DESC, created_at DESC
        LIMIT 1
      `).get(sprintId) as { id: string; status: string } | undefined;
      if (activeDispatch) {
        throw new ValidationError(`Sprint ${sprintId} has active task dispatch ${activeDispatch.id} (${activeDispatch.status}); cancel or let runtime cleanup finish before deleting the sprint.`);
      }

      const activeProviderInvocation = this.db.prepare(`
        SELECT id, status
        FROM provider_invocations
        WHERE sprint_id = ?
          AND status = 'running'
        ORDER BY updated_at DESC, started_at DESC
        LIMIT 1
      `).get(sprintId) as { id: string; status: string } | undefined;
      if (activeProviderInvocation) {
        throw new ValidationError(`Sprint ${sprintId} has active provider invocation ${activeProviderInvocation.id}; cancel or let runtime cleanup finish before deleting the sprint.`);
      }

      const activeExecutionInvocation = this.db.prepare(`
        SELECT id, status
        FROM execution_invocations
        WHERE sprint_id = ?
          AND status IN ('running', 'paused')
        ORDER BY updated_at DESC, started_at DESC
        LIMIT 1
      `).get(sprintId) as { id: string; status: string } | undefined;
      if (activeExecutionInvocation) {
        throw new ValidationError(`Sprint ${sprintId} has active execution invocation ${activeExecutionInvocation.id} (${activeExecutionInvocation.status}); cancel or let runtime cleanup finish before deleting the sprint.`);
      }

      const recentlyFinishedRun = this.db.prepare(`
        SELECT id, status, finished_at
        FROM sprint_runs
        WHERE sprint_id = ?
          AND status IN ('completed', 'failed', 'cancelled')
          AND finished_at IS NOT NULL
          AND datetime(finished_at) >= datetime('now', '-30 seconds')
        ORDER BY finished_at DESC, created_at DESC
        LIMIT 1
      `).get(sprintId) as { id: string; status: string; finished_at: string } | undefined;
      if (recentlyFinishedRun) {
        throw new ValidationError(`Sprint ${sprintId} has recently finished run ${recentlyFinishedRun.id} (${recentlyFinishedRun.status}); wait for runtime cleanup to settle before deleting the sprint.`);
      }

      const preservedInvocation = this.db.prepare(`
        SELECT id
        FROM execution_invocations
        WHERE sprint_id = ?
          AND preserved_at IS NOT NULL
        ORDER BY preserved_at DESC, started_at DESC
        LIMIT 1
      `).get(sprintId) as { id: string } | undefined;
      if (preservedInvocation) {
        throw new ValidationError(`Sprint ${sprintId} has preserved execution invocation ${preservedInvocation.id}; clear preservation before deleting it.`);
      }
      this.db.prepare(`DELETE FROM sprints WHERE id = ?`).run(sprintId);

      if (this.getSelectedSprintId(sprint.projectId) === sprintId) {
        const nextSprintRow = this.db.prepare(`
          SELECT id
          FROM sprints
          WHERE project_id = ?
          ORDER BY COALESCE(number, 0) DESC, created_at DESC
          LIMIT 1
        `).get(sprint.projectId) as { id: string } | undefined;

        this.setSelectedSprintId(sprint.projectId, nextSprintRow?.id ?? null);
      }

      const hasActive = this.db.prepare(`
        SELECT 1 FROM sprint_runs
        WHERE project_id = ? AND status IN ('running', 'queued')
        LIMIT 1
      `).get(sprint.projectId);

      if (!hasActive) {
        this.db.prepare(`
          UPDATE projects
          SET status = 'idle', updated_at = ?
          WHERE id = ? AND status = 'running'
        `).run(new Date().toISOString(), sprint.projectId);
      }

      this.touchProject(sprint.projectId);
      this.publishProjectStructureRefresh(sprint.projectId);
      } catch (error) {
      if (error instanceof RepositoryError) throw error;
      if (error instanceof Error && (error.message.toLowerCase().includes('depend') || error.message.includes('constraint failed') || error.message.includes('FOREIGN KEY'))) throw new ValidationError(error.message);
      this.logger.error("Operation failed", { error, sprintId });
      throw new RepositoryError(error instanceof Error ? error.message : "Operation failed", error);
    }
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

  listSprintLinkedIssues(projectId: string, sprintId: string): SprintLinkedIssueRecord[] {
    this.requireProject(projectId);
    const sprint = this.requireSprint(sprintId);
    if (sprint.projectId !== projectId) {
      throw new ValidationError(`Sprint ${sprintId} does not belong to project ${projectId}`);
    }

    const rows = this.db.prepare(`
      SELECT *
      FROM sprint_linked_issues
      WHERE project_id = ? AND sprint_id = ?
      ORDER BY provider ASC, repository ASC, issue_number ASC
    `).all(projectId, sprintId) as unknown as LinkedIssueRow[];

    return rows.map((row) => this.mapLinkedIssueRow(row));
  }

  replaceSprintLinkedIssues(projectId: string, sprintId: string, issues: SprintLinkedIssueInput[]): SprintLinkedIssueRecord[] {
    this.requireProject(projectId);
    const sprint = this.requireSprint(sprintId);
    if (sprint.projectId !== projectId) {
      throw new ValidationError(`Sprint ${sprintId} does not belong to project ${projectId}`);
    }

    const now = new Date().toISOString();
    const normalized = normalizeLinkedIssueInputs(issues);
    this.db.transaction(() => {
      this.db.prepare(`DELETE FROM sprint_linked_issues WHERE project_id = ? AND sprint_id = ?`).run(projectId, sprintId);
      const insert = this.db.prepare(`
        INSERT INTO sprint_linked_issues (
          id, project_id, sprint_id, provider, host_domain, project_key, repository, issue_number, external_id, source_kind, issue_key,
          title, url, state, labels_json, assignees_json, issue_body_markdown, issue_conversation_markdown, include_conversation,
          issue_author, issue_created_at, issue_updated_at, metadata_json, imported_at, closed_at, close_state, close_error, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const issue of normalized) {
        const metadataJson = issue.metadata ? JSON.stringify(issue.metadata) : null;
        insert.run(
          randomUUID(),
          projectId,
          sprintId,
          issue.provider,
          issue.hostDomain,
          issue.projectKey || null,
          issue.repository,
          issue.issueNumber ?? null,
          issue.externalId ?? null,
          issue.sourceKind || "issue",
          issue.issueKey || defaultLinkedIssueKey(issue),
          issue.title,
          issue.url,
          issue.state || "open",
          JSON.stringify(issue.labels || []),
          JSON.stringify(issue.assignees || []),
          issue.issueBodyMarkdown ?? null,
          issue.issueConversationMarkdown ?? null,
          issue.includeConversation === undefined ? null : issue.includeConversation ? 1 : 0,
          issue.issueAuthor ?? null,
          issue.issueCreatedAt ?? null,
          issue.issueUpdatedAt ?? null,
          metadataJson,
          now,
          null,
          "open",
          null,
          now,
        );
      }
    });

    this.touchProject(projectId, now);
    this.publishProjectStructureRefresh(projectId);
    return this.listSprintLinkedIssues(projectId, sprintId);
  }

  updateSprintLinkedIssueCloseState(
    issueId: string,
    state: Pick<SprintLinkedIssueRecord, "closeState"> & { closedAt?: string | null; closeError?: string | null; issueState?: string }
  ): SprintLinkedIssueRecord {
    const current = this.db.prepare(`SELECT * FROM sprint_linked_issues WHERE id = ?`).get(issueId) as LinkedIssueRow | undefined;
    if (!current) {
      throw new EntityNotFoundError(`Linked issue not found: ${issueId}`);
    }
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE sprint_linked_issues
      SET state = ?, close_state = ?, closed_at = ?, close_error = ?, updated_at = ?
      WHERE id = ?
    `).run(
      state.issueState || current.state,
      state.closeState,
      state.closedAt === undefined ? current.closed_at : state.closedAt,
      state.closeError === undefined ? current.close_error : state.closeError,
      now,
      issueId,
    );
    this.touchProject(current.project_id, now);
    this.publishProjectStructureRefresh(current.project_id);
    const updated = this.db.prepare(`SELECT * FROM sprint_linked_issues WHERE id = ?`).get(issueId) as LinkedIssueRow;
    return this.mapLinkedIssueRow(updated);
  }

  createTask(projectId: string, input: CreateTaskInput): TaskRecord {
    try {
      this.requireProject(projectId);
      const sprint = this.requireSprint(input.sprintId);
      if (sprint.projectId !== projectId) {
        throw new ValidationError(`Sprint ${input.sprintId} does not belong to project ${projectId}`);
      }

      const id = randomUUID();
      const now = new Date().toISOString();
      const taskKey = input.taskKey?.trim() || this.createNextTaskKey(input.sprintId);
      const sortOrder = input.sortOrder ?? this.getNextSortOrder(input.sprintId);

      const insertTask = this.db.prepare(`
        INSERT INTO tasks (
          id, project_id, sprint_id, task_key, title, prompt_markdown, description, status, priority, executor_type, agent_preset_id,
          sort_order, is_independent, is_merged, merge_indicator, source_type, source_path, model, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const insertDependency = this.db.prepare(`
        INSERT INTO task_dependencies (task_id, depends_on_task_id)
        VALUES (?, ?)
      `);

      const normalizedDependsOnTaskIds = this.normalizeDependencyIds(input.dependsOnTaskIds);
      if (normalizedDependsOnTaskIds.length > 0) {
        const sprintTasks = this.listTasks(projectId, input.sprintId);
        validateTaskDependencies(id, input.sprintId, normalizedDependsOnTaskIds, sprintTasks);
      }

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
          input.agentPresetId?.trim() || null,
          sortOrder,
          input.isIndependent === undefined ? 1 : Number(input.isIndependent),
          Number(!!input.isMerged),
          input.mergeIndicator || null,
          input.sourceType || null,
          input.sourcePath || null,
          input.model || null,
          now,
          now
        );

        for (const dependencyId of normalizedDependsOnTaskIds) {
          insertDependency.run(id, dependencyId);
        }
      });

      this.touchProject(projectId, now);
      const created = this.requireTask(id);
      this.publishProjectStructureRefresh(projectId);
      return created;
      } catch (error) {
      if (error instanceof RepositoryError) throw error;
      if (error instanceof Error && (error.message.toLowerCase().includes('depend') || error.message.includes('constraint failed') || error.message.includes('FOREIGN KEY'))) throw new ValidationError(error.message);
      this.logger.error("Operation failed", { error, projectId, sprintId: input.sprintId });
      throw new RepositoryError(error instanceof Error ? error.message : "Operation failed", error);
    }
  }

  createImportedTask(projectId: string, sprintId: string, input: SprintImportedTaskInput): TaskRecord {
    const created = this.createTask(projectId, buildImportedTaskCreateInput(sprintId, input));
    return created;
  }

  createImportedTasks(projectId: string, sprintId: string, inputs: SprintImportedTaskInput[]): TaskRecord[] {
    const tasks: TaskRecord[] = [];
    for (const input of inputs) {
      tasks.push(this.createImportedTask(projectId, sprintId, input));
    }
    return tasks;
  }

  updateTask(taskId: string, input: UpdateTaskInput): TaskRecord {
    try {
      const current = this.requireTask(taskId);
      const nextTitle = input.title?.trim() || current.title;
      const nextPromptMarkdown = input.promptMarkdown === undefined ? current.promptMarkdown : input.promptMarkdown;
      const nextDescription = input.description === undefined ? current.description : input.description;
      const nextStatus = input.status || current.status;
      const nextPriority = input.priority || current.priority;
      const nextExecutorType = input.executorType || current.executorType;
      const nextAgentPresetId = input.agentPresetId === undefined ? current.agentPresetId : (input.agentPresetId?.trim() || null);
      const nextModel = input.model === undefined ? (current.model || null) : (input.model?.trim() || null);
      const nextSortOrder = input.sortOrder === undefined ? current.sortOrder : input.sortOrder;
      const nextIsIndependent = input.isIndependent === undefined ? current.isIndependent : input.isIndependent;
      const nextIsMerged = input.isMerged === undefined ? current.isMerged : input.isMerged;
      const requestedMergeIndicator = input.mergeIndicator === undefined ? current.mergeIndicator : input.mergeIndicator;
      const nextMergeIndicator = this.shouldSuppressResolvedWorkerMergeConflict(current.id, input)
        ? null
        : requestedMergeIndicator;
      const nextSourceType = input.sourceType === undefined ? current.sourceType : input.sourceType;
      const nextSourcePath = input.sourcePath === undefined ? current.sourcePath : input.sourcePath;
      const nextDependsOnTaskIds = input.dependsOnTaskIds
        ? this.normalizeDependencyIds(input.dependsOnTaskIds)
        : current.dependsOnTaskIds;
      const dependenciesChanged = input.dependsOnTaskIds !== undefined
        && !sameStringArray(nextDependsOnTaskIds, current.dependsOnTaskIds);

      if (dependenciesChanged) {
        const sprintTasks = this.listTasks(current.projectId, current.sprintId);
        validateTaskDependencies(taskId, current.sprintId, nextDependsOnTaskIds, sprintTasks);
      }

      const taskChanged = nextTitle !== current.title
        || nextPromptMarkdown !== current.promptMarkdown
        || nextDescription !== current.description
        || nextStatus !== current.status
        || nextPriority !== current.priority
        || nextExecutorType !== current.executorType
        || nextAgentPresetId !== current.agentPresetId
        || nextModel !== (current.model || null)
        || nextSortOrder !== current.sortOrder
        || nextIsIndependent !== current.isIndependent
        || nextIsMerged !== current.isMerged
        || nextMergeIndicator !== current.mergeIndicator
        || nextSourceType !== current.sourceType
        || nextSourcePath !== current.sourcePath;
      if (!taskChanged && !dependenciesChanged) {
        return current;
      }

      const now = new Date().toISOString();
      const updateTask = this.db.prepare(`
        UPDATE tasks
        SET title = ?, prompt_markdown = ?, description = ?, status = ?, priority = ?, executor_type = ?, agent_preset_id = ?, model = ?, sort_order = ?,
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
          nextTitle,
          nextPromptMarkdown,
          nextDescription,
          nextStatus,
          nextPriority,
          nextExecutorType,
          nextAgentPresetId,
          nextModel,
          nextSortOrder,
          Number(nextIsIndependent),
          Number(nextIsMerged),
          nextMergeIndicator,
          nextSourceType,
          nextSourcePath,
          now,
          taskId
        );

        if (input.dependsOnTaskIds) {
          deleteDependencies.run(taskId);
          for (const dependencyId of nextDependsOnTaskIds) {
            insertDependency.run(taskId, dependencyId);
          }
        }
      });

      this.touchProject(current.projectId, now);
      const updated = this.requireTask(taskId);
      this.publishProjectStructureRefresh(current.projectId);
      return updated;
      } catch (error) {
      if (error instanceof RepositoryError) throw error;
      if (error instanceof Error && (error.message.toLowerCase().includes('depend') || error.message.includes('constraint failed') || error.message.includes('FOREIGN KEY'))) throw new ValidationError(error.message);
      this.logger.error("Operation failed", { error, taskId });
      throw new RepositoryError(error instanceof Error ? error.message : "Operation failed", error);
    }
  }

  private shouldSuppressResolvedWorkerMergeConflict(taskId: string, input: UpdateTaskInput): boolean {
    if (input.mergeIndicator !== "MERGE_CONFLICT") {
      return false;
    }

    const sourceBranch = input.mergeConflictSourceBranch?.trim() || null;
    const targetBranch = input.mergeConflictTargetBranch?.trim() || null;
    if (!sourceBranch || !targetBranch) {
      return false;
    }

    const row = this.db.prepare(`
      SELECT 1
      FROM project_attention_items
      WHERE task_id = ?
        AND attention_type = 'merge_conflict'
        AND owner_type = 'worker'
        AND status = 'resolved'
        AND json_extract(payload_json, '$.resolutionReason') IN (
          'virtual_worker_merge_conflict_resolved',
          'virtual_worker_merge_conflict_already_resolved'
        )
        AND json_extract(payload_json, '$.conflictingBranches.source') = ?
        AND json_extract(payload_json, '$.conflictingBranches.target') = ?
      LIMIT 1
    `).get(taskId, sourceBranch, targetBranch);

    return Boolean(row);
  }

  deleteTask(taskId: string): void {
    try {
      const task = this.requireTask(taskId);
      // guardrail_ledger.task_id is not a tasks FK (it also holds synthetic, taskless keys),
      // so cascade does not clean these up — delete the task's guardrail rows explicitly.
      this.db.prepare(`DELETE FROM guardrail_ledger WHERE task_id = ?`).run(taskId);
      this.db.prepare(`DELETE FROM tasks WHERE id = ?`).run(taskId);
      this.touchProject(task.projectId);
      this.publishProjectStructureRefresh(task.projectId);
      } catch (error) {
      if (error instanceof RepositoryError) throw error;
      if (error instanceof Error && (error.message.toLowerCase().includes('depend') || error.message.includes('constraint failed') || error.message.includes('FOREIGN KEY'))) throw new ValidationError(error.message);
      this.logger.error("Operation failed", { error, taskId });
      throw new RepositoryError(error instanceof Error ? error.message : "Operation failed", error);
    }
  }

  deleteTasksBySprint(sprintId: string): void {
    try {
      const sprint = this.requireSprint(sprintId);
      this.db.prepare(`DELETE FROM guardrail_ledger WHERE task_id IN (SELECT id FROM tasks WHERE sprint_id = ?)`).run(sprintId);
      this.db.prepare(`DELETE FROM tasks WHERE sprint_id = ?`).run(sprintId);
      this.touchProject(sprint.projectId);
      this.publishProjectStructureRefresh(sprint.projectId);
      } catch (error) {
      if (error instanceof RepositoryError) throw error;
      if (error instanceof Error && (error.message.toLowerCase().includes('depend') || error.message.includes('constraint failed') || error.message.includes('FOREIGN KEY'))) throw new ValidationError(error.message);
      this.logger.error("Operation failed", { error, sprintId });
      throw new RepositoryError(error instanceof Error ? error.message : "Operation failed", error);
    }
  }


  getSelectedSprintId(projectId: string): string | null {
    const projectExists = this.db.prepare(`
      SELECT 1 AS exists_flag
      FROM projects
      WHERE id = ?
      LIMIT 1
    `).get(projectId) as { exists_flag: number } | undefined;
    if (!projectExists) {
      throw new EntityNotFoundError(`Project not found: ${projectId}`);
    }
    const row = this.db.prepare(`
      SELECT payload
      FROM app_settings
      WHERE key = ?
    `).get(`selected_sprint_id_${projectId}`) as { payload: string } | undefined;

    if (!row) {
      return null;
    }

    try {
      const parsed = JSON.parse(row.payload) as { sprintId?: string | null };
      return parsed.sprintId ?? null;
    } catch {
      return null;
    }
  }

  sprintBelongsToProject(projectId: string, sprintId: string): boolean {
    const row = this.db.prepare(`
      SELECT 1 AS exists_flag
      FROM sprints
      WHERE id = ? AND project_id = ?
      LIMIT 1
    `).get(sprintId, projectId) as { exists_flag: number } | undefined;
    return Boolean(row);
  }

  setSelectedSprintId(projectId: string, sprintId: string | null): string | null {
    try {
      this.requireProject(projectId);
      if (sprintId) {
        const sprint = this.requireSprint(sprintId);
        if (sprint.projectId !== projectId) {
          throw new ValidationError(`Sprint ${sprintId} does not belong to project ${projectId}`);
        }
      }
      const now = new Date().toISOString();
      this.db.prepare(`
        INSERT INTO app_settings (key, payload, updated_at)
        VALUES (?, ?, ?)
        ${this.db.dialect.upsert(["key"], ["payload", "updated_at"])}
      `).run(
        `selected_sprint_id_${projectId}`,
        JSON.stringify({ sprintId }),
        now
      );

      return sprintId;
      } catch (error) {
      if (error instanceof RepositoryError) throw error;
      if (error instanceof Error && (error.message.toLowerCase().includes('depend') || error.message.includes('constraint failed') || error.message.includes('FOREIGN KEY'))) throw new ValidationError(error.message);
      this.logger.error("Operation failed", { error, projectId, sprintId });
      throw new RepositoryError(error instanceof Error ? error.message : "Operation failed", error);
    }
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
    try {
      if (projectId) {
        this.requireProject(projectId);
      }
      const now = new Date().toISOString();
      this.db.prepare(`
        INSERT INTO app_settings (key, payload, updated_at)
        VALUES (?, ?, ?)
        ${this.db.dialect.upsert(["key"], ["payload", "updated_at"])}
      `).run(
        SELECTED_PROJECT_KEY,
        JSON.stringify({ projectId }),
        now
      );

      return projectId;
      } catch (error) {
      if (error instanceof RepositoryError) throw error;
      if (error instanceof Error && (error.message.toLowerCase().includes('depend') || error.message.includes('constraint failed') || error.message.includes('FOREIGN KEY'))) throw new ValidationError(error.message);
      this.logger.error("Operation failed", { error, projectId });
      throw new RepositoryError(error instanceof Error ? error.message : "Operation failed", error);
    }
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

  getRawSprintStatus(sprintId: string): SprintRecord["status"] | null {
    try {
      const row = this.db.prepare(`
        SELECT status
        FROM sprints
        WHERE id = ?
      `).get(sprintId) as { status: string } | undefined;
      return row ? (row.status as SprintRecord["status"]) : null;
    } catch {
      return null;
    }
  }

  findSprintByProjectAndNumber(projectId: string, sprintNumber: number): SprintRecord | null {
    this.requireProject(projectId);
    const row = this.db.prepare(`
      ${sprintSummaryQuery.select}
      ${sprintSummaryQuery.from}
      WHERE s.project_id = ? AND s.number = ?
      LIMIT 1
    `).get(projectId, sprintNumber) as SprintRow | undefined;

    return row ? this.hydrateSprints([row])[0] : null;
  }

  getTask(taskId: string): TaskRecord | null {
    try {
      return this.requireTask(taskId);
    } catch {
      return null;
    }
  }

  getTasksByIds(taskIds: string[]): TaskRecord[] {
    if (taskIds.length === 0) {
      return [];
    }

    const rows = this.storage.executeChunkedInQuery<TaskRow>({
      sqlPrefix: "SELECT * FROM tasks WHERE id",
      items: taskIds,
    });

    return this.inflateTasks(rows);
  }

  private requireProject(projectId: string): ProjectSummary {
    const project = this.getProject(projectId);
    if (!project) {
      throw new EntityNotFoundError(`Project not found: ${projectId}`);
    }
    return project;
  }

  private requireSprint(sprintId: string): SprintRecord {
    const row = this.db.prepare(`
      ${sprintSummaryQuery.select}
      ${sprintSummaryQuery.from}
      WHERE s.id = ?
    `).get(sprintId) as SprintRow | undefined;

    if (!row) {
      throw new EntityNotFoundError(`Sprint not found: ${sprintId}`);
    }

    return this.hydrateSprints([row])[0];
  }

  private requireTask(taskId: string): TaskRecord {
    const row = this.db.prepare(`
      SELECT *
      FROM tasks
      WHERE id = ?
    `).get(taskId) as TaskRow | undefined;

    if (!row) {
      throw new EntityNotFoundError(`Task not found: ${taskId}`);
    }

    const [task] = this.inflateTasks([row]);
    return task;
  }

  private inflateTasks(rows: TaskRow[]): TaskRecord[] {
    if (rows.length === 0) {
      return [];
    }

    const dependencyRows = this.storage.executeChunkedInQuery<DependencyRow>({
      sqlPrefix: "SELECT task_id, depends_on_task_id FROM task_dependencies WHERE task_id",
      sqlSuffix: "ORDER BY depends_on_task_id ASC",
      items: rows.map((row) => row.id),
    });

    const dependencyMap = new Map<string, string[]>();
    for (const row of dependencyRows) {
      const current = dependencyMap.get(row.task_id) || [];
      current.push(row.depends_on_task_id);
      dependencyMap.set(row.task_id, current);
    }

    const taskIds = rows.map((row) => row.id);
    const reviewMap = this.getLatestTaskReviewSummaryMap(taskIds);
    const selfReflectionRatingMap = this.taskSelfReflectionRatingRepository.getLatestByTaskIds(taskIds);

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
      agentPresetId: row.agent_preset_id || null,
      model: row.model || null,
      sortOrder: toNumber(row.sort_order),
      dependsOnTaskIds: dependencyMap.get(row.id) || [],
      isIndependent: toBoolean(row.is_independent),
      isMerged: toBoolean(row.is_merged),
      latestReview: reviewMap.get(row.id),
      selfReflectionRating: selfReflectionRatingMap.get(row.id),
      mergeIndicator: row.merge_indicator,
      sourceType: row.source_type,
      sourcePath: row.source_path,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  private getLatestTaskReviewSummaryMap(taskIds: string[]): Map<string, SprintReviewSummary> {
    const rows = this.storage.executeChunkedInQuery<TaskReviewSummaryRow>({
      sqlPrefix: `
        SELECT
          q.task_id,
          json_object(
            'status', q.status,
            'outcome', q.outcome,
            'summary', q.summary_markdown,
            'findings', COALESCE(json_extract(q.payload_json, '$.findings'), json_array()),
            'reviewer', q.agent_name,
            'finishedAt', q.finished_at
          ) AS latest_task_review_json
        FROM qa_review_runs q
        WHERE q.task_id`,
      sqlSuffix: `
          AND q.trigger_type IN ('task_completion', 'completed_task_without_pr')
          AND q.rowid = (
            SELECT q2.rowid
            FROM qa_review_runs q2
            WHERE q2.task_id = q.task_id
              AND q2.trigger_type IN ('task_completion', 'completed_task_without_pr')
            ORDER BY q2.started_at DESC, q2.rowid DESC
            LIMIT 1
          )
      `,
      items: taskIds,
    });

    const map = new Map<string, SprintReviewSummary>();
    for (const row of rows) {
      if (!row.latest_task_review_json) {
        continue;
      }
      try {
        const parsed = JSON.parse(row.latest_task_review_json) as SprintReviewSummary;
        parsed.findings = Array.isArray(parsed.findings) ? parsed.findings : [];
        map.set(row.task_id, parsed);
      } catch {
        // Ignore malformed persisted QA payloads.
      }
    }
    return map;
  }

  private hydrateProjects(rows: ProjectRow[]): ProjectSummary[] {
    if (rows.length === 0) {
      return [];
    }

    const projectIds = rows.map((row) => row.id);
    const summaryAggregationMap = loadProjectSummaryAggregationMap(this.storage, projectIds);
    const settingsOverridesMap = this.settingsRepository.getProjectSettingsBatch(projectIds);
    const agentBindingsMap = this.projectWorkerAssignmentRepository.listAssignmentsForProjects(projectIds, { activeOnly: true });

    return rows.map((row) => {
      const summaryAggregation = summaryAggregationMap.get(row.id) || emptyProjectSummaryAggregation();
      const settingsOverrides = settingsOverridesMap.get(row.id) || {};
      const agentBindings = agentBindingsMap.get(row.id) || [];
      return this.mapProjectRow(row, summaryAggregation, settingsOverrides, agentBindings);
    });
  }

  private mapProjectRow(
    row: ProjectRow,
    summaryAggregation: ProjectSummaryAggregation,
    settingsOverrides: ProjectSettingsOverride,
    agentBindings: ProjectWorkerAssignmentRecord[]
  ): ProjectSummary {
    const sourceType = row.source_type || "local";
    const sourceRef = row.source_ref || row.base_dir;
    const inferredLocalRemoteUrl = row.repo_url ? null : readLocalGitOriginUrl(row.base_dir);
    const effectiveRepoUrl = row.repo_url || inferredLocalRemoteUrl;
    const { provider, hostDomain } = resolveRepositoryHost(effectiveRepoUrl || (sourceType === "git" ? sourceRef : null));

    const isRunning = summaryAggregation.hasActiveRuns;
    let status = row.status;
    if (isRunning) {
      status = "running";
    } else if (status === "running") {
      status = "idle";
    }

    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      baseDir: row.base_dir,
      repoUrl: effectiveRepoUrl,
      sourceType,
      sourceRef,
      gitProvider: provider,
      gitHostDomain: hostDomain,
      defaultBranch: row.default_branch,
      featureBranchPrefix: row.feature_branch_prefix,
      status,
      sprintsCount: summaryAggregation.sprintsCount,
      openTasks: summaryAggregation.openTasks,
      completedTasks: summaryAggregation.completedTasks,
      isRunning,
      settingsOverrides,
      agentBindings,
      lastRunAt: summaryAggregation.lastRunAt,
      lastRunStatus: summaryAggregation.lastRunStatus,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private hydrateSprints(rows: SprintRow[]): SprintRecord[] {
    if (rows.length === 0) {
      return [];
    }

    const sprintIds = rows.map((row) => row.id);
    const summaryAggregationMap = loadSprintSummaryAggregationMap(this.storage, sprintIds);
    const linkedIssuesMap = this.listSprintLinkedIssuesBatch(sprintIds);

    return rows.map((row) => this.mapSprintRow(
      row,
      summaryAggregationMap.get(row.id) || emptySprintSummaryAggregation(),
      linkedIssuesMap.get(row.id) || []
    ));
  }

  private mapSprintRow(
    row: SprintRow,
    summaryAggregation: SprintSummaryAggregation,
    linkedIssues: SprintLinkedIssueRecord[]
  ): SprintRecord {
    const tasksCount = summaryAggregation.tasksCount;
    const completedTasks = summaryAggregation.completedTasks;

    return {
      id: row.id,
      projectId: row.project_id,
      number: row.number === null ? null : toNumber(row.number),
      slug: row.slug,
      name: row.name,
      isGeneratedName: toBoolean(row.is_generated_name),
      originalPrompt: row.original_prompt || null,
      goal: row.goal || "",
      status: mapEffectiveSprintStatus(row.status, summaryAggregation.latestRunStatus),
      showcasePinned: toBoolean(row.showcase_pinned),
      startDate: row.start_date,
      endDate: row.end_date,
      featureBranch: row.feature_branch,
      baseCommitSha: row.base_commit_sha,
      tasksCount,
      completion: tasksCount > 0 ? Math.round((completedTasks / tasksCount) * 100) : 0,
      linkedIssues,
      latestReview: summaryAggregation.latestReview,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private listSprintLinkedIssuesBatch(sprintIds: string[]): Map<string, SprintLinkedIssueRecord[]> {
    const map = new Map<string, SprintLinkedIssueRecord[]>();
    for (const sprintId of sprintIds) {
      map.set(sprintId, []);
    }

    const rows = this.storage.executeChunkedInQuery<LinkedIssueRow>({
      sqlPrefix: `
        SELECT *
        FROM sprint_linked_issues
        WHERE sprint_id`,
      sqlSuffix: `
        ORDER BY provider ASC, repository ASC, issue_number ASC
      `,
      items: sprintIds,
    });

    for (const row of rows) {
      const current = map.get(row.sprint_id) || [];
      current.push(this.mapLinkedIssueRow(row));
      map.set(row.sprint_id, current);
    }

    return map;
  }

  private mapLinkedIssueRow(row: LinkedIssueRow): SprintLinkedIssueRecord {
    return {
      id: row.id,
      projectId: row.project_id,
      sprintId: row.sprint_id,
      provider: row.provider,
      sourceProvider: row.provider,
      sourceKind: normalizeLinkedIssueSourceKind(row.source_kind),
      externalId: row.external_id,
      hostDomain: row.host_domain,
      projectKey: row.project_key || undefined,
      repository: row.repository,
      issueNumber: row.issue_number === null ? null : toNumber(row.issue_number),
      issueKey: row.issue_key,
      title: row.title,
      url: row.url,
      state: row.state,
      labels: parseJsonStringArray(row.labels_json),
      assignees: parseJsonStringArray(row.assignees_json),
      issueBodyMarkdown: row.issue_body_markdown ?? undefined,
      issueConversationMarkdown: row.issue_conversation_markdown ?? undefined,
      includeConversation: row.include_conversation === null || row.include_conversation === undefined
        ? undefined
        : toBoolean(row.include_conversation),
      issueAuthor: row.issue_author,
      issueCreatedAt: row.issue_created_at,
      issueUpdatedAt: row.issue_updated_at,
      metadata: parseJsonRecord(row.metadata_json),
      importedAt: row.imported_at,
      closedAt: row.closed_at,
      closeState: row.close_state,
      closeError: row.close_error,
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
    const rows = this.db.prepare(`
      SELECT task_key
      FROM tasks
      WHERE sprint_id = ?
    `).all(sprintId) as { task_key: string }[];

    if (rows.length === 0) {
      return "T01";
    }

    let maxNumber = 0;
    for (const row of rows) {
      const match = row.task_key.match(/(\d+)$/);
      if (match) {
        maxNumber = Math.max(maxNumber, Number(match[1]));
      }
    }

    return `T${String(maxNumber + 1).padStart(2, "0")}`;
  }

  private normalizeDependencyIds(dependencyIds: string[] | undefined): string[] {
    const seen = new Set<string>();
    const output: string[] = [];
    for (const dependencyId of dependencyIds || []) {
      const normalized = dependencyId.trim();
      if (!normalized || seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);
      output.push(normalized);
    }

    if (output.length > 0) {
      const rows = this.storage.executeChunkedInQuery({
        sqlPrefix: "SELECT id FROM tasks WHERE id",
        items: output,
      }) as { id: string }[];

      const foundTaskIds = new Set(rows.map(r => r.id));
      for (const normalized of output) {
        if (!foundTaskIds.has(normalized)) {
          throw new EntityNotFoundError(`Task not found: ${normalized}`);
        }
      }
    }

    return output;
  }

  private resolveBaseDir(
    sourceType: ProjectSourceType,
    sourceRef: string,
    slug: string,
    cloneDir?: string,
    fallback = ""
  ): string {
    if (sourceType === "local") {
      const trimmedSourceRef = sourceRef.trim();
      if (!trimmedSourceRef) {
        return getHomeCodeUxPath("projects", slug);
      }
      return path.isAbsolute(trimmedSourceRef) ? trimmedSourceRef : path.resolve(os.homedir(), trimmedSourceRef);
    }

    const repoName = deriveRepoName(sourceRef);
    if (cloneDir && cloneDir.trim()) {
      const resolvedClone = path.isAbsolute(cloneDir.trim()) ? cloneDir.trim() : path.resolve(os.homedir(), cloneDir.trim());
      return path.resolve(resolvedClone, repoName);
    }

    return fallback || getHomeCodeUxPath("projects", repoName);
  }

  private touchProject(projectId: string, updatedAt = new Date().toISOString()): void {
    this.db.prepare(`
      UPDATE projects
      SET updated_at = ?
      WHERE id = ?
    `).run(updatedAt, projectId);
  }

  private runInTransaction(callback: () => void): void {
    this.db.transaction(callback);
  }

  private publishProjectStructureRefresh(projectId: string): void {
    this.realtimeNotifier?.scheduleProjectStructureRefresh(projectId, { includeProjects: true });
  }

  private publishProjectsRefresh(): void {
    this.realtimeNotifier?.scheduleProjectsRefresh();
  }
}

function buildImportedTaskCreateInput(sprintId: string, input: SprintImportedTaskInput): CreateTaskInput {
  const title = input.title.trim();
  const kind = input.kind;
  const sourcePath = normalizeImportedTaskSourcePath(input);
  const labels = normalizeImportedTaskLabels(input.labels);
  const priority = input.priority || defaultImportedTaskPriority(kind);
  const promptMarkdown = buildImportedTaskPromptMarkdown(input, labels, priority, sourcePath);
  const dependsOnTaskIds = normalizeImportedTaskDependencies(input.dependsOnTaskIds);
  const agentPresetId = typeof input.agentPresetId === "string" && input.agentPresetId.trim().length > 0
    ? input.agentPresetId.trim()
    : null;

  return {
    sprintId,
    title,
    description: input.errorMessage?.trim() || defaultImportedTaskDescription(kind),
    promptMarkdown,
    status: "pending",
    priority,
    executorType: "auto",
    agentPresetId,
    dependsOnTaskIds,
    isIndependent: dependsOnTaskIds.length === 0,
    sourceType: `import:${kind}`,
    sourcePath,
  };
}

function buildImportedTaskPromptMarkdown(
  input: SprintImportedTaskInput,
  labels: string[],
  priority: SprintImportedTaskInput["priority"],
  sourcePath: string | null,
): string {
  const lines = [
    "## Objective",
    getImportedTaskObjective(input.kind),
    "",
    "## Source",
    `- Kind: ${input.kind}`,
    `- Provider: ${normalizeImportedTaskText(input.provider) || "unknown"}`,
    `- Repository: ${normalizeImportedTaskText(input.repository) || "unknown"}`,
    `- Source: ${sourcePath ? sourcePath : "unknown"}`,
  ];

  if (input.branch?.trim()) {
    lines.push(`- Branch: ${input.branch.trim()}`);
  }
  if (input.baseBranch?.trim()) {
    lines.push(`- Base branch: ${input.baseBranch.trim()}`);
  }
  if (input.pullRequestNumber !== undefined && input.pullRequestNumber !== null) {
    lines.push(`- Pull request: #${Math.trunc(input.pullRequestNumber)}`);
  }
  if (input.pullRequestUrl?.trim()) {
    lines.push(`- Pull request URL: ${input.pullRequestUrl.trim()}`);
  }
  if (input.workflowRunId?.trim()) {
    lines.push(`- Workflow run: ${input.workflowRunId.trim()}`);
  }
  if (input.workflowRunUrl?.trim()) {
    lines.push(`- Workflow run URL: ${input.workflowRunUrl.trim()}`);
  }
  if (input.commitSha?.trim()) {
    lines.push(`- Commit SHA: ${input.commitSha.trim()}`);
  }
  if (labels.length > 0) {
    lines.push(`- Labels: ${labels.map((label) => `\`${label}\``).join(", ")}`);
  }
  lines.push(`- Priority: ${priority || "medium"}`);

  lines.push("", "## Context");
  lines.push(...getImportedTaskContextLines(input));
  if (input.errorMessage?.trim()) {
    lines.push("", "### Error Message", "", "```text", input.errorMessage.trim(), "```");
  }

  lines.push("", "## Constraints");
  lines.push(...getImportedTaskConstraintLines(input.kind));

  lines.push("", "## Verification");
  lines.push(...getImportedTaskVerificationLines(input.kind));

  return lines.join("\n");
}

function getImportedTaskObjective(kind: SprintImportedTaskKind): string {
  switch (kind) {
    case "security":
      return "Investigate, fix, and verify the security issue described below.";
    case "quality":
      return "Fix the quality or correctness issue described below without changing unrelated behavior.";
    case "merge_conflict":
      return "Resolve the merge conflict and leave the branch in a mergeable state.";
    case "failed_ci":
      return "Fix the failing CI run and restore the pipeline to green.";
  }
}

function getImportedTaskContextLines(input: SprintImportedTaskInput): string[] {
  const lines: string[] = [];

  switch (input.kind) {
    case "security":
      lines.push(
        "Imported security work item.",
        "Focus on the concrete vulnerability, exposure, or hardening gap reported in the source metadata.",
      );
      break;
    case "quality":
      lines.push(
        "Imported quality work item.",
        "Address the bug, regression, or documentation gap reported in the source metadata.",
      );
      break;
    case "merge_conflict":
      lines.push("Imported merge-conflict work item.");
      if (input.branch?.trim() || input.baseBranch?.trim()) {
        lines.push(
          "",
          "### Branch Details",
          ...(input.branch?.trim() ? [`- Head branch: ${input.branch.trim()}`] : []),
          ...(input.baseBranch?.trim() ? [`- Base branch: ${input.baseBranch.trim()}`] : []),
        );
      }
      if (input.pullRequestNumber !== undefined && input.pullRequestNumber !== null) {
        lines.push(`- Pull request number: #${Math.trunc(input.pullRequestNumber)}`);
      }
      if (input.pullRequestUrl?.trim()) {
        lines.push(`- Pull request URL: ${input.pullRequestUrl.trim()}`);
      }
      if (input.commitSha?.trim()) {
        lines.push(`- Merge base / commit SHA: ${input.commitSha.trim()}`);
      }
      break;
    case "failed_ci":
      lines.push("Imported failed-CI work item.");
      if (input.workflowRunId?.trim() || input.workflowRunUrl?.trim()) {
        lines.push(
          "",
          "### CI Run Details",
          ...(input.workflowRunId?.trim() ? [`- Workflow run ID: ${input.workflowRunId.trim()}`] : []),
          ...(input.workflowRunUrl?.trim() ? [`- Workflow run URL: ${input.workflowRunUrl.trim()}`] : []),
        );
      }
      if (input.branch?.trim() || input.baseBranch?.trim()) {
        lines.push(
          "",
          "### Branch Details",
          ...(input.branch?.trim() ? [`- Head branch: ${input.branch.trim()}`] : []),
          ...(input.baseBranch?.trim() ? [`- Base branch: ${input.baseBranch.trim()}`] : []),
        );
      }
      if (input.commitSha?.trim()) {
        lines.push(`- Commit SHA: ${input.commitSha.trim()}`);
      }
      break;
  }

  return lines;
}

function getImportedTaskConstraintLines(kind: SprintImportedTaskKind): string[] {
  switch (kind) {
    case "security":
      return [
        "- Preserve unrelated behavior and keep the fix scoped to the reported issue.",
        "- Prefer the smallest safe change that eliminates the security concern.",
      ];
    case "quality":
      return [
        "- Preserve linked issue behavior and avoid widening the scope of the fix.",
        "- Keep the change targeted to the bug or correctness issue described in the source.",
      ];
    case "merge_conflict":
      return [
        "- Resolve conflicts without discarding unrelated branch work.",
        "- Keep the resulting merge clean, reviewable, and consistent with the surrounding code.",
      ];
    case "failed_ci":
      return [
        "- Fix the failing job with the smallest change that restores CI.",
        "- Do not silence the failure; address the underlying cause.",
      ];
  }
}

function getImportedTaskVerificationLines(kind: SprintImportedTaskKind): string[] {
  switch (kind) {
    case "security":
      return [
        "- Re-run the relevant security checks or regression tests if available.",
        "- Confirm the issue no longer reproduces and note the evidence.",
      ];
    case "quality":
      return [
        "- Re-run the focused regression or unit test that covers the bug.",
        "- Confirm the issue no longer reproduces and that nearby behavior still works.",
      ];
    case "merge_conflict":
      return [
        "- Confirm the branch merges cleanly after the fix.",
        "- Capture the specific branch state used to verify the resolution.",
      ];
    case "failed_ci":
      return [
        "- Re-run the failed CI job or the narrowest equivalent check.",
        "- Confirm the original failure signal is gone and summarize the result.",
      ];
  }
}

function normalizeImportedTaskDependencies(dependsOnTaskIds: string[] | undefined): string[] {
  if (!dependsOnTaskIds || dependsOnTaskIds.length === 0) {
    return [];
  }

  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const dependencyId of dependsOnTaskIds) {
    const trimmed = dependencyId.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    normalized.push(trimmed);
  }
  return normalized;
}

function normalizeImportedTaskLabels(labels: string[] | undefined): string[] {
  if (!labels || labels.length === 0) {
    return [];
  }

  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const label of labels) {
    const trimmed = label.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    normalized.push(trimmed);
  }
  return normalized;
}

function normalizeImportedTaskSourcePath(input: SprintImportedTaskInput): string | null {
  const source = [
    input.sourcePath,
    input.sourceUrl,
    input.pullRequestUrl,
    input.workflowRunUrl,
  ].find((value): value is string => typeof value === "string" && value.trim().length > 0);

  return source ? source.trim() : null;
}

function defaultImportedTaskPriority(kind: SprintImportedTaskKind): SprintImportedTaskInput["priority"] {
  switch (kind) {
    case "security":
      return "high";
    case "quality":
      return "medium";
    case "merge_conflict":
      return "critical";
    case "failed_ci":
      return "high";
  }
}

function defaultImportedTaskDescription(kind: SprintImportedTaskKind): string {
  switch (kind) {
    case "security":
      return "Imported security work item.";
    case "quality":
      return "Imported quality work item.";
    case "merge_conflict":
      return "Imported merge-conflict work item.";
    case "failed_ci":
      return "Imported failed-CI work item.";
  }
}

function normalizeImportedTaskText(value?: string | null): string {
  return typeof value === "string" ? value.trim() : "";
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
      return storedStatus === "running" ? "idle" : storedStatus;
  }
}

function emptyProjectSummaryAggregation(): ProjectSummaryAggregation {
  return {
    sprintsCount: 0,
    openTasks: 0,
    completedTasks: 0,
    hasActiveRuns: false,
    lastRunAt: null,
    lastRunStatus: null,
  };
}

function emptySprintSummaryAggregation(): SprintSummaryAggregation {
  return {
    tasksCount: 0,
    completedTasks: 0,
    latestRunStatus: null,
  };
}

function parseJsonStringArray(value: string | null | undefined): string[] {
  if (!value) {
    return [];
  }
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : [];
  } catch {
    return [];
  }
}

function parseJsonRecord(value: string | null | undefined): Record<string, unknown> | undefined {
  const parsed = parsePayloadJson(value);
  return parsed && !Array.isArray(parsed) ? parsed : undefined;
}

const LINKED_ISSUE_PROVIDERS = new Set<LinkedIssueProvider>([
  "github",
  "gitlab",
  "jira",
  "notion",
  "asana",
  "linear",
  "miro",
  "lucid",
  "figma",
  "mural",
]);

const NUMERIC_LINKED_ISSUE_PROVIDERS = new Set<LinkedIssueProvider>(["github", "gitlab", "jira"]);

const LINKED_ISSUE_SOURCE_KINDS = new Set<LinkedIssueSourceKind>([
  "issue",
  "task",
  "page",
  "database",
  "board",
  "document",
  "file",
  "canvas",
]);

function normalizeLinkedIssueSourceKind(value: string | null | undefined): LinkedIssueSourceKind {
  return typeof value === "string" && LINKED_ISSUE_SOURCE_KINDS.has(value as LinkedIssueSourceKind)
    ? value as LinkedIssueSourceKind
    : "issue";
}

function defaultLinkedIssueKey(issue: Pick<SprintLinkedIssueInput, "provider" | "issueNumber" | "externalId">): string {
  if (typeof issue.issueNumber === "number" && Number.isFinite(issue.issueNumber) && issue.issueNumber > 0) {
    if (issue.provider === "github") return `#${issue.issueNumber}`;
    if (issue.provider === "gitlab") return `!${issue.issueNumber}`;
    return String(issue.issueNumber);
  }
  return issue.externalId || "external";
}

function normalizeOptionalText(value: string | null | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function normalizeOptionalMarkdown(value: string | null | undefined): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

const LINKED_ISSUE_METADATA_SECRET_KEY_PATTERN = /(?:token|secret|authorization|password|api[-_]?key|credential)/i;

function sanitizeLinkedIssueMetadataValue(value: unknown, depth: number): unknown {
  if (depth > 8) {
    return undefined;
  }
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => sanitizeLinkedIssueMetadataValue(item, depth + 1))
      .filter((item) => item !== undefined);
  }
  if (typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      if (LINKED_ISSUE_METADATA_SECRET_KEY_PATTERN.test(key)) {
        continue;
      }
      const sanitized = sanitizeLinkedIssueMetadataValue(nestedValue, depth + 1);
      if (sanitized !== undefined) {
        output[key] = sanitized;
      }
    }
    return output;
  }
  return undefined;
}

function sanitizeLinkedIssueMetadata(metadata: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!metadata) {
    return undefined;
  }
  const sanitized = sanitizeLinkedIssueMetadataValue(metadata, 0);
  if (!sanitized || typeof sanitized !== "object" || Array.isArray(sanitized)) {
    return undefined;
  }
  return Object.keys(sanitized).length > 0 ? sanitized as Record<string, unknown> : undefined;
}

function normalizeLinkedIssueInputs(issues: SprintLinkedIssueInput[]): SprintLinkedIssueInput[] {
  const seen = new Set<string>();
  const normalized: SprintLinkedIssueInput[] = [];
  for (const issue of issues) {
    if (!LINKED_ISSUE_PROVIDERS.has(issue.provider)) {
      continue;
    }
    const hostDomain = issue.hostDomain.trim().toLowerCase();
    const repository = issue.repository.trim().replace(/^\/+|\/+$/g, "");
    const rawIssueNumber = typeof issue.issueNumber === "number" && Number.isFinite(issue.issueNumber)
      ? Math.trunc(issue.issueNumber)
      : null;
    const issueNumber = rawIssueNumber !== null && rawIssueNumber > 0 ? rawIssueNumber : null;
    const externalId = issue.externalId?.trim() || null;
    const sourceKind = normalizeLinkedIssueSourceKind(issue.sourceKind);
    const title = issue.title.trim();
    const url = issue.url.trim();
    const metadata = sanitizeLinkedIssueMetadata(issue.metadata);
    if (!hostDomain || !repository || !title || !url) {
      continue;
    }
    if (NUMERIC_LINKED_ISSUE_PROVIDERS.has(issue.provider) && issueNumber === null) {
      continue;
    }
    if (!NUMERIC_LINKED_ISSUE_PROVIDERS.has(issue.provider) && !externalId) {
      continue;
    }
    const keySource = externalId ? `external:${externalId}` : `number:${issueNumber}`;
    const key = `${issue.provider}:${hostDomain}:${repository}:${keySource}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    normalized.push({
      provider: issue.provider,
      sourceProvider: issue.sourceProvider || issue.provider,
      sourceKind,
      externalId: externalId ?? undefined,
      hostDomain,
      projectKey: issue.projectKey?.trim() || undefined,
      repository,
      issueNumber: issueNumber ?? undefined,
      issueKey: issue.issueKey?.trim() || defaultLinkedIssueKey({ provider: issue.provider, issueNumber: issueNumber ?? undefined, externalId: externalId ?? undefined }),
      title,
      url,
      state: issue.state?.trim() || "open",
      labels: Array.from(new Set((issue.labels || []).map((label) => label.trim()).filter(Boolean))).slice(0, 12),
      assignees: Array.from(new Set((issue.assignees || []).map((assignee) => assignee.trim()).filter(Boolean))).slice(0, 12),
      issueBodyMarkdown: normalizeOptionalMarkdown(issue.issueBodyMarkdown),
      issueConversationMarkdown: normalizeOptionalMarkdown(issue.issueConversationMarkdown),
      includeConversation: issue.includeConversation,
      issueAuthor: normalizeOptionalText(issue.issueAuthor),
      issueCreatedAt: normalizeOptionalText(issue.issueCreatedAt),
      issueUpdatedAt: normalizeOptionalText(issue.issueUpdatedAt),
      metadata,
    });
  }
  return normalized.slice(0, 50);
}

function sameStringArray(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}

function deriveRepoName(sourceRef: string): string {
  const cleaned = sourceRef
    .trim()
    .replace(/\/+$/, "")
    .replace(/\.git$/i, "");
  const segment = cleaned.split("/").pop() || cleaned;
  return slugify(segment);
}
