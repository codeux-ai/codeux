#!/usr/bin/env node

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dashboardRoot = path.join(root, "dashboard/src");
const allowlistPath = path.join(root, "scripts/dashboard-i18n-allowlist.json");

const ignoredDirectoryNames = new Set(["__tests__", "fixtures"]);
const userFacingAttributes = new Set([
  "alt",
  "aria-description",
  "aria-label",
  "cancelLabel",
  "confirmLabel",
  "description",
  "emptyText",
  "helperText",
  "label",
  "placeholder",
  "title",
]);
const userFacingMetadataKeys = new Set([
  "ariaDescription",
  "ariaLabel",
  "description",
  "dockLabel",
  "emptyText",
  "eyebrow",
  "helperText",
  "label",
  "placeholder",
  "subtitle",
  "title",
]);
const metadataContainerPattern = /(?:ACTION|CATEGORY|COLUMN|CONTROL|FILTER|ITEM|MENU|NAVIGATION|OPTION|SECTION|STEP|TAB|TOOLTIP)/i;
const technicalTextPattern = /^(?:\d+(?:\.\d+)?%?|--|\.\.\.|[A-Z][A-Z0-9_-]{1,8}|(?:Ctrl|Cmd|Alt|Shift|Enter|Esc|Tab|Space|Home|End|UTC|JSON|HTML|CSS|JS|TS|TSX|JSX|MCP|API|CLI|CI|PR|URL|HTTP|HTTPS|SSE|stdio|Docker|Git|GitHub|GitLab|Code UX|CodeUX|Jules|Gemini|Codex|Claude|Claude Code|OpenCode|Qwen|Antigravity|Notion|Jira|Slack|Teams|Figma|FigJam|Figma \/ FigJam|Google Drive|Monaco|MIT))$/;

function toRelative(filePath) {
  return path.relative(root, filePath).split(path.sep).join("/");
}

async function walkProductionDashboardFiles() {
  const files = [];
  async function walk(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!ignoredDirectoryNames.has(entry.name)) {
          await walk(path.join(directory, entry.name));
        }
        continue;
      }
      if (!entry.isFile() || (!entry.name.endsWith(".ts") && !entry.name.endsWith(".tsx")) || entry.name.endsWith(".d.ts")) {
        continue;
      }
      files.push(path.join(directory, entry.name));
    }
  }
  await walk(dashboardRoot);
  return files;
}

function normalizeText(value) {
  return value.replace(/\s+/g, " ").trim();
}

function isUserFacingText(value) {
  const normalized = normalizeText(value);
  return normalized.length > 1
    && /[A-Za-zÄÖÜäöüß]/.test(normalized)
    && !technicalTextPattern.test(normalized);
}

