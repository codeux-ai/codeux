import type { AppConfig } from "../config/app-config.js";

export const MANAGEMENT_DOMAINS = [
  "projects",
  "sprints",
  "tasks",
  "quicksprints",
  "scheduler",
  "settings",
  "agents",
  "memory",
  "preview",
  "telemetry",
  "manage",
] as const;

export type ManagementDomain = typeof MANAGEMENT_DOMAINS[number];

export interface ParsedCliInvocation {
  globalHelpRequested: boolean;
  management: ParsedManagementCommand | null;
}

export interface ParsedManagementCommand {
  command: ManagementDomain;
  domain: Exclude<ManagementDomain, "manage"> | null;
  action: string | null;
  jsonOutput: boolean;
  payloadJson: string | null;
  payloadFlags: Record<string, unknown>;
  rawPositionals: string[];
  helpRequested: boolean;
}

type FlagRecord = Record<string, unknown>;

interface FlagParseResult {
  helpRequested: boolean;
  jsonOutput: boolean;
  payloadJson: string | null;
  payloadFlags: FlagRecord;
  positionals: string[];
}

const STARTUP_FLAGS_WITH_VALUES = new Set([
  "--api-key",
  "--runtime-role",
  "--mcp-https-port",
  "--mcp-http-port",
  "--mcp-https-host",
  "--mcp-http-host",
  "--mcp-https-path",
  "--mcp-http-path",
  "--mcp-https-auth-token",
  "--mcp-http-auth-token",
]);

const FLAG_KEY_ALIASES: Record<string, string> = {
  project: "projectId",
  projectid: "projectId",
  "project-id": "projectId",
  sprint: "sprintId",
  sprintid: "sprintId",
  "sprint-id": "sprintId",
  sprintrun: "sprintRunId",
  sprintrunid: "sprintRunId",
  "sprint-run": "sprintRunId",
  "sprint-run-id": "sprintRunId",
  task: "taskId",
  taskid: "taskId",
  "task-id": "taskId",
  template: "templateId",
  templateid: "templateId",
  "template-id": "templateId",
  entry: "entryId",
  entryid: "entryId",
  "entry-id": "entryId",
  memory: "memoryId",
  memoryid: "memoryId",
  "memory-id": "memoryId",
  preset: "presetId",
  presetid: "presetId",
  "preset-id": "presetId",
  session: "sessionId",
  sessionid: "sessionId",
  "session-id": "sessionId",
  invocation: "invocationId",
  invocationid: "invocationId",
  "invocation-id": "invocationId",
  goalmarkdown: "goalMarkdown",
  "goal-markdown": "goalMarkdown",
  promptmarkdown: "promptMarkdown",
  "prompt-markdown": "promptMarkdown",
  bodymarkdown: "bodyMarkdown",
  "body-markdown": "bodyMarkdown",
  scheduledfor: "scheduledFor",
  "scheduled-for": "scheduledFor",
  at: "scheduledFor",
  taskcount: "taskCount",
  "task-count": "taskCount",
  defaulttaskcount: "defaultTaskCount",
  "default-task-count": "defaultTaskCount",
  autostart: "autoStart",
  "auto-start": "autoStart",
  noTaskLimit: "noTaskLimit",
  "no-task-limit": "noTaskLimit",
  replan: "replan",
  showcasepinned: "showcasePinned",
  "showcase-pinned": "showcasePinned",
  isindependent: "isIndependent",
  "is-independent": "isIndependent",
  ismerged: "isMerged",
  "is-merged": "isMerged",
  memorytemplateoverrideenabled: "memoryTemplateOverrideEnabled",
  "memory-template-override-enabled": "memoryTemplateOverrideEnabled",
  minsimilarity: "minSimilarity",
  "min-similarity": "minSimilarity",
  topkpernode: "topKPerNode",
  "top-k-per-node": "topKPerNode",
  sortorder: "sortOrder",
  "sort-order": "sortOrder",
  "payload-json": "payloadJson",
  "settings-json": "settingsJson",
  "labels-json": "labelsJson",
  "depends-on-task-ids": "dependsOnTaskIds",
  "memory-ids": "memoryIds",
  json: "json",
  help: "help",
  domain: "domain",
  action: "action",
};

