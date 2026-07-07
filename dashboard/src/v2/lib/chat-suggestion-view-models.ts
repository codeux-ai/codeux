import {
  BookOpen,
  Bug,
  Check,
  Clipboard,
  Clock,
  Code,
  Database,
  Download,
  Edit3,
  Eye,
  File,
  Folder,
  GitBranch,
  GitPullRequest,
  HelpCircle,
  Lightbulb,
  ListChecks,
  MessageCircle,
  Package,
  Play,
  RefreshCw,
  Rocket,
  Search,
  Server,
  Settings,
  Shield,
  Sparkles,
  Terminal,
  Upload,
  Zap,
} from "lucide-preact";
import type {
  ConversationMessageMetadata,
  PromptSuggestion,
} from "../../../../src/contracts/connection-chat-types.js";

export const MAX_PROMPT_SUGGESTIONS = 6;
export const DEFAULT_PROMPT_SUGGESTION_ICON = "sparkles";

const MAX_ID_LENGTH = 120;
const MAX_LABEL_LENGTH = 160;
const MAX_PROMPT_LENGTH = 8000;

export const PROMPT_SUGGESTION_ICON_REGISTRY = {
  sparkles: Sparkles,
  search: Search,
  edit: Edit3,
  code: Code,
  terminal: Terminal,
  bug: Bug,
  check: Check,
  play: Play,
  refresh: RefreshCw,
  settings: Settings,
  file: File,
  folder: Folder,
  "git-branch": GitBranch,
  "git-pull-request": GitPullRequest,
  database: Database,
  shield: Shield,
  "book-open": BookOpen,
  "message-circle": MessageCircle,
  "list-checks": ListChecks,
  rocket: Rocket,
  zap: Zap,
  lightbulb: Lightbulb,
  clipboard: Clipboard,
  download: Download,
  upload: Upload,
  eye: Eye,
  package: Package,
  server: Server,
  clock: Clock,
  "help-circle": HelpCircle,
} as const;

export type PromptSuggestionIconName = keyof typeof PROMPT_SUGGESTION_ICON_REGISTRY;

export interface PromptSuggestionViewModel {
  key: string;
  id?: string;
  label: string;
  prompt: string;
  icon: PromptSuggestionIconName;
}

type PromptSuggestionRecord = Partial<PromptSuggestion> & Record<string, unknown>;

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === "object" && value !== null && !Array.isArray(value)
);

const sanitizeInlineText = (value: unknown, maxLength: number): string | null => {
  if (typeof value !== "string") {
    return null;
  }

  const sanitized = value
    .replace(/\0/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);

  return sanitized.length > 0 ? sanitized : null;
};

const sanitizePromptText = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }

  const sanitized = value
    .replace(/\0/g, "")
    .replace(/\r\n?/g, "\n")
    .trim()
    .slice(0, MAX_PROMPT_LENGTH);

  return sanitized.length > 0 ? sanitized : null;
};

const sanitizeIconText = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }

  const sanitized = value
    .replace(/\0/g, "")
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .slice(0, 80);

  return sanitized.length > 0 ? sanitized : null;
};

export const isPromptSuggestionIconName = (value: string): value is PromptSuggestionIconName => (
  Object.prototype.hasOwnProperty.call(PROMPT_SUGGESTION_ICON_REGISTRY, value)
);

export const resolvePromptSuggestionIconName = (value: unknown): PromptSuggestionIconName => {
  const sanitized = sanitizeIconText(value);
  return sanitized && isPromptSuggestionIconName(sanitized)
    ? sanitized
    : DEFAULT_PROMPT_SUGGESTION_ICON;
};

export const getPromptSuggestionIcon = (value: unknown) => (
  PROMPT_SUGGESTION_ICON_REGISTRY[resolvePromptSuggestionIconName(value)]
);

const stableHash = (input: string): string => {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};

const getRawSuggestions = (metadata: ConversationMessageMetadata | null | undefined): unknown[] => {
  if (!isRecord(metadata)) {
    return [];
  }

  const suggestions: unknown[] = [];
  if (Array.isArray(metadata.promptSuggestions)) {
    suggestions.push(...metadata.promptSuggestions);
  }
  if (Array.isArray(metadata.suggestions)) {
    suggestions.push(...metadata.suggestions);
  }

  return suggestions;
};

const normalizePromptSuggestion = (entry: unknown): Omit<PromptSuggestionViewModel, "key"> | null => {
  if (!isRecord(entry)) {
    return null;
  }

  const suggestion = entry as PromptSuggestionRecord;
  const label = sanitizeInlineText(suggestion.label, MAX_LABEL_LENGTH);
  const prompt = sanitizePromptText(suggestion.prompt);

  if (!label || !prompt) {
    return null;
  }

  const id = sanitizeInlineText(suggestion.id, MAX_ID_LENGTH);
  const icon = resolvePromptSuggestionIconName(suggestion.icon);

  return {
    ...(id ? { id } : {}),
    label,
    prompt,
    icon,
  };
};

const makeSuggestionKey = (
  suggestion: Omit<PromptSuggestionViewModel, "key">,
  keyCounts: Map<string, number>,
): string => {
  const baseKey = suggestion.id
    ? `prompt-suggestion:${suggestion.id}`
    : `prompt-suggestion:${stableHash(`${suggestion.label}\u001f${suggestion.prompt}\u001f${suggestion.icon}`)}`;
  const count = keyCounts.get(baseKey) ?? 0;
  keyCounts.set(baseKey, count + 1);

  return count === 0 ? baseKey : `${baseKey}:${count + 1}`;
};

export const getPromptSuggestionViewModels = (
  metadata: ConversationMessageMetadata | null | undefined,
): PromptSuggestionViewModel[] => {
  const keyCounts = new Map<string, number>();
  const viewModels: PromptSuggestionViewModel[] = [];

  for (const rawSuggestion of getRawSuggestions(metadata)) {
    const suggestion = normalizePromptSuggestion(rawSuggestion);
    if (!suggestion) {
      continue;
    }

    viewModels.push({
      key: makeSuggestionKey(suggestion, keyCounts),
      ...suggestion,
    });

    if (viewModels.length >= MAX_PROMPT_SUGGESTIONS) {
      break;
    }
  }

  return viewModels;
};