function getLine(sourceFile, node) {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function getPropertyNameText(name) {
  if (!name) return null;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  return null;
}

function getContainingVariableName(node) {
  let current = node.parent;
  while (current) {
    if (ts.isVariableDeclaration(current) && ts.isIdentifier(current.name)) {
      return current.name.text;
    }
    if (ts.isSourceFile(current) || ts.isFunctionLike(current)) {
      return null;
    }
    current = current.parent;
  }
  return null;
}

function hasAriaHidden(openingElement) {
  return openingElement.attributes.properties.some((attribute) => (
    ts.isJsxAttribute(attribute)
      && attribute.name.text === "aria-hidden"
      && (!attribute.initializer
        || (ts.isStringLiteral(attribute.initializer) && attribute.initializer.text === "true")
        || (ts.isJsxExpression(attribute.initializer) && attribute.initializer.expression?.kind === ts.SyntaxKind.TrueKeyword))
  ));
}

function getJsxOpeningElement(node) {
  const parent = node.parent;
  if (ts.isJsxElement(parent)) return parent.openingElement;
  if (ts.isJsxElement(parent?.parent)) return parent.parent.openingElement;
  return null;
}

export function inspectDashboardI18nSource(filePath, source) {
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const violations = [];
  const addViolation = (node, kind, text) => {
    const normalized = normalizeText(text);
    if (isUserFacingText(normalized)) {
      violations.push({ path: toRelative(filePath), line: getLine(sourceFile, node), kind, text: normalized });
    }
  };

  const visit = (node) => {
    if (ts.isJsxText(node)) {
      const openingElement = getJsxOpeningElement(node);
      if (!openingElement || !hasAriaHidden(openingElement)) {
        addViolation(node, "jsx-text", node.text);
      }
    } else if (ts.isJsxExpression(node) && node.expression && (ts.isStringLiteral(node.expression) || ts.isNoSubstitutionTemplateLiteral(node.expression))) {
      const openingElement = getJsxOpeningElement(node);
      if (!openingElement || !hasAriaHidden(openingElement)) {
        addViolation(node, "jsx-expression", node.expression.text);
      }
    } else if (ts.isJsxAttribute(node) && userFacingAttributes.has(node.name.text) && node.initializer) {
      if (ts.isStringLiteral(node.initializer)) {
        addViolation(node, `attribute:${node.name.text}`, node.initializer.text);
      } else if (ts.isJsxExpression(node.initializer) && node.initializer.expression
        && (ts.isStringLiteral(node.initializer.expression) || ts.isNoSubstitutionTemplateLiteral(node.initializer.expression))) {
        addViolation(node, `attribute:${node.name.text}`, node.initializer.expression.text);
      }
    } else if (ts.isPropertyAssignment(node)) {
      const key = getPropertyNameText(node.name);
      const containerName = getContainingVariableName(node);
      if (key && userFacingMetadataKeys.has(key) && containerName && metadataContainerPattern.test(containerName)
        && (ts.isStringLiteral(node.initializer) || ts.isNoSubstitutionTemplateLiteral(node.initializer))) {
        addViolation(node, `metadata:${key}`, node.initializer.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return violations;
}

function validateAllowlist(value) {
  if (!value || value.version !== 1 || !Array.isArray(value.entries)) {
    throw new Error("dashboard i18n allowlist must contain { version: 1, entries: [] }");
  }
  return value.entries.map((entry, index) => {
    if (!entry || typeof entry.path !== "string"
      || !Number.isInteger(entry.line) || entry.line < 1
      || typeof entry.kind !== "string" || typeof entry.text !== "string"
      || typeof entry.rationale !== "string" || entry.rationale.trim().length < 12) {
      throw new Error(`dashboard i18n allowlist entry ${index + 1} must include exact path, line, kind, text, and a reviewable rationale`);
    }
    return entry;
  });
}

function applyAllowlist(violations, entries) {
  const unused = new Set(entries);
  const blocking = violations.filter((violation) => {
    const entry = entries.find((candidate) => (
      candidate.path === violation.path
        && candidate.line === violation.line
        && candidate.kind === violation.kind
        && candidate.text === violation.text
    ));
    if (entry) unused.delete(entry);
    return !entry;
  });
  return { blocking, unused: [...unused] };
}

export async function checkDashboardI18n() {
  const [files, allowlistSource] = await Promise.all([
    walkProductionDashboardFiles(),
    readFile(allowlistPath, "utf8"),
  ]);
  const allowlist = validateAllowlist(JSON.parse(allowlistSource));
  const sources = await Promise.all(files.map(async (filePath) => ({ filePath, source: await readFile(filePath, "utf8") })));
  const violations = sources.flatMap(({ filePath, source }) => {
    const relativePath = toRelative(filePath);
    if (relativePath.startsWith("dashboard/src/v2/i18n/messages/")) return [];
    return inspectDashboardI18nSource(filePath, source);
  });
  const result = applyAllowlist(violations, allowlist);
  return { ...result, scannedFiles: files.length, candidateCount: violations.length, allowlistCount: allowlist.length };
}

export async function runDashboardI18nCheck({ log = console } = {}) {
  const result = await checkDashboardI18n();
  log.log(`Dashboard i18n: scanned ${result.scannedFiles} production TS/TSX files and ${result.candidateCount} static copy candidates.`);
  if (result.unused.length > 0) {
    log.error("Unused dashboard i18n allowlist entries must be removed:");
    for (const entry of result.unused) log.error(`  - ${entry.path}:${entry.line} [${entry.kind}] ${JSON.stringify(entry.text)}`);
  }
  if (result.blocking.length > 0) {
    log.error("Untranslated dashboard-authored copy found outside message bundles:");
    for (const violation of result.blocking.slice(0, 50)) {
      log.error(`  - ${violation.path}:${violation.line} [${violation.kind}] ${JSON.stringify(violation.text)}`);
    }
    if (result.blocking.length > 50) log.error(`  ... ${result.blocking.length - 50} more`);
  }
  if (result.blocking.length === 0 && result.unused.length === 0) {
    log.log(`Dashboard i18n: passed with ${result.allowlistCount} exact, rationale-bearing exemptions.`);
    return true;
  }
  return false;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  if (!await runDashboardI18nCheck()) process.exitCode = 1;
}
