import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type {
  DashboardMessage,
  DashboardMessageBundle,
  DashboardPluralMessages,
} from "../../../dashboard/src/v2/i18n/locales.js";
import { agentsMessages } from "../../../dashboard/src/v2/i18n/messages/agents.js";
import { appMessages } from "../../../dashboard/src/v2/i18n/messages/app.js";
import { browserPreviewMessages } from "../../../dashboard/src/v2/i18n/messages/browser-preview.js";
import { chatMessages } from "../../../dashboard/src/v2/i18n/messages/chat.js";
import { customDashboardMessages } from "../../../dashboard/src/v2/i18n/messages/custom-dashboards.js";
import { fileBrowserMessages } from "../../../dashboard/src/v2/i18n/messages/file-browser.js";
import { knowledgeMessages } from "../../../dashboard/src/v2/i18n/messages/knowledge.js";
import { liveMessages } from "../../../dashboard/src/v2/i18n/messages/live.js";
import { memoryMessages } from "../../../dashboard/src/v2/i18n/messages/memory.js";
import { nodesMessages } from "../../../dashboard/src/v2/i18n/messages/nodes.js";
import { onboardingMessages } from "../../../dashboard/src/v2/i18n/messages/onboarding.js";
import { overviewMessages } from "../../../dashboard/src/v2/i18n/messages/overview.js";
import { projectMessages } from "../../../dashboard/src/v2/i18n/messages/projects.js";
import { schedulerMessages } from "../../../dashboard/src/v2/i18n/messages/scheduler.js";
import { settingsAgentsGuidanceMessages } from "../../../dashboard/src/v2/i18n/messages/settings-agents-guidance.js";
import { settingsIntegrationsMessages } from "../../../dashboard/src/v2/i18n/messages/settings-integrations.js";
import { settingsModelsMessages } from "../../../dashboard/src/v2/i18n/messages/settings-models.js";
import { settingsOperationsMessages } from "../../../dashboard/src/v2/i18n/messages/settings-operations.js";
import { settingsShellMessages } from "../../../dashboard/src/v2/i18n/messages/settings-shell.js";
import { shellMessages } from "../../../dashboard/src/v2/i18n/messages/shell.js";
import { sprintAuthoringMessages } from "../../../dashboard/src/v2/i18n/messages/sprint-authoring.js";
import { sprintsMessages } from "../../../dashboard/src/v2/i18n/messages/sprints.js";
import { statsMessages } from "../../../dashboard/src/v2/i18n/messages/stats.js";
import { taskMessages } from "../../../dashboard/src/v2/i18n/messages/tasks.js";

const bundles = {
  agents: agentsMessages,
  app: appMessages,
  "browser-preview": browserPreviewMessages,
  chat: chatMessages,
  "custom-dashboards": customDashboardMessages,
  "file-browser": fileBrowserMessages,
  knowledge: knowledgeMessages,
  live: liveMessages,
  memory: memoryMessages,
  nodes: nodesMessages,
  onboarding: onboardingMessages,
  overview: overviewMessages,
  projects: projectMessages,
  scheduler: schedulerMessages,
  "settings-agents-guidance": settingsAgentsGuidanceMessages,
  "settings-integrations": settingsIntegrationsMessages,
  "settings-models": settingsModelsMessages,
  "settings-operations": settingsOperationsMessages,
  "settings-shell": settingsShellMessages,
  shell: shellMessages,
  "sprint-authoring": sprintAuthoringMessages,
  sprints: sprintsMessages,
  stats: statsMessages,
  tasks: taskMessages,
} as const satisfies Readonly<Record<string, DashboardMessageBundle>>;

const requiredCatalogNames = [
  "agents",
  "app",
  "browser-preview",
  "chat",
  "custom-dashboards",
  "file-browser",
  "knowledge",
  "live",
  "memory",
  "nodes",
  "onboarding",
  "overview",
  "projects",
  "scheduler",
  "settings-agents-guidance",
  "settings-integrations",
  "settings-models",
  "settings-operations",
  "settings-shell",
  "shell",
  "sprint-authoring",
  "sprints",
  "stats",
  "tasks",
] as const;

