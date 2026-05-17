import type { SprintLinkedIssueInput, SprintMarkdownExportBundle, SprintMarkdownImportTask } from "../types.js";

const FILE_MARKER = /^---\s*FILE:\s*(.+?)\s*---$/gm;

export function buildTaskBundle(bundle: SprintMarkdownExportBundle["tasks"]): string {
  return bundle.map((entry) => (
    `--- FILE: ${entry.fileName} ---\n${entry.markdown.trim()}\n`
  )).join("\n");
}

export function parseTaskBundle(text: string): SprintMarkdownImportTask[] {
  const trimmed = text.trim();
  if (!trimmed) {
    return [];
  }

  const matches = Array.from(trimmed.matchAll(FILE_MARKER));
  if (matches.length === 0) {
    return [{ markdown: trimmed }];
  }

  return matches.map((match, index) => {
    const fileName = match[1]?.trim() || `task-${index + 1}.md`;
    const contentStart = (match.index || 0) + match[0].length;
    const nextMatchIndex = matches[index + 1]?.index ?? trimmed.length;
    const markdown = trimmed.slice(contentStart, nextMatchIndex).trim();
    const taskKey = fileName.replace(/\.md$/i, "");

    return { taskKey, markdown };
  }).filter((entry) => entry.markdown.length > 0);
}

export function buildLinkedIssuePromptBlock(issues: SprintLinkedIssueInput[]): string {
  const normalized = issues
    .filter((issue) => issue.title.trim() && issue.url.trim())
    .slice(0, 50);
  if (normalized.length === 0) {
    return "";
  }

  const lines = [
    "## Linked Issues",
    "",
    "Use these imported issue links as sprint scope. Preserve their acceptance criteria and close them only after the sprint is finished and merged.",
    "",
    ...normalized.map((issue) => {
      const labels = (issue.labels || []).slice(0, 8).map((label) => `\`${label}\``).join(", ");
      const assignees = (issue.assignees || []).slice(0, 5).map((assignee) => `@${assignee}`).join(", ");
      const meta = [
        `${issue.provider.toUpperCase()} ${issue.repository}${issue.issueKey || `#${issue.issueNumber}`}`,
        labels ? `labels: ${labels}` : "",
        assignees ? `assignees: ${assignees}` : "",
      ].filter(Boolean).join(" | ");
      return `- [${issue.title}](${issue.url}) - ${meta}`;
    }),
  ];

  return lines.join("\n");
}

export function mergePromptWithLinkedIssues(goal: string, issues: SprintLinkedIssueInput[]): string {
  const block = buildLinkedIssuePromptBlock(issues);
  const trimmedGoal = goal.trim();
  if (!block) {
    return trimmedGoal;
  }
  if (trimmedGoal.includes("## Linked Issues")) {
    return trimmedGoal;
  }
  return `${trimmedGoal}\n\n${block}`.trim();
}
