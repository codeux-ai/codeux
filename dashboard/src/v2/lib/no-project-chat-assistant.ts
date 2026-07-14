export const CHAT_DRAFT_QUERY_PARAM = "draft";
export const ASSISTANT_OPEN_ADD_PROJECT_EVENT = "codeux:assistant-open-add-project";

export type NoProjectAssistantPromptId =
  | "add-first-project"
  | "add-desktop-app-project"
  | "add-web-app-project"
  | "explain-code-ux"
  | "change-settings";

export type NoProjectAssistantActionKind =
  | "open-add-project"
  | "route"
  | "open-onboarding";

export interface NoProjectAssistantAction {
  id: string;
  label: string;
  description: string;
  kind: NoProjectAssistantActionKind;
  to?: string;
}

export interface NoProjectAssistantPrompt {
  id: NoProjectAssistantPromptId;
  label: string;
  prompt: string;
  reply: string;
  actions: NoProjectAssistantAction[];
}

const addProjectAction: NoProjectAssistantAction = {
  id: "open-add-project",
  label: "Open Add Project",
  description: "Launch the existing Add Project flow.",
  kind: "open-add-project",
};

const projectsAction: NoProjectAssistantAction = {
  id: "view-projects",
  label: "View Projects",
  description: "Open the project list.",
  kind: "route",
  to: "/projects",
};

const settingsAction: NoProjectAssistantAction = {
  id: "open-settings",
  label: "Open Settings",
  description: "Review providers, routing, and dashboard preferences.",
  kind: "route",
  to: "/config",
};

const onboardingAction: NoProjectAssistantAction = {
  id: "open-onboarding",
  label: "Start Onboarding",
  description: "Reopen the guided setup flow.",
  kind: "open-onboarding",
};

const docsAction: NoProjectAssistantAction = {
  id: "read-docs",
  label: "Read Docs",
  description: "Open the dashboard chat documentation.",
  kind: "route",
  to: "/docs/user-dashboard-chat",
};

const quickstartAction: NoProjectAssistantAction = {
  id: "read-quickstart",
  label: "Quickstart",
  description: "Open the first-run quickstart.",
  kind: "route",
  to: "/docs/user-quickstart",
};

export const NO_PROJECT_ASSISTANT_PROMPTS: readonly NoProjectAssistantPrompt[] = [
  {
    id: "add-first-project",
    label: "Add my first project",
    prompt: "Help me add my first Code UX project.",
    reply: "Start by connecting a local folder, cloning a repository, or creating a new project. I can open the existing Add Project flow; it will keep creation, setup, and confirmations inside the normal dashboard path.",
    actions: [addProjectAction, projectsAction, quickstartAction],
  },
  {
    id: "add-desktop-app-project",
    label: "Build a desktop app",
    prompt: "Add a project and set it up as a desktop app.",
    reply: "Use Add Project, choose a local or new project source, and select the desktop app setup path when the project is created. Code UX will keep the project creation explicit before any setup work runs.",
    actions: [addProjectAction, projectsAction, quickstartAction],
  },
  {
    id: "add-web-app-project",
    label: "Build a web app",
    prompt: "Add a project and set it up as a web app.",
    reply: "Open Add Project and choose the web app setup path for a new project, or add an existing repository first and initialize it from the Projects page. Nothing runs until you confirm the project details.",
    actions: [addProjectAction, projectsAction, quickstartAction],
  },
  {
    id: "explain-code-ux",
    label: "Explain Code UX",
    prompt: "Explain what Code UX does before I add a project.",
    reply: "Code UX is a local-first runtime for agentic coding work. It turns a goal into a managed sprint, routes work to your configured provider CLIs, runs tasks in isolated Docker workspaces, and surfaces progress, chat, invocations, and CI gates in this dashboard.",
    actions: [onboardingAction, docsAction, projectsAction],
  },
  {
    id: "change-settings",
    label: "Change settings",
    prompt: "Show me where to change Code UX settings.",
    reply: "Settings is where provider credentials, routing, Docker behavior, appearance, onboarding, and project defaults live. Open Settings to review them directly, or restart onboarding for a guided pass through the core choices.",
    actions: [settingsAction, onboardingAction, docsAction],
  },
] as const;