const catalogDirectory = fileURLToPath(new URL(
  "../../../dashboard/src/v2/i18n/messages/",
  import.meta.url,
));
const discoveredCatalogNames = readdirSync(catalogDirectory)
  .filter((fileName) => fileName.endsWith(".ts"))
  .map((fileName) => fileName.slice(0, -3))
  .sort();

const placeholderPattern = /\{([A-Za-z][A-Za-z0-9_]*)\}/g;
const htmlPattern = /<\/?(?:script|style|iframe|object|embed|link|meta|[a-z][a-z0-9-]*)\b[^>]*>/i;
const intentionalEmptyAffixes = new Map([
  ["settings-integrations.de.closeTerminalSuffix.text", "closeTerminalPrefix"],
  ["settings-integrations.en.removedLocallyPrefix.text", "removedLocallySuffix"],
  ["settings-integrations.de.removedLocallyPrefix.text", "removedLocallySuffix"],
]);

function placeholders(value: string): string[] {
  return [...value.matchAll(placeholderPattern)].map((match) => match[1]).sort();
}

function isPlural(value: DashboardMessage): value is DashboardPluralMessages {
  return typeof value !== "string";
}

function messageForms(value: DashboardMessage): Readonly<Record<string, string>> {
  return typeof value === "string" ? { text: value } : value;
}

describe("dashboard i18n catalog parity", () => {
  it("contains every required feature catalog", () => {
    expect(discoveredCatalogNames).toEqual([...requiredCatalogNames].sort());
  });

  it("imports every discovered feature catalog into the parity suite", () => {
    expect(Object.keys(bundles).sort()).toEqual(discoveredCatalogNames);
  });

  for (const [bundleName, bundle] of Object.entries(bundles)) {
    it(`${bundleName} has complete, safe English and German messages`, () => {
      const englishKeys = Object.keys(bundle.en).sort();
      const germanKeys = Object.keys(bundle.de).sort();
      expect(germanKeys).toEqual(englishKeys);

      for (const key of englishKeys) {
        const english = bundle.en[key];
        const german = bundle.de[key];
        expect(typeof german, `${bundleName}.${key} must keep its message shape`).toBe(typeof english);
        expect(isPlural(german), `${bundleName}.${key} plural shape`).toBe(isPlural(english));

        const englishForms = messageForms(english);
        const germanForms = messageForms(german);
        if (isPlural(english) && isPlural(german)) {
          const englishCategories = new Set(new Intl.PluralRules("en").resolvedOptions().pluralCategories);
          const germanCategories = new Set(new Intl.PluralRules("de").resolvedOptions().pluralCategories);
          expect(english.other, `${bundleName}.en.${key}.other`).toBeTruthy();
          expect(german.other, `${bundleName}.de.${key}.other`).toBeTruthy();
          expect(Object.keys(english).every((category) => englishCategories.has(category as Intl.LDMLPluralRule))).toBe(true);
          expect(Object.keys(german).every((category) => germanCategories.has(category as Intl.LDMLPluralRule))).toBe(true);
          expect(Object.keys(german).sort(), `${bundleName}.${key} plural forms`).toEqual(Object.keys(english).sort());
        }

        for (const form of Object.keys(englishForms)) {
          const englishValue = englishForms[form];
          const germanValue = germanForms[form];
          const englishPath = `${bundleName}.en.${key}.${form}`;
          const englishCompanion = intentionalEmptyAffixes.get(englishPath);
          if (!englishCompanion) {
            expect(englishValue.trim(), `${englishPath} is empty`).not.toBe("");
          } else {
            expect(String(bundle.en[englishCompanion]).trim()).not.toBe("");
          }
          const germanPath = `${bundleName}.de.${key}.${form}`;
          const germanCompanion = intentionalEmptyAffixes.get(germanPath);
          if (!germanCompanion) {
            expect(germanValue?.trim(), `${germanPath} is empty`).not.toBe("");
          } else {
            expect(String(bundle.de[germanCompanion]).trim()).not.toBe("");
          }
          expect(placeholders(germanValue), `${bundleName}.${key}.${form} placeholders`).toEqual(placeholders(englishValue));
          expect(englishValue, `${bundleName}.en.${key}.${form} contains HTML`).not.toMatch(htmlPattern);
          expect(germanValue, `${bundleName}.de.${key}.${form} contains HTML`).not.toMatch(htmlPattern);
        }
      }
    });
  }
});