const NUMERIC_KEYS = new Set([
  "limit",
  "taskCount",
  "defaultTaskCount",
  "sortOrder",
  "strength",
  "minSimilarity",
  "topKPerNode",
]);

const BOOLEAN_KEYS = new Set([
  "autoStart",
  "replan",
  "showcasePinned",
  "noTaskLimit",
  "isIndependent",
  "isMerged",
  "memoryTemplateOverrideEnabled",
  "jsonOutput",
]);

const ARRAY_KEYS = new Set([
  "labels",
  "dependsOnTaskIds",
  "memoryIds",
]);

const DOMAIN_ACTION_ALIASES: Record<string, string> = {
  "list-templates": "list_templates",
  "get-template": "get_template",
  "create-template": "create_template",
  "update-template": "update_template",
  "delete-template": "delete_template",
  "schedule-sprint": "schedule_sprint",
  "schedule-quicksprint": "schedule_quicksprint",
  "schedule-chat": "schedule_chat",
  "force-cancel": "force_cancel",
  "inspect-run": "inspect_run",
  "import-issues": "import_issues",
  "start-reembed": "start_reembed",
  "model-status": "model_status",
  "get-system": "get_system",
  "get-project-override": "get_project_override",
  "resolve-project-effective": "resolve_project_effective",
  "get-sprint-override": "get_sprint_override",
  "resolve-sprint-effective": "resolve_sprint_effective",
  "replace-system-settings": "replace_system_settings",
  "patch-system-setting": "patch_system_setting",
  "replace-project-settings": "replace_project_settings",
  "patch-project-setting": "patch_project_setting",
  "reset-project-settings": "reset_project_settings",
  "replace-sprint-settings": "replace_sprint_settings",
  "patch-sprint-setting": "patch_sprint_setting",
  "reset-sprint-settings": "reset_sprint_settings",
  "start-session": "start_session",
  "rebuild-session": "rebuild_session",
  "stop-session": "stop_session",
  "remove-session": "remove_session",
  "get-script": "get_script",
  "get-logs": "get_logs",
  "get-url": "get_url",
  "get-project-execution-snapshot": "get_project_execution_snapshot",
  "get-project-stats-snapshot": "get_project_stats_snapshot",
  "list-sprint-runs": "list_sprint_runs",
  "list-task-dispatches": "list_task_dispatches",
  "list-execution-invocations": "list_execution_invocations",
  "list-execution-invocation-messages": "list_execution_invocation_messages",
};

interface ActionSpec {
  display: string;
  requiredFlags: string[];
  examples?: string[];
}

