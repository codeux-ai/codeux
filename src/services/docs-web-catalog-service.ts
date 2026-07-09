import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  DocsWebCollectionResponse,
  DocsWebDocument,
  DocsWebEntry,
  DocsWebSection,
} from "../contracts/docs-web-types.js";

const DEFAULT_DOCS_WEB_ROOT = fileURLToPath(new URL("../../docs-web", import.meta.url));
const SECTION_ORDER: DocsWebSection[] = ["Getting Started", "User Guide", "Developer Reference", "Architecture"];

const PINNED_ORDER = new Map<string, number>([
  ["docs-overview", 0],
  ["user-introduction", 10],
  ["user-installation", 20],
  ["user-quickstart", 30],
  ["user-overview", 40],
  ["user-mcp-clients", 50],
  ["user-sprint-orchestration", 60],
  ["user-providers-and-models", 70],
  ["user-automation-and-ci", 80],
  ["user-quicksprints", 90],
  ["user-troubleshooting", 100],
  ["user-dashboard-overview", 110],
  ["user-dashboard-projects", 120],
  ["user-dashboard-sprints", 130],
  ["user-dashboard-tasks", 140],
  ["user-dashboard-live-session", 150],
  ["user-dashboard-chat", 160],
  ["user-dashboard-agents", 170],
  ["user-dashboard-nodes", 175],
  ["user-dashboard-nodes-canvas", 176],
  ["user-dashboard-node-flows", 177],
  ["user-dashboard-scheduler", 180],
  ["user-dashboard-memory", 190],
  ["user-dashboard-knowledge", 200],
  ["user-dashboard-file-browser", 210],
  ["user-dashboard-browser-preview", 220],
  ["user-dashboard-stats", 230],
  ["user-dashboard-settings", 240],
  ["developer-overview", 300],
  ["developer-mcp-tools", 310],
  ["developer-management-actions", 320],
  ["developer-http-api", 330],
  ["developer-websocket-realtime", 340],
  ["developer-configuration", 350],
  ["developer-feature-flags", 355],
  ["developer-settings-reference", 360],
  ["developer-sprint-format", 370],
  ["developer-building-from-source", 380],
  ["developer-testing", 390],
  ["architecture-overview", 500],
  ["architecture-system-overview", 510],
  ["architecture-mcp-server", 520],
  ["architecture-sprint-engine", 530],
  ["architecture-virtual-workers", 540],
  ["architecture-ci-integration", 550],
  ["architecture-dashboard-architecture", 560],
  ["architecture-data-model", 570],
  ["architecture-configuration-resolution", 580],
  ["architecture-security", 590],
]);

function toPosixPath(value: string): string {
  return value.split(path.sep).join("/");
}

function slugFromSourcePath(sourcePath: string): string {
  const withoutExtension = sourcePath.replace(/\.md$/i, "");
  if (withoutExtension === "index") {
    return "docs-overview";
  }
  if (withoutExtension.endsWith("/index")) {
    return `${withoutExtension.slice(0, -"/index".length)}-overview`.replaceAll("/", "-");
  }
  return withoutExtension.replaceAll("/", "-");
}

function sectionFromSourcePath(sourcePath: string): DocsWebSection {
  if (sourcePath.startsWith("architecture/")) {
    return "Architecture";
  }
  if (sourcePath.startsWith("developer/")) {
    return "Developer Reference";
  }
  if (
    sourcePath === "index.md"
    || sourcePath === "user/introduction.md"
    || sourcePath === "user/installation.md"
    || sourcePath === "user/quickstart.md"
  ) {
    return "Getting Started";
  }
  return "User Guide";
}

function titleFromMarkdown(markdown: string, fallback: string): string {
  const heading = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return heading || fallback;
}

