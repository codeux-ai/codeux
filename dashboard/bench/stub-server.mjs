// Stub server for dashboard performance benchmarking.
// Serves the production build (dashboard/dist) and answers /api/* with synthetic
// data so heavy list-rendering paths (tasks, sprints, projects) are exercised
// without needing the real orchestrator backend.
//
// Volume is configurable so we can stress render cost:
//   TASK_COUNT (default 60), PROJECT_COUNT (default 30), SPRINT_COUNT (default 12)
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(__dirname, "../dist");

const TASK_COUNT = Number(process.env.TASK_COUNT ?? 60);
const PROJECT_COUNT = Number(process.env.PROJECT_COUNT ?? 30);
const SPRINT_COUNT = Number(process.env.SPRINT_COUNT ?? 12);
const PORT = Number(process.env.PORT ?? 4599);

const NOW = new Date().toISOString();
const PHASES = ["RUNNING", "CODING_COMPLETED", "COMPLETED", "FAILED"];
const MERGE = ["CI", "AUTOMERGE", "MERGE_BLOCKED", "MERGE_CONFLICT", "MERGED", null];
const PROVIDERS = ["gemini", "codex", "claude-code", "qwen-code"];

const lorem =
  "Implement the feature end to end with tests and documentation, then open a PR. ".repeat(3);

function makeSubtask(i, projectId, sprintId) {
  const status = PHASES[i % PHASES.length];
  return {
    record_id: `rec-${projectId}-${i}`,
    project_id: projectId,
    sprint_id: sprintId,
    id: `T${String(i).padStart(2, "0")}`,
    title: `Task ${i}: ${["Auth", "Dashboard", "API", "Worker", "CI"][i % 5]} work`,
    prompt: lorem,
    depends_on: i > 0 ? [`T${String(i - 1).padStart(2, "0")}`] : [],
    status,
    session_id: `sess-${i}`,
    session_name: `sessions/abc${i}`,
    session_state: status,
    provider: PROVIDERS[i % PROVIDERS.length],
    model: "default",
    worker_branch: `feature/task-${i}`,
    pr_url: i % 3 === 0 ? `https://github.com/x/y/pull/${i}` : undefined,
    activities: Array.from({ length: i % 4 }, (_, k) => ({
      id: `act-${i}-${k}`,
      type: "progress",
      text: `Step ${k} in progress`,
      createdAt: NOW,
    })),
    is_independent: i % 4 === 0,
    is_merged: status === "COMPLETED" && i % 2 === 0,
    merge_indicator: MERGE[i % MERGE.length],
  };
}