const DOMAIN_ACTION_SPECS: Record<string, Record<string, ActionSpec>> = {
  projects: {
    list: { display: "List projects", requiredFlags: [] },
    get: { display: "Get a project", requiredFlags: ["--project"] },
    create: { display: "Create a project", requiredFlags: ["--name"] },
    update: { display: "Update a project", requiredFlags: ["--project"] },
    select: { display: "Select a project", requiredFlags: ["--project"] },
    setup: { display: "Run project setup", requiredFlags: ["--project"] },
    delete: { display: "Delete a project", requiredFlags: ["--project"] },
  },
  sprints: {
    list: { display: "List sprints", requiredFlags: ["--project"] },
    get: { display: "Get a sprint", requiredFlags: ["--sprint"] },
    create: { display: "Create a sprint", requiredFlags: ["--project", "--name"] },
    update: { display: "Update a sprint", requiredFlags: ["--sprint"] },
    delete: { display: "Delete a sprint", requiredFlags: ["--sprint"] },
    start: { display: "Start sprint orchestration", requiredFlags: ["--project", "--sprint"] },
    pause: { display: "Pause a sprint run", requiredFlags: ["--sprint-run"] },
    cancel: { display: "Cancel a sprint run", requiredFlags: ["--sprint-run"] },
    force_cancel: { display: "Force-cancel a sprint run", requiredFlags: ["--sprint-run"] },
    inspect_run: { display: "Inspect a sprint run", requiredFlags: ["--project", "--sprint"] },
    import_issues: { display: "Import linked issues", requiredFlags: ["--project"] },
    plan: { display: "Plan a sprint", requiredFlags: ["--project", "--sprint"] },
  },
  tasks: {
    list: { display: "List tasks", requiredFlags: ["--project"] },
    get: { display: "Get a task", requiredFlags: ["--task"] },
    create: { display: "Create a task", requiredFlags: ["--project", "--sprint"] },
    update: { display: "Update a task", requiredFlags: ["--task"] },
    delete: { display: "Delete a task", requiredFlags: ["--task"] },
    start: { display: "Start a task", requiredFlags: ["--task"] },
    stop: { display: "Stop a task", requiredFlags: ["--task"] },
    force_stop: { display: "Force-stop a task", requiredFlags: ["--task"] },
    pause: { display: "Pause a task", requiredFlags: ["--task"] },
    inspect_run: { display: "Inspect a task run", requiredFlags: ["--task"] },
  },
  quicksprints: {
    list_templates: { display: "List quicksprint templates", requiredFlags: ["--project"] },
    get_template: { display: "Get a quicksprint template", requiredFlags: ["--project", "--template"] },
    create_template: { display: "Create a quicksprint template", requiredFlags: ["--project", "--name", "--description", "--icon", "--category", "--agent-instruction-markdown"] },
    update_template: { display: "Update a quicksprint template", requiredFlags: ["--project", "--template"] },
    delete_template: { display: "Delete a quicksprint template", requiredFlags: ["--project", "--template"] },
    execute: { display: "Execute a quicksprint", requiredFlags: ["--project", "--template"] },
    start: { display: "Start a quicksprint", requiredFlags: ["--project", "--template"] },
  },
  scheduler: {
    list: { display: "List scheduler entries", requiredFlags: ["--project"] },
    create: { display: "Create a scheduler entry", requiredFlags: ["--project", "--scheduled-for"] },
    schedule_sprint: { display: "Schedule a sprint", requiredFlags: ["--project", "--scheduled-for", "--sprint"] },
    schedule_quicksprint: { display: "Schedule a quicksprint", requiredFlags: ["--project", "--scheduled-for", "--template"] },
    schedule_chat: { display: "Schedule a chat", requiredFlags: ["--project", "--scheduled-for", "--body-markdown"] },
    update: { display: "Update a scheduler entry", requiredFlags: ["--entry"] },
    delete: { display: "Delete a scheduler entry", requiredFlags: ["--entry"] },
    run_due: { display: "Run due entries", requiredFlags: [] },
  },
  settings: {
    get_system: { display: "Get system settings", requiredFlags: [] },
    get_project_override: { display: "Get project settings override", requiredFlags: ["--project"] },
    resolve_project_effective: { display: "Resolve effective project settings", requiredFlags: ["--project"] },
    get_sprint_override: { display: "Get sprint settings override", requiredFlags: ["--sprint"] },
    resolve_sprint_effective: { display: "Resolve effective sprint settings", requiredFlags: ["--project", "--sprint"] },
    replace_system_settings: { display: "Replace system settings", requiredFlags: ["--settings-json"] },
    patch_system_setting: { display: "Patch a system setting", requiredFlags: ["--path", "--value"] },
    replace_project_settings: { display: "Replace project settings", requiredFlags: ["--project", "--settings-json"] },
    patch_project_setting: { display: "Patch a project setting", requiredFlags: ["--project", "--path", "--value"] },
    reset_project_settings: { display: "Reset project settings", requiredFlags: ["--project"] },
    replace_sprint_settings: { display: "Replace sprint settings", requiredFlags: ["--project", "--sprint", "--settings-json"] },
    patch_sprint_setting: { display: "Patch a sprint setting", requiredFlags: ["--project", "--sprint", "--path", "--value"] },
    reset_sprint_settings: { display: "Reset sprint settings", requiredFlags: ["--sprint"] },
  },
  agents: {
    list: { display: "List agents", requiredFlags: ["--project"] },
    get: { display: "Get an agent", requiredFlags: ["--project", "--preset"] },
    sync: { display: "Sync agents", requiredFlags: ["--project"] },
    create: { display: "Create an agent", requiredFlags: ["--project", "--name"] },
    update: { display: "Update an agent", requiredFlags: ["--project", "--preset"] },
    delete: { display: "Delete an agent", requiredFlags: ["--project", "--preset"] },
  },
  memory: {
    search: { display: "Search memories", requiredFlags: ["--project", "--query"] },
    list: { display: "List memories", requiredFlags: ["--project"] },
    get: { display: "Get a memory", requiredFlags: ["--memory"] },
    create: { display: "Create a memory", requiredFlags: ["--project", "--content"] },
    update: { display: "Update a memory", requiredFlags: ["--memory"] },
    delete: { display: "Delete a memory", requiredFlags: ["--memory"] },
    promote: { display: "Promote memories", requiredFlags: ["--project", "--memory-ids"] },
    start_reembed: { display: "Start memory re-embedding", requiredFlags: ["--project"] },
    get_map: { display: "Get memory map", requiredFlags: ["--project"] },
    count: { display: "Count memories", requiredFlags: ["--project", "--scope"] },
    model_status: { display: "Get embedding model status", requiredFlags: [] },
  },
  preview: {
    list_sessions: { display: "List preview sessions", requiredFlags: ["--project"] },
    start_session: { display: "Start a preview session", requiredFlags: ["--project", "--sprint"] },
    rebuild_session: { display: "Rebuild a preview session", requiredFlags: ["--session"] },
    stop_session: { display: "Stop a preview session", requiredFlags: ["--session"] },
    remove_session: { display: "Remove a preview session", requiredFlags: ["--session"] },
    get_script: { display: "Get a preview script", requiredFlags: ["--project", "--sprint"] },
    get_logs: { display: "Get preview logs", requiredFlags: ["--session"] },
    get_url: { display: "Get a preview URL", requiredFlags: ["--session"] },
  },
  telemetry: {
    get_project_execution_snapshot: { display: "Get execution snapshot", requiredFlags: ["--project"] },
    get_project_stats_snapshot: { display: "Get stats snapshot", requiredFlags: ["--project"] },
    list_sprint_runs: { display: "List sprint runs", requiredFlags: ["--project", "--sprint"] },
    list_task_dispatches: { display: "List task dispatches", requiredFlags: ["--project", "--sprint", "--task"] },
    list_execution_invocations: { display: "List execution invocations", requiredFlags: ["--project"] },
    list_execution_invocation_messages: { display: "List execution invocation messages", requiredFlags: ["--invocation"] },
  },
};

