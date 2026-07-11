import type {
  AgentInstructionTemplateId,
  Category,
  CategoryId,
  IntegrationDefinition,
} from "../hooks/use-settings-page-state.js";
import type { InvocationRoutingId, ProviderId, ThinkingMode } from "../../types.js";

type SearchTermRole = "label" | "description" | "term";

interface SearchTerm {
  value: string;
  role: SearchTermRole;
}

export interface SettingsSearchIndexEntry {
  categoryId: CategoryId;
  terms: SearchTerm[];
}

export type SettingsSearchIndex = Record<CategoryId, SettingsSearchIndexEntry>;

export interface SettingsSearchMatch {
  categoryId: CategoryId;
  matchedLabels: string[];
  matchedDescriptions: string[];
  matchedTerms: string[];
}

export type SettingsSearchMatches = Partial<Record<CategoryId, SettingsSearchMatch>>;

export interface SettingsSearchIndexInput {
  categories: Category[];
  providerLabels: Record<ProviderId, string>;
  integrations: IntegrationDefinition[];
  invocationRouteDefinitions: Array<{
    id: InvocationRoutingId;
    label: string;
    description: string;
  }>;
  agentInstructionTemplateOptions: Array<{
    value: AgentInstructionTemplateId;
    label: string;
    description: string;
  }>;
  thinkingModeOptions: Array<{
    value: ThinkingMode;
    label: string;
  }>;
}

const BASE_CATEGORY_TERMS: Record<CategoryId, string[]> = {
  general: [
    "automation",
    "scope",
    "runtime",
    "dashboard",
    "pause",
    "resume",
    "intervention",
    "auto continue",
    "console log",
    "debug log",
    "retention",
    "restart",
    "restart behavior",
    "after app restart",
    "continue sprints",
    "pause sprints",
    "cancel sprints",
    "interrupted invocation",
    "restart invocation",
    "cancel invocation",
  ],
  appearance: [
    "theme",
    "layout",
    "dock",
    "sidebar",
    "light",
    "dark",
    "motion",
    "appearance",
    "density",
    "navigation",
  ],
  models: [
    "provider",
    "providers",
    "routing",
    "route mapping",
    "route",
    "model",
    "models",
    "thinking",
    "thinking mode",
    "worker",
    "global default",
    "worker default",
    "pricing",
    "price",
    "cost",
    "token",
    "catalogue",
    "catalog",
    "speech",
    "speech to text",
    "transcription",
    "language",
    "auto detect language",
    "english",
    "german",
    "spanish",
    "french",
    "multilingual whisper",
    "text to speech",
    "tts",
    "voice",
    "kokoro",
    "piper",
    "onnx",
    "license",
    "download model",
    "installed models",
    "memory embedding model",
    "override",
    "billing",
    "usage",
    "weight",
    "concurrency",
    "manual",
    "weighted",
    "agent",
  ],
  sprint: [
    "ci",
    "merge",
    "watch",
    "loop",
    "docker",
    "execution",
    "cleanup",
    "branch",
    "branch name",
    "branch naming",
    "branch scheme",
    "default branch",
    "feature branch",
    "git",
    "git flow",
    "autofix",
    "qa",
    "quality assurance",
  ],
  browser: [
    "browser",
    "preview",
    "container",
    "port",
    "routing",
    "rebuild",
    "launch",
    "concurrent",
    "iframe",
    "visibility",
    "proxy",
  ],
  techstacks: [
    "techstack",
    "techstacks",
    "stack",
    "catalog",
    "catalogue",
    "default stack",
    "preact",
    "tanstack router",
    "gsap",
    "three.js",
    "three js",
    "lucide",
    "lucide icons",
    "web app",
    "desktop app",
    "package scan",
    "application kind",
    "unassigned",
  ],
  guidance: [
    "guidance",
    "design guidance",
    "styleguide",
    "styleguides",
    "style guide",
    "style guides",
    "tech stack",
    "tech stacks",
    "stack",
    "custom guidance",
    "custom instructions",
    "hide default styleguides",
    "hide defaults",
    "none",
  ],
  agents: [
    "agent",
    "agents",
    "prompt",
    "template",
    "templates",
    "markdown",
    "instruction",
    "instructions",
    "authoring",
    "sync",
    "mirror",
    "persistent skills",
    "skill storage",
    "storage attachment",
    "self-reflection",
    "self reflection",
    "criteria",
    "planning rating",
    "qa rating",
    "quality rating",
  ],
  memory: [
    "memory",
    "memories",
    "embedding",
    "embedding model",
    "model catalog",
    "multilingual",
    "license",
    "capture",
    "promotion",
    "learning",
    "long term",
    "short term",
    "remediation",
    "claims",
    "evidence",
  ],
  integrations: [
    "provider",
    "providers",
    "integration",
    "integrations",
    "token",
    "api key",
    "auth",
    "authentication",
    "credential",
    "credentials",
    "mount auth",
    "local auth",
    "dashboard auth",
    "git host",
    "connection",
    "repository",
    "pull request",
    "issue",
    "chat provider",
    "channel binding",
    "external channel",
    "whatsapp",
    "telegram",
    "slack",
    "teams",
    "microsoft teams",
    "discord",
    "imessage",
    "managed_bridge",
    "webhook",
    "native bridge",
    "bridge token",
    "webhook signature",
    "routing hint",
    "project selector prefix",
    "outbound replies",
    "delivery status",
    "jules",
    "clarification",
    "auto-answer clarification",
    "clarification answer mode",
    "clarification answer template",
    "jules ci autofix",
    "ci autofix",
    "autofix retries",
  ],
  mcp: [
    "mcp",
    "server",
    "servers",
    "tool",
    "tools",
    "custom mcp",
    "model context protocol",
    "code_ux",
    "toggle",
    "http",
    "sse",
    "stdio",
    "built-in",
    "injected",
  ],
  danger: [
    "reset",
    "delete",
    "danger",
    "database",
    "wipe",
    "clear",
    "destructive",
    "project overrides",
  ],
};

