#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const docsRoot = path.join(root, "docs-web");
const defaultMarketingSrc = docsRoot;

const sectionOrder = ["Getting Started", "User Guide", "Developer Reference", "Architecture"];
const pinnedOrder = new Map([
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
  ["user-dashboard-styleguides-and-tech-stacks", 245],
  ["settings-overview", 246],
  ["settings-project-context", 247],
  ["settings-automation", 248],
  ["settings-docker-runtime", 249],
  ["settings-system-runtime", 250],
  ["settings-restart-behavior", 251],
  ["settings-database-settings", 252],
  ["settings-onboarding", 253],
  ["settings-display-settings", 254],
  ["settings-background", 255],
  ["settings-default-routing-anchors", 256],
  ["settings-base-provider-configuration", 257],
  ["settings-route-mapping", 258],
  ["settings-model-pricing", 259],
  ["settings-git-flow", 260],
  ["settings-merge-gates-autofix", 261],
  ["settings-quality-assurance", 262],
  ["settings-guardrails", 263],
  ["settings-rate-limit", 264],
  ["settings-watch-loop", 265],
  ["settings-workspace-hygiene", 266],
  ["settings-workspace-visibility", 267],
  ["settings-runtime-limits", 268],
  ["settings-techstacks", 269],
  ["settings-guidance", 270],
  ["settings-project-markdown-mirror", 271],
  ["settings-agent-routing", 272],
  ["settings-memory-system", 273],
  ["settings-long-term-remediation-schedule", 274],
  ["settings-limits", 275],
  ["settings-embedding-provider", 276],
  ["settings-worker-learnings-instruction", 277],
  ["settings-integrations", 278],
  ["settings-jules-automation", 279],
  ["settings-git-host-configuration", 280],
  ["settings-jira-configuration", 281],
  ["settings-importer-configuration", 282],
  ["settings-provider-integration", 283],
  ["settings-provider-credentials", 284],
  ["settings-mcp-servers", 285],
  ["settings-built-in-mcp", 286],
  ["settings-mcp-tool-category", 287],
  ["settings-custom-mcp-server", 288],
  ["settings-danger-zone", 289],
  ["settings-project-memory", 290],
  ["settings-system-memory", 291],
  ["settings-system-database", 292],
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
  ["developer-orchestration-debugging", 400],
  ["architecture-overview", 500],
  ["architecture-system-overview", 510],
  ["architecture-mcp-server", 520],
  ["architecture-sprint-engine", 530],
  ["architecture-virtual-workers", 540],
  ["architecture-ci-integration", 550],
  ["architecture-dashboard-architecture", 560],
  ["architecture-data-model", 570],
  ["architecture-execution-invocation-tracking", 575],
  ["architecture-external-chat-providers", 580],
  ["architecture-configuration-resolution", 590],
  ["architecture-security", 600],
]);

function parseArgs(argv) {
  const result = {
    marketingSrc: process.env.CODEUX_MARKETING_SRC || defaultMarketingSrc,
    check: false,
    dryRun: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--marketing-src") {
      result.marketingSrc = argv[index + 1];
      index += 1;
    } else if (arg === "--check") {
      result.check = true;
      result.dryRun = true;
    } else if (arg === "--dry-run") {
      result.dryRun = true;
    } else if (arg === "--help") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return result;
}

function printHelp() {
  console.log(`Usage: node scripts/sync-docs-web.mjs [--marketing-src <path>] [--check|--dry-run]

Generates the marketing site's docs registry, MDX files, and TanStack route files
from this repo's docs-web/ tree.

Defaults:
  --marketing-src ${defaultMarketingSrc}
`);
}

function toPosix(value) {
  return value.split(path.sep).join("/");
}

function collectMarkdownFiles(dir = "") {
  const absoluteDir = path.join(docsRoot, dir);
  const files = [];
  for (const entry of fs.readdirSync(absoluteDir, { withFileTypes: true })) {
    const relativePath = dir ? path.join(dir, entry.name) : entry.name;
    if (entry.isDirectory()) {
      files.push(...collectMarkdownFiles(relativePath));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(toPosix(relativePath));
    }
  }
  return files;
}

function slugFromSourcePath(sourcePath) {
  const withoutExtension = sourcePath.replace(/\.md$/i, "");
  if (withoutExtension === "index") return "docs-overview";
  if (withoutExtension.endsWith("/index")) {
    return `${withoutExtension.slice(0, -"/index".length)}-overview`.replaceAll("/", "-");
  }
  return withoutExtension.replaceAll("/", "-");
}

