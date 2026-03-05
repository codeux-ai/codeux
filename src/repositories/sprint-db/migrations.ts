export const bootstrapDb = `
CREATE TABLE IF NOT EXISTS pm_projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pm_sprints (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  goal TEXT,
  status TEXT NOT NULL,
  start_date TEXT,
  end_date TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(project_id) REFERENCES pm_projects(id)
);

CREATE TABLE IF NOT EXISTS pm_tasks (
  id TEXT PRIMARY KEY,
  sprint_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL,
  type TEXT NOT NULL,
  sort_index INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(sprint_id) REFERENCES pm_sprints(id)
);

CREATE TABLE IF NOT EXISTS pm_dependencies (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  depends_on_task_id TEXT NOT NULL,
  type TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(task_id) REFERENCES pm_tasks(id),
  FOREIGN KEY(depends_on_task_id) REFERENCES pm_tasks(id)
);

CREATE TABLE IF NOT EXISTS pm_runs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  status TEXT NOT NULL,
  result TEXT,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(task_id) REFERENCES pm_tasks(id)
);

CREATE TABLE IF NOT EXISTS pm_events (
  id TEXT PRIMARY KEY,
  aggregate_id TEXT NOT NULL,
  aggregate_type TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pm_usage_samples (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  metric_name TEXT NOT NULL,
  value REAL NOT NULL,
  recorded_at TEXT NOT NULL,
  FOREIGN KEY(task_id) REFERENCES pm_tasks(id)
);

-- Indices
CREATE INDEX IF NOT EXISTS idx_pm_sprints_project_id ON pm_sprints(project_id);
CREATE INDEX IF NOT EXISTS idx_pm_tasks_sprint_id ON pm_tasks(sprint_id);
CREATE INDEX IF NOT EXISTS idx_pm_dependencies_task_id ON pm_dependencies(task_id);
CREATE INDEX IF NOT EXISTS idx_pm_dependencies_depends_on ON pm_dependencies(depends_on_task_id);
CREATE INDEX IF NOT EXISTS idx_pm_runs_task_id ON pm_runs(task_id);
CREATE INDEX IF NOT EXISTS idx_pm_events_aggregate ON pm_events(aggregate_type, aggregate_id);
CREATE INDEX IF NOT EXISTS idx_pm_usage_samples_task_id ON pm_usage_samples(task_id);
`;