const localizeAction = (
  action: NoProjectAssistantAction,
  locale: DashboardLocale,
): NoProjectAssistantAction => {
  const keys: Record<string, readonly [Parameters<typeof translateChatMessage>[1], Parameters<typeof translateChatMessage>[1]]> = {
    "open-add-project": ["openAddProject", "launchAddProject"],
    "view-projects": ["viewProjects", "openProjectList"],
    "open-settings": ["openSettings", "reviewSettings"],
    "open-onboarding": ["startOnboarding", "reopenOnboarding"],
    "read-docs": ["readDocs", "openChatDocs"],
    "read-quickstart": ["quickstart", "openQuickstart"],
  };
  const pair = keys[action.id];
  return !pair ? action : {
    ...action,
    label: translateChatMessage(locale, pair[0]),
    description: translateChatMessage(locale, pair[1]),
  };
};

const PROMPT_LABEL_KEYS: Record<NoProjectAssistantPromptId, Parameters<typeof translateChatMessage>[1]> = {
  "add-first-project": "addFirstProject",
  "add-desktop-app-project": "buildDesktopApp",
  "add-web-app-project": "buildWebApp",
  "explain-code-ux": "explainCodeUx",
  "change-settings": "changeSettings",
};

const PROMPT_REPLY_KEYS: Record<NoProjectAssistantPromptId, Parameters<typeof translateChatMessage>[1]> = {
  "add-first-project": "noProjectReplyAdd",
  "add-desktop-app-project": "noProjectReplyDesktop",
  "add-web-app-project": "noProjectReplyWeb",
  "explain-code-ux": "noProjectReplyExplain",
  "change-settings": "noProjectReplySettings",
};

export const getNoProjectAssistantPrompts = (
  locale: DashboardLocale = "en",
): readonly NoProjectAssistantPrompt[] => NO_PROJECT_ASSISTANT_PROMPTS.map((prompt) => ({
  ...prompt,
  label: translateChatMessage(locale, PROMPT_LABEL_KEYS[prompt.id]),
  reply: translateChatMessage(locale, PROMPT_REPLY_KEYS[prompt.id]),
  actions: prompt.actions.map((action) => localizeAction(action, locale)),
}));

export const getNoProjectAssistantPrompt = (
  promptId: NoProjectAssistantPromptId,
  locale: DashboardLocale = "en",
): NoProjectAssistantPrompt => {
  const prompt = getNoProjectAssistantPrompts(locale).find((item) => item.id === promptId);
  if (!prompt) {
    throw new Error(`Unknown no-project assistant prompt: ${promptId}`);
  }
  return prompt;
};

export interface NoProjectAssistantReply {
  body: string;
  actions: NoProjectAssistantAction[];
  matchedPromptId: NoProjectAssistantPromptId | null;
}

export const createNoProjectAssistantReply = (
  input: string,
  locale: DashboardLocale = "en",
): NoProjectAssistantReply => {
  const normalized = input.trim().toLowerCase();
  const localizedPrompts = getNoProjectAssistantPrompts(locale);
  const matchedPrompt = localizedPrompts.find((prompt) => (
    prompt.prompt.toLowerCase() === normalized
    || prompt.label.toLowerCase() === normalized
  ));
  if (matchedPrompt) {
    return {
      body: matchedPrompt.reply,
      actions: matchedPrompt.actions,
      matchedPromptId: matchedPrompt.id,
    };
  }

  return {
    body: translateChatMessage(locale, "noProjectReplyFallback"),
    actions: [addProjectAction, settingsAction, docsAction].map((action) => localizeAction(action, locale)),
    matchedPromptId: null,
  };
};

export const readChatDraftFromLocation = (location: Location): string | null => {
  const value = new URLSearchParams(location.search).get(CHAT_DRAFT_QUERY_PARAM);
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
};

export const clearChatDraftFromUrl = (windowRef: Window): void => {
  const url = new URL(windowRef.location.href);
  if (!url.searchParams.has(CHAT_DRAFT_QUERY_PARAM)) {
    return;
  }
  url.searchParams.delete(CHAT_DRAFT_QUERY_PARAM);
  windowRef.history.replaceState(windowRef.history.state, "", `${url.pathname}${url.search}${url.hash}`);
};
import type { DashboardLocale } from "../i18n/locales.js";
import { translateChatMessage } from "../i18n/messages/chat.js";