function isManagementDomain(value: string): value is Exclude<ManagementDomain, "manage"> {
  return value !== "manage" && MANAGEMENT_DOMAINS.includes(value as ManagementDomain);
}

function normalizeToken(token: string): string {
  return token.trim().toLowerCase();
}

function normalizeActionName(token: string): string {
  const normalized = normalizeToken(token);
  return DOMAIN_ACTION_ALIASES[normalized] || normalized.replace(/-/g, "_");
}

function isStartupFlagWithValue(flag: string): boolean {
  return STARTUP_FLAGS_WITH_VALUES.has(flag);
}

function flagToPayloadKey(rawFlagName: string): string {
  const normalized = normalizeToken(rawFlagName).replace(/^--+/, "");
  const alias = FLAG_KEY_ALIASES[normalized];
  if (alias) {
    return alias;
  }

  return normalized.replace(/-([a-z0-9])/g, (_match, letter: string) => letter.toUpperCase());
}

function coercePayloadValue(key: string, value: unknown): unknown {
  if (value === true || value === false || value === null || value === undefined) {
    return value;
  }

  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  if (BOOLEAN_KEYS.has(key)) {
    if (["true", "yes", "1", "on"].includes(trimmed.toLowerCase())) {
      return true;
    }
    if (["false", "no", "0", "off"].includes(trimmed.toLowerCase())) {
      return false;
    }
  }

  if (NUMERIC_KEYS.has(key)) {
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  if (ARRAY_KEYS.has(key)) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      return trimmed.split(",").map((item) => item.trim()).filter(Boolean);
    }
  }

  if (key === "payloadJson" || key === "settingsJson") {
    return trimmed;
  }

  return trimmed;
}