function sectionFromSourcePath(sourcePath) {
  if (sourcePath.startsWith("architecture/")) return "Architecture";
  if (sourcePath.startsWith("developer/")) return "Developer Reference";
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

function stripMarkdownInline(markdown) {
  const withoutHtml = markdown
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .trim();
  return stripHtmlTags(stripHtmlBlockElements(withoutHtml)).replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function stripHtmlBlockElements(value) {
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

function stripHtmlTags(value) {
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

function descriptionFromMarkdown(markdown) {
  const paragraphs = [];
  let current = [];
  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line === "---") {
      if (current.length > 0) {
        paragraphs.push(current.join(" "));
        current = [];
      }
      continue;
    }
    if (line.startsWith("#") || line.startsWith("|") || line.startsWith("```")) continue;
    current.push(line.replace(/^>\s?/, ""));
  }
  if (current.length > 0) paragraphs.push(current.join(" "));
  const description = stripMarkdownInline(paragraphs[0] || "");
  return description.length > 220 ? `${description.slice(0, 217).trimEnd()}...` : description;
}

function titleFromMarkdown(markdown, fallback) {
  return markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() || fallback;
}

function splitHref(href) {
  const hashIndex = href.indexOf("#");
  const queryIndex = href.indexOf("?");
  const indexes = [hashIndex, queryIndex].filter((index) => index >= 0);
  const splitIndex = indexes.length > 0 ? Math.min(...indexes) : -1;
  if (splitIndex === -1) return { pathPart: href, suffix: "" };
  return { pathPart: href.slice(0, splitIndex), suffix: href.slice(splitIndex) };
}

function normalizeRelativePath(currentSourcePath, hrefPath) {
  const segments = currentSourcePath.split("/");
  segments.pop();
  for (const segment of hrefPath.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments.join("/");
}

function rewriteMarkdownLinks(markdown, sourcePath, sourceToSlug) {
  return markdown.replace(/(\[[^\]]+\]\()([^)]+)(\))/g, (full, prefix, href, suffixEnd) => {
    const trimmed = href.trim();
    if (!trimmed || trimmed.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(trimmed) || trimmed.startsWith("/")) {
      return full;
    }
    const { pathPart, suffix } = splitHref(trimmed);
    if (!pathPart.endsWith(".md")) return full;
    const targetSourcePath = normalizeRelativePath(sourcePath, pathPart);
    const targetSlug = sourceToSlug.get(targetSourcePath);
    if (!targetSlug) return full;
    return `${prefix}/docs/${targetSlug}${suffix}${suffixEnd}`;
  });
}

function variableNameForSlug(slug) {
  return `${slug.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join("")}Content`;
}

function compareDocs(a, b) {
  const pinnedA = pinnedOrder.get(a.id);
  const pinnedB = pinnedOrder.get(b.id);
  if (typeof pinnedA === "number" || typeof pinnedB === "number") {
    return (pinnedA ?? Number.MAX_SAFE_INTEGER) - (pinnedB ?? Number.MAX_SAFE_INTEGER);
  }
  const sectionDelta = sectionOrder.indexOf(a.section) - sectionOrder.indexOf(b.section);
  return sectionDelta || a.sourcePath.localeCompare(b.sourcePath);
}

function buildDocs() {
  const sourcePaths = collectMarkdownFiles();
  const sourceToSlug = new Map(sourcePaths.map((sourcePath) => [sourcePath, slugFromSourcePath(sourcePath)]));
  return sourcePaths.map((sourcePath) => {
    const rawMarkdown = fs.readFileSync(path.join(docsRoot, sourcePath), "utf8");
    const id = slugFromSourcePath(sourcePath);
    return {
      id,
      sourcePath,
      path: `/docs/${id}`,
      section: sectionFromSourcePath(sourcePath),
      title: titleFromMarkdown(rawMarkdown, id),
      description: descriptionFromMarkdown(rawMarkdown),
      markdown: rewriteMarkdownLinks(rawMarkdown, sourcePath, sourceToSlug),
    };
  }).sort(compareDocs);
}

function renderRegistry(docs) {
  const slugUnion = docs.map((doc) => `  | '${doc.id}'`).join("\n");
  const registryEntries = docs.map((doc) => `  '${doc.id}': {
    id: '${doc.id}',
    path: '${doc.path}',
    section: '${doc.section}',
    title: ${JSON.stringify(doc.title)},
    description: ${JSON.stringify(doc.description)},
  },`).join("\n");
  const orderedEntries = docs.map((doc) => `  docsRegistry['${doc.id}'],`).join("\n");
  return `import type { PageMeta } from '../../lib/page-meta'

export type DocsSection = 'Getting Started' | 'User Guide' | 'Developer Reference' | 'Architecture'

export type DocsSlug =
${slugUnion}

export interface DocsRegistryEntry extends Partial<Omit<PageMeta, 'title' | 'description'>> {
  id: DocsSlug
  path: string
  section: DocsSection
  title: string
  description: string
}

export const docsRegistry: Record<DocsSlug, DocsRegistryEntry> = {
${registryEntries}
}

export const orderedDocs: DocsRegistryEntry[] = [
${orderedEntries}
]

export const groupedDocs = orderedDocs.reduce<Record<DocsSection, DocsRegistryEntry[]>>(
  (acc, doc) => {
    if (!acc[doc.section]) {
      acc[doc.section] = []
    }
    acc[doc.section].push(doc)
    return acc
  },
  {} as Record<DocsSection, DocsRegistryEntry[]>
)
`;
}

function renderRoute(doc) {
  const variableName = variableNameForSlug(doc.id);
  return `import { createLazyFileRoute } from '@tanstack/react-router'
import ${variableName} from '../content/docs/${doc.id}.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/${doc.id}')({
  component: () => (
    <DocsPage id="${doc.id}">
      <${variableName} />
    </DocsPage>
  )
})
`;
}

function writeIfChanged(filePath, content, { dryRun, changed }) {
  const current = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : null;
  if (current === content) return;
  changed.push(filePath);
  if (!dryRun) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
  }
}

