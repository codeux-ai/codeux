import type { ParsedSkillMarkdown, SkillRecord } from "../contracts/skill-types.js";

const FRONTMATTER_BOUNDARY = "---";

function normalizeString(value: unknown): string {
  return String(value ?? "").trim();
}

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseListValue(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed) {
    return [];
  }
  const inner = trimmed.startsWith("[") && trimmed.endsWith("]")
    ? trimmed.slice(1, -1)
    : trimmed;
  return inner
    .split(",")
    .map((entry) => stripQuotes(entry).trim())
    .filter(Boolean);
}

function parseFrontmatter(raw: string): { fields: Record<string, string | string[]>; body: string } {
  if (!raw.startsWith(`${FRONTMATTER_BOUNDARY}\n`) && !raw.startsWith(`${FRONTMATTER_BOUNDARY}\r\n`)) {
    return { fields: {}, body: raw };
  }

  const newline = raw.startsWith(`${FRONTMATTER_BOUNDARY}\r\n`) ? "\r\n" : "\n";
  const closeMatch = raw.slice(FRONTMATTER_BOUNDARY.length + newline.length).match(/\r?\n---(?:\r?\n|$)/);
  if (!closeMatch || closeMatch.index === undefined) {
    return { fields: {}, body: raw };
  }

  const frontmatterStart = FRONTMATTER_BOUNDARY.length + newline.length;
  const closeIndex = frontmatterStart + closeMatch.index;
  const frontmatter = raw.slice(frontmatterStart, closeIndex);
  const body = raw.slice(closeIndex + closeMatch[0].length);
  const fields: Record<string, string | string[]> = {};
  let activeListKey: string | null = null;

  for (const line of frontmatter.split(/\r?\n/)) {
    const listMatch = line.match(/^\s*-\s+(.+)$/);
    if (activeListKey && listMatch) {
      const current = Array.isArray(fields[activeListKey]) ? fields[activeListKey] : [];
      fields[activeListKey] = [...current, stripQuotes(listMatch[1]!).trim()].filter(Boolean);
      continue;
    }

    const pairMatch = line.match(/^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*)$/);
    if (!pairMatch) {
      activeListKey = null;
      continue;
    }

    const key = pairMatch[1]!.trim();
    const value = pairMatch[2] ?? "";
    if (value.trim().length === 0) {
      fields[key] = [];
      activeListKey = key;
      continue;
    }
    activeListKey = null;
    fields[key] = key === "tags" || key === "appliesTo" ? parseListValue(value) : stripQuotes(value);
  }

  return { fields, body };
}

function readStringField(fields: Record<string, string | string[]>, key: string): string {
  const value = fields[key];
  return Array.isArray(value) ? "" : normalizeString(value);
}

function readListField(fields: Record<string, string | string[]>, key: string): string[] {
  const value = fields[key];
  if (Array.isArray(value)) {
    return normalizeStringArray(value);
  }
  return parseListValue(value ?? "");
}

export function normalizeStringArray(values: readonly string[] | undefined): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const value of values || []) {
    const trimmed = normalizeString(value);
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    normalized.push(trimmed);
  }
  return normalized;
}

export function parseSkillMarkdown(raw: string): ParsedSkillMarkdown {
  const { fields, body } = parseFrontmatter(raw);
  return {
    title: readStringField(fields, "title"),
    description: readStringField(fields, "description"),
    tags: readListField(fields, "tags"),
    appliesTo: readListField(fields, "appliesTo"),
    version: readStringField(fields, "version") || null,
    bodyMarkdown: body.replace(/^\s*\n/, "").replace(/\s+$/, ""),
  };
}

function formatScalar(value: string): string {
  if (!/[#:\[\],{}'"`]|^\s|\s$/.test(value)) {
    return value;
  }
  return JSON.stringify(value);
}

function formatList(values: string[]): string {
  return `[${values.map((value) => JSON.stringify(value)).join(", ")}]`;
}

export function renderSkillMarkdown(skill: Pick<SkillRecord, "name" | "description" | "tags" | "appliesTo" | "version" | "contentMarkdown">): string {
  const lines = [
    FRONTMATTER_BOUNDARY,
    `title: ${formatScalar(skill.name)}`,
  ];
  if (skill.description) {
    lines.push(`description: ${formatScalar(skill.description)}`);
  }
  if (skill.tags.length > 0) {
    lines.push(`tags: ${formatList(skill.tags)}`);
  }
  if (skill.appliesTo.length > 0) {
    lines.push(`appliesTo: ${formatList(skill.appliesTo)}`);
  }
  if (skill.version) {
    lines.push(`version: ${formatScalar(skill.version)}`);
  }
  lines.push(FRONTMATTER_BOUNDARY, "", skill.contentMarkdown.trimEnd(), "");
  return lines.join("\n");
}