function stripMarkdownInline(markdown: string): string {
  const withoutHtml = markdown
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .trim();
  return stripHtmlTags(stripHtmlBlockElements(withoutHtml)).replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function stripHtmlBlockElements(value: string): string {
  let output = "";
  let index = 0;
  while (index < value.length) {
    const lowerRemainder = value.slice(index).toLowerCase();
    const tag = lowerRemainder.startsWith("<script") ? "script" : lowerRemainder.startsWith("<style") ? "style" : null;
    if (!tag) {
      output += value[index];
      index += 1;
      continue;
    }

    const closeMarker = `</${tag}`;
    const closeStart = value.toLowerCase().indexOf(closeMarker, index + tag.length + 1);
    if (closeStart === -1) {
      break;
    }
    const closeEnd = value.indexOf(">", closeStart + closeMarker.length);
    index = closeEnd === -1 ? value.length : closeEnd + 1;
  }
  return output;
}

function stripHtmlTags(value: string): string {
  let output = "";
  let insideTag = false;
  for (const character of value) {
    if (character === "<") {
      insideTag = true;
      continue;
    }
    if (insideTag) {
      if (character === ">") {
        insideTag = false;
      }
      continue;
    }
    output += character;
  }
  return output;
}

function descriptionFromMarkdown(markdown: string): string {
  const lines = markdown.split(/\r?\n/);
  const paragraphs: string[] = [];
  let current: string[] = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line === "---") {
      if (current.length > 0) {
        paragraphs.push(current.join(" "));
        current = [];
      }
      continue;
    }
    if (line.startsWith("#") || line.startsWith("|") || line.startsWith("```")) {
      continue;
    }
    current.push(line.replace(/^>\s?/, ""));
  }
  if (current.length > 0) {
    paragraphs.push(current.join(" "));
  }
  const description = stripMarkdownInline(paragraphs[0] || "");
  return description.length > 220 ? `${description.slice(0, 217).trimEnd()}...` : description;
}

function collectMarkdownFiles(root: string, dir = ""): string[] {
  const absoluteDir = path.join(root, dir);
  if (!fs.existsSync(absoluteDir)) {
    return [];
  }

  const entries = fs.readdirSync(absoluteDir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const relativePath = dir ? path.join(dir, entry.name) : entry.name;
    if (entry.isDirectory()) {
      files.push(...collectMarkdownFiles(root, relativePath));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(toPosixPath(relativePath));
    }
  }
  return files;
}

function compareDocs(a: DocsWebEntry, b: DocsWebEntry): number {
  const pinnedA = PINNED_ORDER.get(a.id);
  const pinnedB = PINNED_ORDER.get(b.id);
  if (typeof pinnedA === "number" || typeof pinnedB === "number") {
    return (pinnedA ?? Number.MAX_SAFE_INTEGER) - (pinnedB ?? Number.MAX_SAFE_INTEGER);
  }
  const sectionDelta = SECTION_ORDER.indexOf(a.section) - SECTION_ORDER.indexOf(b.section);
  if (sectionDelta !== 0) {
    return sectionDelta;
  }
  return a.sourcePath.localeCompare(b.sourcePath);
}

export class DocsWebCatalogService {
  constructor(private readonly root = DEFAULT_DOCS_WEB_ROOT) {}

  listDocuments(): DocsWebDocument[] {
    return collectMarkdownFiles(this.root).map((sourcePath) => {
      const contentMarkdown = fs.readFileSync(path.join(this.root, sourcePath), "utf8");
      const id = slugFromSourcePath(sourcePath);
      const title = titleFromMarkdown(contentMarkdown, id);
      return {
        id,
        path: `/docs/${id}`,
        sourcePath,
        section: sectionFromSourcePath(sourcePath),
        title,
        description: descriptionFromMarkdown(contentMarkdown),
        contentMarkdown,
      };
    }).sort(compareDocs);
  }

  getCollection(): DocsWebCollectionResponse {
    const docs = this.listDocuments().map(({ contentMarkdown: _contentMarkdown, ...entry }) => entry);
    const groupedDocs = SECTION_ORDER.reduce<Record<DocsWebSection, DocsWebEntry[]>>((acc, section) => {
      acc[section] = [];
      return acc;
    }, {} as Record<DocsWebSection, DocsWebEntry[]>);
    for (const doc of docs) {
      groupedDocs[doc.section].push(doc);
    }
    return {
      defaultDocId: "docs-overview",
      docs,
      groupedDocs,
    };
  }

  getDocument(id: string): DocsWebDocument | null {
    return this.listDocuments().find((doc) => doc.id === id) ?? null;
  }
}