const INTEGRATION_FIELD_TERMS: Record<string, string[]> = {
  notion: [
    "notion workspace",
    "notion database",
    "notion api token",
    "database id",
  ],
  asana: [
    "asana workspace",
    "asana team",
    "asana project",
    "workspace gid",
    "team gid",
    "project gid",
  ],
  linear: [
    "linear workspace",
    "linear team",
    "linear project",
    "team key",
    "workspace url key",
  ],
  miro: [
    "miro board",
    "miro team",
    "board id",
  ],
  lucid: [
    "lucid",
    "lucidspark",
    "lucid document",
    "lucidspark document",
    "document id",
  ],
  figma: [
    "figma",
    "figjam",
    "figma file",
    "figjam board",
    "file key",
  ],
  mural: [
    "mural",
    "mural workspace",
    "mural id",
  ],
};

const IMPORTER_COMMON_TERMS = [
  "read-only import",
  "importer",
  "api token",
  "api secret",
  "base url",
  "default workspace",
  "default team",
  "default project",
  "default board",
  "default document",
  "default file",
  "search limit",
];

const normalizeSearchText = (value: string): string => value.trim().toLowerCase();

const unique = (values: string[]): string[] => Array.from(new Set(values.filter((value) => value.trim().length > 0)));

const toSearchTerms = (values: string[], role: SearchTermRole): SearchTerm[] => (
  unique(values).map((value) => ({ value, role }))
);

const addTerms = (entry: SettingsSearchIndexEntry | undefined, values: string[], role: SearchTermRole): void => {
  if (!entry) {
    return;
  }
  entry.terms.push(...toSearchTerms(values, role));
};

const buildEmptyIndex = (categories: Category[]): SettingsSearchIndex => (
  Object.fromEntries(
    categories.map((category) => [
      category.id,
      {
        categoryId: category.id,
        terms: [
          { value: category.label, role: "label" },
          { value: category.description, role: "description" },
          ...toSearchTerms(BASE_CATEGORY_TERMS[category.id] || [], "term"),
        ],
      },
    ]),
  ) as SettingsSearchIndex
);

export const buildSettingsSearchIndex = ({
  categories,
  providerLabels,
  integrations,
  invocationRouteDefinitions,
  agentInstructionTemplateOptions,
  thinkingModeOptions,
}: SettingsSearchIndexInput): SettingsSearchIndex => {
  const index = buildEmptyIndex(categories);
  const providerLabelValues = Object.values(providerLabels);

  addTerms(index.models, providerLabelValues, "label");
  addTerms(index.models, invocationRouteDefinitions.map((route) => route.label), "label");
  addTerms(index.models, invocationRouteDefinitions.map((route) => route.description), "description");
  addTerms(index.models, thinkingModeOptions.map((option) => option.label), "label");
  addTerms(index.models, thinkingModeOptions.map((option) => `${option.label} thinking mode`), "term");

  addTerms(index.integrations, integrations.map((integration) => integration.label), "label");
  addTerms(index.integrations, integrations.map((integration) => integration.description), "description");
  addTerms(
    index.integrations,
    integrations.flatMap((integration) => [
      ...(INTEGRATION_FIELD_TERMS[integration.id] || []),
      ...(INTEGRATION_FIELD_TERMS[integration.id] ? IMPORTER_COMMON_TERMS : []),
    ]),
    "term",
  );

  addTerms(index.agents, agentInstructionTemplateOptions.map((template) => template.label), "label");
  addTerms(index.agents, agentInstructionTemplateOptions.map((template) => template.description), "description");

  return index;
};

const pushUnique = (target: string[], value: string): void => {
  if (!target.includes(value)) {
    target.push(value);
  }
};

export const searchSettingsCategories = (
  index: SettingsSearchIndex,
  query: string,
): SettingsSearchMatches => {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) {
    return {};
  }

  return Object.fromEntries(
    Object.values(index)
      .map((entry) => {
        const match: SettingsSearchMatch = {
          categoryId: entry.categoryId,
          matchedLabels: [],
          matchedDescriptions: [],
          matchedTerms: [],
        };

        for (const term of entry.terms) {
          if (!normalizeSearchText(term.value).includes(normalizedQuery)) {
            continue;
          }
          if (term.role === "label") {
            pushUnique(match.matchedLabels, term.value);
          } else if (term.role === "description") {
            pushUnique(match.matchedDescriptions, term.value);
          } else {
            pushUnique(match.matchedTerms, term.value);
          }
        }

        const hasMatch = match.matchedLabels.length > 0
          || match.matchedDescriptions.length > 0
          || match.matchedTerms.length > 0;
        return hasMatch ? [entry.categoryId, match] : null;
      })
      .filter((match): match is [CategoryId, SettingsSearchMatch] => Boolean(match)),
  ) as SettingsSearchMatches;
};

export const getSettingsSearchMatchPreview = (
  match: SettingsSearchMatch | undefined,
  maxItems = 3,
): string[] => {
  if (!match) {
    return [];
  }
  return unique([
    ...match.matchedLabels,
    ...match.matchedTerms,
    ...match.matchedDescriptions,
  ]).slice(0, maxItems);
};