function parseFlagTokens(tokens: string[]): FlagParseResult {
  const payloadFlags: FlagRecord = {};
  const positionals: string[] = [];
  let helpRequested = false;
  let jsonOutput = false;
  let payloadJson: string | null = null;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === "--") {
      positionals.push(...tokens.slice(index + 1));
      break;
    }

    if (token === "--help" || token === "-h") {
      helpRequested = true;
      continue;
    }

    if (token === "--json") {
      jsonOutput = true;
      continue;
    }

    if (token.startsWith("--")) {
      const eqIndex = token.indexOf("=");
      const rawName = eqIndex >= 0 ? token.slice(0, eqIndex) : token;
      const value = eqIndex >= 0
        ? token.slice(eqIndex + 1)
        : (tokens[index + 1] && !tokens[index + 1].startsWith("-") ? tokens[++index] : true);
      const key = flagToPayloadKey(rawName);

      if (key === "help") {
        helpRequested = true;
        continue;
      }

      if (key === "json") {
        jsonOutput = true;
        continue;
      }

      if (key === "payloadJson") {
        payloadJson = typeof value === "string" ? value : null;
        continue;
      }

      const coerced = coercePayloadValue(key, value);
      if (coerced !== undefined) {
        if (key === "domain" || key === "action") {
          payloadFlags[key] = coerced;
        } else {
          const existing = payloadFlags[key];
          if (existing === undefined) {
            payloadFlags[key] = coerced;
          } else if (Array.isArray(existing)) {
            payloadFlags[key] = [...existing, coerced];
          } else {
            payloadFlags[key] = [existing, coerced];
          }
        }
      }
      continue;
    }

    positionals.push(token);
  }

  return { helpRequested, jsonOutput, payloadJson, payloadFlags, positionals };
}

function findManagementCommandIndex(argv: string[]): number | null {
  let skipNext = false;

  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (skipNext) {
      skipNext = false;
      continue;
    }

    if (token === "--") {
      return index + 1 < argv.length ? index + 1 : null;
    }

    if (token === "--help" || token === "-h") {
      continue;
    }

    if (token.startsWith("--")) {
      const eqIndex = token.indexOf("=");
      const rawName = eqIndex >= 0 ? token.slice(0, eqIndex) : token;
      if (isStartupFlagWithValue(rawName) && eqIndex < 0) {
        skipNext = true;
      }
      continue;
    }

    if (MANAGEMENT_DOMAINS.includes(token as ManagementDomain)) {
      return index;
    }
  }

  return null;
}

function buildParsedManagementCommand(argv: string[]): ParsedManagementCommand | null {
  const commandIndex = findManagementCommandIndex(argv);
  if (commandIndex === null) {
    return null;
  }

  const command = argv[commandIndex] as ManagementDomain;
  if (!MANAGEMENT_DOMAINS.includes(command)) {
    return null;
  }

  const parsedFlags = parseFlagTokens(argv.slice(commandIndex + 1));
  const rawPositionals = parsedFlags.positionals;

  if (command === "manage") {
    const domainFlag = typeof parsedFlags.payloadFlags.domain === "string" ? parsedFlags.payloadFlags.domain.trim().toLowerCase() : undefined;
    const actionFlag = typeof parsedFlags.payloadFlags.action === "string" ? parsedFlags.payloadFlags.action.trim() : undefined;
    const positionalDomain = rawPositionals[0]?.trim().toLowerCase();
    const positionalAction = rawPositionals[1]?.trim();
    const resolvedDomain = domainFlag || (positionalDomain && isManagementDomain(positionalDomain) ? positionalDomain : undefined);
    const resolvedAction = actionFlag ? normalizeActionName(actionFlag) : positionalAction ? normalizeActionName(positionalAction) : undefined;

    return {
      command: "manage",
      domain: resolvedDomain ? resolvedDomain as Exclude<ManagementDomain, "manage"> : null,
      action: resolvedAction ? normalizeActionName(resolvedAction) : null,
      jsonOutput: parsedFlags.jsonOutput,
      payloadJson: parsedFlags.payloadJson,
      payloadFlags: parsedFlags.payloadFlags,
      rawPositionals,
      helpRequested: parsedFlags.helpRequested,
    };
  }

  const positionalAction = rawPositionals[0];

  return {
    command,
    domain: command,
    action: positionalAction ? normalizeActionName(positionalAction) : null,
    jsonOutput: parsedFlags.jsonOutput,
    payloadJson: parsedFlags.payloadJson,
    payloadFlags: parsedFlags.payloadFlags,
    rawPositionals,
    helpRequested: parsedFlags.helpRequested,
  };
}