function makeProject(i) {
  return {
    id: `proj-${i}`,
    slug: `project-${i}`,
    name: `Project ${i}`,
    baseDir: `/repos/project-${i}`,
    repoUrl: `https://github.com/org/project-${i}`,
    sourceType: "git",
    sourceRef: "main",
    gitProvider: "github",
    gitHostDomain: "github.com",
    defaultBranch: "main",
    featureBranchPrefix: "feature/",
    status: "ACTIVE",
    sprintsCount: SPRINT_COUNT,
    openTasks: (i * 3) % 20,
    completedTasks: (i * 5) % 40,
    isRunning: i % 3 === 0,
    settingsOverrides: {},
    agentBindings: [],
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function makeSprint(i, projectId) {
  return {
    id: `sprint-${projectId}-${i}`,
    projectId,
    number: i + 1,
    slug: `sprint-${i}`,
    name: `Sprint ${i + 1}`,
    originalPrompt: lorem,
    goal: `Deliver milestone ${i + 1}`,
    status: ["RUNNING", "PLANNED", "COMPLETED"][i % 3],
    showcasePinned: false,
    startDate: NOW,
    endDate: null,
    featureBranch: `feature/sprint-${i}`,
    baseCommitSha: "abc123",
    tasksCount: TASK_COUNT,
    completion: (i * 8) % 100,
    linkedIssues: [],
    createdAt: NOW,
    updatedAt: NOW,
  };
}

const PROJECTS = Array.from({ length: PROJECT_COUNT }, (_, i) => makeProject(i));
const SELECTED = PROJECTS[0]?.id ?? null;
const SUBTASKS = Array.from({ length: TASK_COUNT }, (_, i) =>
  makeSubtask(i, SELECTED, `sprint-${SELECTED}-0`),
);
const SPRINTS = Array.from({ length: SPRINT_COUNT }, (_, i) => makeSprint(i, SELECTED));

const execution = {
  projectId: SELECTED,
  projectName: "Project 0",
  sprintRuns: [],
  taskDispatches: SUBTASKS.slice(0, 20).map((t, i) => ({
    id: `disp-${i}`,
    taskId: t.id,
    taskTitle: t.title,
    status: t.status,
    provider: t.provider,
    startedAt: NOW,
    finishedAt: t.status === "COMPLETED" ? NOW : null,
  })),
  connections: [],
  primaryAssignedWorker: null,
  overflowAssignedWorkers: [],
  attentionItems: [],
  recentEvents: Array.from({ length: 25 }, (_, i) => ({
    id: `evt-${i}`,
    type: "info",
    message: `Runtime event ${i}`,
    createdAt: NOW,
  })),
  updatedAt: NOW,
};

const liveSnapshot = {
  projectId: SELECTED,
  selectedSprintId: `sprint-${SELECTED}-0`,
  status: { project_id: SELECTED, subtasks: SUBTASKS, timestamp: NOW },
  execution,
  gitStatus: null,
  gitStatusError: null,
  updatedAt: NOW,
};

const telemetry = {
  activeProjects: PROJECTS.slice(0, 8).map((p, i) => ({
    projectId: p.id,
    projectName: p.name,
    sprintId: `sprint-${p.id}-0`,
    sprintName: "Sprint 1",
    sprintNumber: 1,
    sprintRunId: `run-${i}`,
    sprintRunStatus: "RUNNING",
    activeDispatchCount: 3,
    runningDispatchCount: 2,
    updatedAt: NOW,
    humanIntervention: null,
  })),
  attentionProjects: [],
  recentEvents: execution.recentEvents,
  updatedAt: NOW,
};

const appearance = {
  theme: "DARK",
  reducedMotion: "AUTO",
  backgroundPattern: "HEXAGONS",
  backgroundMode: process.env.BG_MODE ?? "ANIMATED",
  animatedBackground: process.env.BG_ANIM ?? "deep-ocean",
  staticBackgroundColor: "#0d0f12",
  navigationMode: "DOCK",
  zoomLevel: 1,
};

const projectSettings = {
  appearance,
  automationLevel: "SUPERVISED",
  automationInterventions: {},
  aiProvider: {},
  git: {},
  jira: {},
  ciIntelligence: {},
  guardrails: {},
  sprintLoopSteps: {},
  cliWorkflow: {},
  sprintPreview: {},
  workers: {},
  agents: {},
  skills: [],
  mcpTools: [],
  customMcpServers: [],
  memory: {},
};

const systemSettings = {
  runtime: {},
  integrations: {},
  defaults: projectSettings,
  mcpTools: [],
  customMcpServers: [],
};

const effectiveSettings = { settings: projectSettings, sources: {} };

// Route table — exact paths and prefix matches.
function apiResponse(pathname) {
  const p = pathname.replace(/\/+$/, "");
  switch (p) {
    case "/api/projects":
      return { projects: PROJECTS, selectedProjectId: SELECTED };
    case "/api/live":
      return liveSnapshot;
    case "/api/status":
      return liveSnapshot.status;
    case "/api/execution":
      return execution;
    case "/api/live-activities":
      return { activities: {} };
    case "/api/telemetry/overview":
      return telemetry;
    case "/api/system-settings":
      return systemSettings;
    case "/api/user/onboarding":
      return { completed: true };
    case "/api/onboarding/readiness":
      return { ready: true, docker: { available: true }, providers: [] };
    case "/api/git-status":
      return null;
    case "/api/git-providers/available":
      return { providers: [] };
    case "/api/docker/containers":
      return { containers: [] };
    case "/api/embedding-models":
      return { models: [] };
    case "/api/local-directories":
      return { currentPath: "/", parentPath: null, rootPath: "/", homePath: "/", directories: [] };
    case "/api/settings/import-sources":
      return { sources: [] };
  }
  if (p.endsWith("/settings/effective")) return effectiveSettings;
  if (p.startsWith("/api/sprints") || p.includes("/sprints"))
    return { sprints: SPRINTS, selectedSprintId: SPRINTS[0]?.id ?? null };
  if (p.includes("/memories/stats")) return { total: 0, byType: {} };
  if (p.includes("/memories")) return { memories: [], total: 0 };
  if (p.startsWith("/api/scheduler")) return { routines: [] };
  if (p.startsWith("/api/agent-presets")) return { presets: [] };
  if (p.startsWith("/api/connections")) return { connections: [] };
  if (p.startsWith("/api/file-browser")) return { sessions: [] };
  if (p.startsWith("/api/browser")) return { sessions: [] };
  if (p.startsWith("/api/conversations")) return { threads: [] };
  return {}; // permissive default — fetchJson tolerates empty objects
}

const MIME = {
  ".js": "text/javascript",
  ".css": "text/css",
  ".html": "text/html",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".png": "image/png",
  ".webp": "image/webp",
  ".map": "application/json",
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

  if (pathname.startsWith("/api/")) {
    if (req.method !== "GET") {
      // swallow POST/PUT/DELETE bodies, return the same synthetic shapes
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(apiResponse(pathname)));
      });
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(apiResponse(pathname)));
    return;
  }

  // static files
  let filePath = path.join(DIST, pathname === "/" ? "index.html" : pathname);
  if (!filePath.startsWith(DIST)) {
    res.writeHead(403);
    res.end("forbidden");
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      // SPA fallback
      fs.readFile(path.join(DIST, "index.html"), (e2, html) => {
        if (e2) {
          res.writeHead(404);
          res.end("not found");
          return;
        }
        res.writeHead(200, { "content-type": "text/html" });
        res.end(html);
      });
      return;
    }
    res.writeHead(200, { "content-type": MIME[path.extname(filePath)] || "application/octet-stream" });
    res.end(data);
  });
});

// WebSocket realtime endpoint — accept and hold the connection open.
const wss = new WebSocketServer({ server, path: "/api/realtime" });
wss.on("connection", (ws) => {
  ws.on("message", () => {
    // Acknowledge subscription so the client treats transport as connected.
    ws.send(JSON.stringify({ type: "subscribed", lastSequence: 0 }));
  });
});

server.listen(PORT, () => {
  console.log(
    `stub-server listening on http://localhost:${PORT}  (tasks=${TASK_COUNT} projects=${PROJECT_COUNT} sprints=${SPRINT_COUNT})`,
  );
});
