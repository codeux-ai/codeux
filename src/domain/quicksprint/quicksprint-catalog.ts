import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import type { QuicksprintTemplateRecord } from "../../contracts/quicksprint-types.js";
import { parseQuicksprintTemplateMarkdown } from "./quicksprint-template-markdown.js";

const FULLSTACK_JS_APP_PURPOSE = {
  id: "fullstack-js-app",
  label: "Fullstack JS App",
  description: "Default Quicksprint templates for JavaScript and TypeScript products spanning frontend, backend, data, and UX surfaces.",
} as const;

const DEFAULT_TEMPLATE_ORDER = [
  "qs-code-quality",
  "qs-security",
  "qs-ui-a11y",
  "qs-ui-design",
  "qs-ui-responsive",
  "qs-ui-interactions",
] as const;

function resolveTemplateDirectories(): string[] {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  return [
    path.join(process.cwd(), ".code-ux", "quicksprints", "templates"),
    path.resolve(moduleDir, "../../../../.code-ux/quicksprints/templates"),
    path.resolve(moduleDir, "../../../.code-ux/quicksprints/templates"),
  ];
}

function readTemplateDirectory(directory: string): QuicksprintTemplateRecord[] {
  let files: string[];
  try {
    files = fs.readdirSync(directory);
  } catch {
    return [];
  }

  const now = new Date().toISOString();
  const templates: QuicksprintTemplateRecord[] = [];
  for (const file of files.filter(isTemplateFile).sort()) {
    try {
      const filePath = path.join(directory, file);
      const parsed = parseQuicksprintTemplateMarkdown(fs.readFileSync(filePath, "utf8"));
      const raw = parsed.metadata;
      const id = typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : stripTemplateExtension(file);
      const name = typeof raw.name === "string" ? raw.name.trim() : "";
      const agentInstructionMarkdown = parsed.agentInstructionMarkdown;
      if (!id || !name || !agentInstructionMarkdown) {
        continue;
      }

      templates.push({
        id,
        projectId: null,
        name,
        description: typeof raw.description === "string" ? raw.description : "",
        icon: typeof raw.icon === "string" && raw.icon.trim() ? raw.icon : "Sparkles",
        category: typeof raw.category === "string" && raw.category.trim() ? raw.category : "engineering",
        categoryColor: typeof raw.categoryColor === "string" ? raw.categoryColor : undefined,
        agentInstructionMarkdown,
        defaultTaskCount: typeof raw.defaultTaskCount === "number" && Number.isFinite(raw.defaultTaskCount) && raw.defaultTaskCount > 0
          ? raw.defaultTaskCount
          : 5,
        isBuiltIn: true,
        agentPresetId: typeof raw.agentPresetId === "string" ? raw.agentPresetId : undefined,
        purpose: typeof raw.purpose === "string" ? raw.purpose : FULLSTACK_JS_APP_PURPOSE.id,
        purposeLabel: typeof raw.purposeLabel === "string" ? raw.purposeLabel : FULLSTACK_JS_APP_PURPOSE.label,
        purposeDescription: typeof raw.purposeDescription === "string" ? raw.purposeDescription : FULLSTACK_JS_APP_PURPOSE.description,
        createdAt: typeof raw.createdAt === "string" ? raw.createdAt : now,
        updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : now,
      });
    } catch {
      // Ignore malformed bundled template files so one bad file does not break startup.
    }
  }

  const order = new Map<string, number>(DEFAULT_TEMPLATE_ORDER.map((id, index) => [id, index]));
  return templates.sort((left, right) => {
    const leftOrder = order.get(left.id) ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = order.get(right.id) ?? Number.MAX_SAFE_INTEGER;
    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }
    return left.name.localeCompare(right.name);
  });
}

function isTemplateFile(fileName: string): boolean {
  return fileName.toLowerCase().endsWith(".md");
}

function stripTemplateExtension(fileName: string): string {
  return fileName.replace(/\.md$/i, "");
}

function readBuiltInTemplates(): QuicksprintTemplateRecord[] {
  for (const directory of resolveTemplateDirectories()) {
    const templates = readTemplateDirectory(directory);
    if (templates.length > 0) {
      return templates;
    }
  }
  return [];
}

export const BUILTIN_QUICKSPRINT_TEMPLATES: QuicksprintTemplateRecord[] = readBuiltInTemplates();