export function parseCliInvocation(argv: string[]): ParsedCliInvocation {
  const commandIndex = findManagementCommandIndex(argv);
  const management = buildParsedManagementCommand(argv);
  const globalHelpRequested = argv.slice(2, commandIndex === null ? argv.length : commandIndex).some((token) => token === "--help" || token === "-h");

  return {
    globalHelpRequested,
    management,
  };
}

export function getManagementActionSpec(domain: Exclude<ManagementDomain, "manage">, action: string): ActionSpec | null {
  const domainSpecs = DOMAIN_ACTION_SPECS[domain];
  if (!domainSpecs) {
    return null;
  }
  return domainSpecs[action] ?? null;
}

export function listManagementDomains(): Exclude<ManagementDomain, "manage">[] {
  return MANAGEMENT_DOMAINS.filter((domain): domain is Exclude<ManagementDomain, "manage"> => domain !== "manage");
}

export function buildHelpText(appConfig: AppConfig): string {
  void appConfig;

  const lines: string[] = [
    "Code UX MCP Server",
    "",
    "Usage: codeux [options]",
    "",
    "Management commands:",
    "  codeux projects list",
    "  codeux sprints plan --project <id> --name <name> --goal <text>",
    "  codeux sprints start --sprint <id>",
    "  codeux quicksprints start --project <id> --template <id> --tasks 5",
    "  codeux scheduler schedule-quicksprint --project <id> --template <id> --at <iso>",
    "  codeux manage --payload-json '{\"domain\":\"projects\",\"action\":\"list\",\"payload\":{}}'",
    "",
    "Use `codeux <domain> --help` for domain-specific help.",
    "",
    "Options:",
    "  --api-key VALUE   Set the Jules API key (overrides env and settings)",
    "  --runtime-role VALUE",
    "                    Runtime role: project_manager (default) or worker-host",
    "  --headless        Start MCP-only without binding the dashboard",
    "  --server-mode     Start authenticated MCP HTTP server mode without binding the dashboard",
    "  --mcp-https      Enable the MCP Streamable HTTP gateway (enabled by default; legacy flag name)",
    "  --no-mcp-https    Disable the MCP Streamable HTTP gateway",
    "  --mcp-https-port N Port for the MCP Streamable HTTP gateway",
    "  --mcp-https-host H Host/interface for the MCP Streamable HTTP gateway",
    "  --mcp-https-path P Path for the MCP Streamable HTTP gateway (default: /mcp)",
    "  --mcp-https-auth-token VALUE",
    "                    Bearer token for MCP HTTP requests",
    "  --help, -h        Show this help message",
    "",
    "Environment Variables:",
    "  JULES_API_KEY      Jules API key",
    "  DASHBOARD_PORT     Port for the dashboard (default: 4444)",
    "  CODE_UX_SERVER_MODE",
    "                     Require authenticated MCP HTTP server mode and disable the dashboard",
    "  MCP_HTTPS_ENABLED  Enable the MCP HTTP gateway (default: true)",
    "  MCP_HTTPS_PORT     Port for the MCP HTTP gateway",
    "  MCP_HTTPS_HOST     Host/interface for the MCP HTTP gateway",
    "  MCP_HTTPS_PATH     Path for the MCP HTTP gateway",
    "  MCP_HTTPS_AUTH_TOKEN",
    "                     Bearer token for MCP HTTP requests",
  ];

  return lines.join("\n");
}

