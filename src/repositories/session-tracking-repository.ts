import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";
import type { JulesActivity, JulesSession, ProviderId } from "../contracts/app-types.js";
import { getHomeSprintOsPath } from "../shared/config/sprint-os-paths.js";
import { SqliteDatabaseAdapter } from "./db/sqlite-database-adapter.js";
import { DatabaseAdapter } from "./db/database-adapter.js";

interface SessionRow {
  id: string;
  provider: ProviderId;
  task_id: string | null;
  title: string | null;
  prompt: string | null;
  state: string | null;
  create_time: string;
  update_time: string;
  feature_branch: string | null;
  worker_branch: string | null;
  pr_url: string | null;
  repo_path: string | null;
}

interface ActivityRow {
  activity_id: string;
  create_time: string;
  originator: string | null;
  description: string | null;
  payload: string | null;
}

interface SessionIdRow {
  id: string;
}

interface TrackedCliSessionRow {
  id: string;
  provider: Exclude<ProviderId, "jules">;
  state: string;
  repoPath: string | null;
  updateTime: string;
}

interface FailedCliSessionResumeTarget {
  sessionId: string;
  workerBranch: string;
}

interface CliSessionWorkspaceTarget {
  sessionId: string;
  workerBranch: string;
  state: string;
}

export interface CreateTrackedSessionInput {
  id: string;
  provider: ProviderId;
  taskId?: string;
  title?: string;
  prompt?: string;
  state?: string;
  featureBranch?: string;
  workerBranch?: string;
  repoPath?: string;
  prUrl?: string;
}

export interface UpdateTrackedSessionInput {
  state?: string;
  workerBranch?: string;
  prUrl?: string;
  title?: string;
}

const SESSION_DB_PATH = getHomeSprintOsPath("session-tracking.db");

const resolveDbPath = (dbPath?: string): string => {
  if (dbPath && dbPath.trim().length > 0) {
    return dbPath;
  }
  fs.mkdirSync(path.dirname(SESSION_DB_PATH), { recursive: true });
  return SESSION_DB_PATH;
};