function removeIfPresent(filePath, { dryRun, changed }) {
  if (!fs.existsSync(filePath)) return;
  changed.push(filePath);
  if (!dryRun) {
    fs.rmSync(filePath);
  }
}

function pruneStaleGeneratedFiles({ contentDir, routesDir, docs, dryRun, changed }) {
  const expectedContentFiles = new Set([
    "index.ts",
    "registry.ts",
    ...docs.map((doc) => `${doc.id}.mdx`),
  ]);
  if (fs.existsSync(contentDir)) {
    for (const entry of fs.readdirSync(contentDir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      if (!entry.name.endsWith(".mdx") && entry.name !== "registry.ts" && entry.name !== "index.ts") continue;
      if (!expectedContentFiles.has(entry.name)) {
        removeIfPresent(path.join(contentDir, entry.name), { dryRun, changed });
      }
    }
  }

  const expectedRouteFiles = new Set(docs.map((doc) => `docs.${doc.id}.lazy.tsx`));
  if (fs.existsSync(routesDir)) {
    for (const entry of fs.readdirSync(routesDir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      if (!/^docs\..+\.lazy\.tsx$/.test(entry.name)) continue;
      if (!expectedRouteFiles.has(entry.name)) {
        removeIfPresent(path.join(routesDir, entry.name), { dryRun, changed });
      }
    }
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const docs = buildDocs();
  const contentDir = path.join(options.marketingSrc, "content", "docs");
  const routesDir = path.join(options.marketingSrc, "routes");
  const changed = [];

  pruneStaleGeneratedFiles({ contentDir, routesDir, docs, dryRun: options.dryRun, changed });

  for (const doc of docs) {
    writeIfChanged(path.join(contentDir, `${doc.id}.mdx`), doc.markdown, { dryRun: options.dryRun, changed });
    writeIfChanged(path.join(routesDir, `docs.${doc.id}.lazy.tsx`), renderRoute(doc), { dryRun: options.dryRun, changed });
  }

  writeIfChanged(path.join(contentDir, "registry.ts"), renderRegistry(docs), { dryRun: options.dryRun, changed });
  writeIfChanged(path.join(contentDir, "index.ts"), "export * from './registry'\n", { dryRun: options.dryRun, changed });
  writeIfChanged(path.join(routesDir, "docs", "index.tsx"), `import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/docs/')({
  beforeLoad: () => {
    throw redirect({
      to: '/docs/docs-overview',
      replace: true,
    })
  },
})
`, { dryRun: options.dryRun, changed });

  if (changed.length > 0) {
    console.log(`${options.dryRun ? "Would update" : "Updated"} ${changed.length} marketing docs file(s):`);
    for (const filePath of changed) {
      console.log(`- ${path.relative(options.marketingSrc, filePath)}`);
    }
    if (options.check) {
      process.exit(1);
    }
    return;
  }
  console.log("Marketing docs are already in sync.");
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