function formatRequiredFlags(requiredFlags: string[]): string {
  return requiredFlags.length > 0 ? requiredFlags.join(", ") : "none";
}

function getDomainActionEntries(domain: Exclude<ManagementDomain, "manage">): Array<[string, ActionSpec]> {
  const specs = DOMAIN_ACTION_SPECS[domain];
  return Object.entries(specs || {});
}

function getExampleLines(domain: Exclude<ManagementDomain, "manage">): string[] {
  switch (domain) {
    case "projects":
      return [
        "  codeux projects list",
        "  codeux projects get --project <id>",
        "  codeux projects create --name <name>",
      ];
    case "sprints":
      return [
        "  codeux sprints plan --project <id> --name <name> --goal <text>",
        "  codeux sprints start --project <id> --sprint <id>",
      ];
    case "tasks":
      return [
        "  codeux tasks list --project <id>",
        "  codeux tasks start --task <id>",
      ];
    case "quicksprints":
      return [
        "  codeux quicksprints start --project <id> --template <id> --tasks 5",
        "  codeux quicksprints list_templates --project <id>",
      ];
    case "scheduler":
      return [
        "  codeux scheduler schedule-quicksprint --project <id> --template <id> --at <iso>",
        "  codeux scheduler schedule-sprint --project <id> --sprint <id> --at <iso>",
      ];
    case "settings":
      return [
        "  codeux settings get_system",
        "  codeux settings patch_project_setting --project <id> --path git.defaultBranch --value main",
      ];
    case "agents":
      return [
        "  codeux agents list --project <id>",
        "  codeux agents delete --project <id> --preset <id>",
      ];
    case "memory":
      return [
        "  codeux memory search --project <id> --query <text>",
        "  codeux memory promote --project <id> --memory-ids '[\"mem-1\",\"mem-2\"]'",
      ];
    case "preview":
      return [
        "  codeux preview list_sessions --project <id>",
        "  codeux preview get_url --session <id> --path /",
      ];
    case "telemetry":
      return [
        "  codeux telemetry get_project_stats_snapshot --project <id>",
        "  codeux telemetry list_execution_invocations --project <id>",
      ];
    default:
      return [];
  }
}

export function buildDomainHelpText(domain: Exclude<ManagementDomain, "manage">): string {
  const lines: string[] = [
    `Code UX ${domain} management`,
    "",
    `Usage: codeux ${domain} <action> [flags]`,
    "",
    "Actions:",
  ];

  for (const [action, spec] of getDomainActionEntries(domain)) {
    lines.push(`  ${action.padEnd(24)} ${spec.display}`);
    if (spec.requiredFlags.length > 0) {
      lines.push(`    Required: ${formatRequiredFlags(spec.requiredFlags)}`);
    }
  }

  lines.push("");
  lines.push("Examples:");
  lines.push(...getExampleLines(domain));
  lines.push("");
  lines.push("Generic passthrough:");
  lines.push("  codeux manage --payload-json '{\"domain\":\"" + domain + "\",\"action\":\"list\",\"payload\":{}}'");
  lines.push("");
  lines.push("Use --json for a raw management envelope.");

  return lines.join("\n");
}

export function buildGenericManageHelpText(): string {
  return [
    "Code UX generic management passthrough",
    "",
    "Usage: codeux manage --payload-json '{\"domain\":\"projects\",\"action\":\"list\",\"payload\":{}}'",
    "",
    "Flags:",
    "  --domain <name>      Management domain (projects, sprints, tasks, quicksprints, scheduler, settings, agents, memory, preview, telemetry)",
    "  --action <name>      Management action to execute",
    "  --payload-json <json> Full MCP-shaped payload. May include domain, action, payload, and approval.",
    "  --json               Print the raw JSON envelope returned by the management handler",
    "",
    "Examples:",
    "  codeux manage --payload-json '{\"domain\":\"projects\",\"action\":\"list\",\"payload\":{}}'",
    "  codeux manage --domain sprints --action start --payload-json '{\"projectId\":\"p1\",\"sprintId\":\"s1\"}'",
  ].join("\n");
}