const toSessionName = (sessionId: string): string => `sessions/${sessionId.replace(/^sessions\//, "")}`;
const toSessionId = (sessionNameOrId: string): string => sessionNameOrId.replace(/^sessions\//, "");

export class SessionTrackingRepository {
  private readonly db: DatabaseAdapter;

  constructor(dbPath?: string) {
    const resolvedDbPath = resolveDbPath(dbPath);
    fs.mkdirSync(path.dirname(resolvedDbPath), { recursive: true });
    this.db = new SqliteDatabaseAdapter(resolvedDbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS provider_sessions (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        task_id TEXT,
        title TEXT,
        prompt TEXT,
        state TEXT NOT NULL,
        create_time TEXT NOT NULL,
        update_time TEXT NOT NULL,
        feature_branch TEXT,
        worker_branch TEXT,
        pr_url TEXT,
        repo_path TEXT
      );
      CREATE TABLE IF NOT EXISTS provider_activities (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        activity_id TEXT NOT NULL UNIQUE,
        create_time TEXT NOT NULL,
        originator TEXT,
        description TEXT,
        payload TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_provider_activities_session_time
      ON provider_activities (session_id, create_time DESC);
    `);
  }

  createSession(input: CreateTrackedSessionInput): JulesSession {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO provider_sessions (
        id, provider, task_id, title, prompt, state, create_time, update_time, feature_branch, worker_branch, pr_url, repo_path
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        provider = excluded.provider,
        task_id = excluded.task_id,
        title = excluded.title,
        prompt = excluded.prompt,
        state = excluded.state,
        update_time = excluded.update_time,
        feature_branch = excluded.feature_branch,
        worker_branch = excluded.worker_branch,
        pr_url = excluded.pr_url,
        repo_path = excluded.repo_path
    `).run(
      toSessionId(input.id),
      input.provider,
      input.taskId ?? null,
      input.title ?? null,
      input.prompt ?? null,
      input.state ?? "RUNNING",
      now,
      now,
      input.featureBranch ?? null,
      input.workerBranch ?? null,
      input.prUrl ?? null,
      input.repoPath ?? null
    );
    return this.getSession(input.id)!;
  }

  updateSession(sessionId: string, input: UpdateTrackedSessionInput): JulesSession | null {
    const row = this.getSessionRow(sessionId);
    if (!row) {
      return null;
    }
    const nextState = input.state ?? row.state ?? "RUNNING";
    const nextTitle = input.title ?? row.title;
    const nextWorkerBranch = input.workerBranch ?? row.worker_branch;
    const nextPrUrl = input.prUrl ?? row.pr_url;
    const now = new Date().toISOString();

    this.db.prepare(`
      UPDATE provider_sessions
      SET state = ?, title = ?, worker_branch = ?, pr_url = ?, update_time = ?
      WHERE id = ?
    `).run(nextState, nextTitle, nextWorkerBranch, nextPrUrl, now, row.id);

    return this.getSession(sessionId);
  }

  appendActivity(
    sessionId: string,
    input: { originator?: string; description: string; payload?: unknown; createTime?: string }
  ): JulesActivity {
    const id = randomUUID();
    const createTime = input.createTime || new Date().toISOString();
    this.db.prepare(`
      INSERT INTO provider_activities (session_id, activity_id, create_time, originator, description, payload)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      toSessionId(sessionId),
      id,
      createTime,
      input.originator ?? "system",
      input.description,
      input.payload === undefined ? null : JSON.stringify(input.payload)
    );
    return {
      id,
      name: `${toSessionName(sessionId)}/activities/${id}`,
      createTime,
      originator: input.originator ?? "system",
      description: input.description,
    };
  }

  getSession(sessionId: string): JulesSession | null {
    const row = this.getSessionRow(sessionId);
    return row ? this.rowToSession(row) : null;
  }

  listSessions(limit: number = 200): { sessions: JulesSession[] } {
    const rows = this.db.prepare(`
      SELECT id, provider, task_id, title, prompt, state, create_time, update_time, feature_branch, worker_branch, pr_url, repo_path
      FROM provider_sessions
      ORDER BY create_time DESC
      LIMIT ?
    `).all(limit) as unknown as SessionRow[];
    return {
      sessions: rows.map((row) => this.rowToSession(row)),
    };
  }

  listTrackedCliSessions(): TrackedCliSessionRow[] {
    return this.db.prepare(`
      SELECT
        id,
        provider,
        state,
        repo_path AS repoPath,
        update_time AS updateTime
      FROM provider_sessions
      WHERE provider IN ('gemini', 'codex', 'claude-code', 'qwen-code')
        AND id LIKE 'cli-%'
      ORDER BY update_time DESC
    `).all() as unknown as TrackedCliSessionRow[];
  }

  listActivities(args: { session_id: string; page_size?: number; page_token?: string }): { activities: JulesActivity[]; nextPageToken?: string } {
    const pageSize = typeof args.page_size === "number" && args.page_size > 0 ? args.page_size : 20;
    const offset = typeof args.page_token === "string" ? parseInt(args.page_token, 10) : 0;
    const safeOffset = Number.isFinite(offset) && offset >= 0 ? offset : 0;

    const rows = this.db.prepare(`
      SELECT activity_id, create_time, originator, description, payload
      FROM provider_activities
      WHERE session_id = ?
      ORDER BY create_time ASC
      LIMIT ? OFFSET ?
    `).all(toSessionId(args.session_id), pageSize + 1, safeOffset) as unknown as ActivityRow[];

    const hasMore = rows.length > pageSize;
    const data = (hasMore ? rows.slice(0, pageSize) : rows).map((row) => this.rowToActivity(args.session_id, row));

    return {
      activities: data,
      nextPageToken: hasMore ? String(safeOffset + pageSize) : undefined,
    };
  }

  listAllActivities(sessionId: string): JulesActivity[] {
    const rows = this.db.prepare(`
      SELECT activity_id, create_time, originator, description, payload
      FROM provider_activities
      WHERE session_id = ?
      ORDER BY create_time ASC
    `).all(toSessionId(sessionId)) as unknown as ActivityRow[];
    return rows.map((row) => this.rowToActivity(sessionId, row));
  }

  findLatestFailedCliSessionForTask(args: {
    provider: Exclude<ProviderId, "jules">;
    taskId: string;
    featureBranch: string;
    repoPath: string;
  }): FailedCliSessionResumeTarget | null {
    const row = this.db.prepare(`
      SELECT id, worker_branch
      FROM provider_sessions
      WHERE provider = ?
        AND task_id = ?
        AND feature_branch = ?
        AND repo_path = ?
        AND state = 'FAILED'
        AND id LIKE 'cli-%'
        AND worker_branch IS NOT NULL
      ORDER BY create_time DESC, update_time DESC, id DESC
      LIMIT 1
    `).get(
      args.provider,
      args.taskId,
      args.featureBranch,
      args.repoPath
    ) as { id?: string; worker_branch?: string } | undefined;

    if (!row?.id || !row.worker_branch) {
      return null;
    }
    return {
      sessionId: row.id,
      workerBranch: row.worker_branch,
    };
  }

  findLatestCliSessionForBranch(args: {
    repoPath: string;
    workerBranch: string;
    providers?: Array<Exclude<ProviderId, "jules">>;
  }): CliSessionWorkspaceTarget | null {
    const providers = (args.providers && args.providers.length > 0)
      ? args.providers
      : ["gemini", "codex", "claude-code", "qwen-code"];
    const placeholders = providers.map(() => "?").join(", ");
    const row = this.db.prepare(`
      SELECT id, worker_branch, state
      FROM provider_sessions
      WHERE repo_path = ?
        AND worker_branch = ?
        AND provider IN (${placeholders})
        AND id LIKE 'cli-%'
      ORDER BY create_time DESC, update_time DESC, id DESC
      LIMIT 1
    `).get(
      args.repoPath,
      args.workerBranch,
      ...providers,
    ) as { id?: string; worker_branch?: string; state?: string } | undefined;

    if (!row?.id || !row.worker_branch) {
      return null;
    }

    return {
      sessionId: row.id,
      workerBranch: row.worker_branch,
      state: row.state || "",
    };
  }

  recoverInterruptedCliSessions(): { recoveredCount: number; sessionIds: string[] } {
    const runningCliRows = this.db.prepare(`
      SELECT id
      FROM provider_sessions
      WHERE state = 'RUNNING'
        AND provider IN ('gemini', 'codex', 'claude-code', 'qwen-code')
        AND id LIKE 'cli-%'
      ORDER BY create_time ASC
    `).all() as unknown as SessionIdRow[];

    const sessionIds = runningCliRows.map((row) => row.id);
    if (sessionIds.length === 0) {
      return { recoveredCount: 0, sessionIds: [] };
    }

    const now = new Date().toISOString();
    this.db.transaction(() => {
      const CHUNK_SIZE = 100;
      for (let i = 0; i < sessionIds.length; i += CHUNK_SIZE) {
        const chunk = sessionIds.slice(i, i + CHUNK_SIZE);
        const updatePlaceholders = chunk.map(() => "?").join(", ");
        this.db.prepare(`
          UPDATE provider_sessions
          SET state = ?, update_time = ?
          WHERE id IN (${updatePlaceholders})
        `).run("FAILED", now, ...chunk);

        const insertPlaceholders = chunk.map(() => "(?, ?, ?, ?, ?, ?)").join(", ");
        const insertParams = chunk.flatMap(id => [
          id,
          randomUUID(),
          now,
          "system",
          "Recovered interrupted MCP process. Previous background CLI task is marked FAILED and can be retried safely.",
          JSON.stringify({ recovery: "INTERRUPTED_PROCESS" })
        ]);
        this.db.prepare(`
          INSERT INTO provider_activities (session_id, activity_id, create_time, originator, description, payload)
          VALUES ${insertPlaceholders}
        `).run(...insertParams);
      }
    });

    return { recoveredCount: sessionIds.length, sessionIds };
  }

  fetchRecentActivities(sessionName: string, pageSize: number): JulesActivity[] {
    const rows = this.db.prepare(`
      SELECT activity_id, create_time, originator, description, payload
      FROM provider_activities
      WHERE session_id = ?
      ORDER BY create_time DESC
      LIMIT ?
    `).all(toSessionId(sessionName), pageSize) as unknown as ActivityRow[];
    return rows.reverse().map((row) => this.rowToActivity(sessionName, row));
  }

  private getSessionRow(sessionNameOrId: string): SessionRow | null {
    const row = this.db.prepare(`
      SELECT id, provider, task_id, title, prompt, state, create_time, update_time, feature_branch, worker_branch, pr_url, repo_path
      FROM provider_sessions
      WHERE id = ?
      LIMIT 1
    `).get(toSessionId(sessionNameOrId)) as unknown as SessionRow | undefined;
    return row ?? null;
  }

  private rowToSession(row: SessionRow): JulesSession {
    return {
      id: row.id,
      name: toSessionName(row.id),
      title: row.title ?? undefined,
      state: row.state ?? undefined,
      provider: row.provider,
      prompt: row.prompt ?? "",
      createTime: row.create_time,
      outputs: row.pr_url ? [{ pullRequest: { url: row.pr_url, workerBranch: row.worker_branch ?? undefined } }] : [],
    };
  }

  private rowToActivity(sessionNameOrId: string, row: ActivityRow): JulesActivity {
    let payload: Record<string, unknown> = {};
    if (row.payload) {
      try {
        payload = JSON.parse(row.payload) as Record<string, unknown>;
      } catch {
        payload = {};
      }
    }
    return {
      id: row.activity_id,
      name: `${toSessionName(sessionNameOrId)}/activities/${row.activity_id}`,
      createTime: row.create_time,
      originator: row.originator ?? "system",
      description: row.description ?? "System activity...",
      ...payload,
    };
  }
}
