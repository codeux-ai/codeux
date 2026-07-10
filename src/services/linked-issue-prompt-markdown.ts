import type { IssuePromptContext, SprintLinkedIssueInput } from "../contracts/project-management-types.js";

type LinkedIssuePromptInput = SprintLinkedIssueInput | IssuePromptContext;

const LINKED_ISSUES_HEADING = "## Linked Issues";
const MAX_LINKED_ISSUES = 50;
const MAX_LABELS = 8;
const MAX_ASSIGNEES = 5;

export function buildLinkedIssuePromptBlock(issues: readonly LinkedIssuePromptInput[]): string {
  const normalized = normalizeLinkedIssuePromptInputs(issues);

  if (normalized.length === 0) {
    return "";
  }

  return [
    LINKED_ISSUES_HEADING,
    "",
    "Use these imported issue details as sprint scope. Preserve acceptance criteria, constraints, and user-reported context. Close linked issues only after the sprint is finished and merged.",
    "",
    ...normalized.map((issue) => formatLinkedIssuePromptSection(issue)),
  ].join("\n");
}

export function mergePromptWithLinkedIssues(goal: string, issues: readonly LinkedIssuePromptInput[]): string {
  if (hasLinkedIssueSection(goal) && hasBodylessLinkedIssueList(issues)) {
    return goal;
  }

  const normalizedIssues = normalizeLinkedIssuePromptInputs(issues);
  const block = buildLinkedIssuePromptBlock(normalizedIssues);
  const trimmedGoal = normalizeImportedMarkdown(goal);
  const goalWithoutLinkedIssues = removeLinkedIssueSections(trimmedGoal);

  if (!block) {
    return goalWithoutLinkedIssues.trim();
  }

  return `${goalWithoutLinkedIssues.trim()}\n\n${block}`.trim();
}

function normalizeLinkedIssuePromptInputs(issues: readonly LinkedIssuePromptInput[]): LinkedIssuePromptInput[] {
  return issues
    .filter((issue) => issue.title.trim() && issue.url.trim())
    .slice(0, MAX_LINKED_ISSUES);
}

function hasBodylessLinkedIssueList(issues: readonly LinkedIssuePromptInput[]): boolean {
  return issues.length > 0 && issues.every((issue) => (
    !normalizeImportedMarkdown(issue.issueBodyMarkdown)
      && !normalizeImportedMarkdown(issue.issueConversationMarkdown)
  ));
}

function formatLinkedIssuePromptSection(issue: LinkedIssuePromptInput): string {
  const issueRef = `${issue.provider.toUpperCase()} ${issue.repository}${issue.issueKey || `#${issue.issueNumber}`}`;
  const labels = (issue.labels || []).slice(0, MAX_LABELS).map((label) => `\`${label}\``).join(", ");
  const assignees = (issue.assignees || []).slice(0, MAX_ASSIGNEES).map((assignee) => `@${assignee}`).join(", ");
  const metadata = [
    `- Source: [${issueRef}](${issue.url})`,
    issue.state ? `- State: ${issue.state}` : "",
    labels ? `- Labels: ${labels}` : "",
    assignees ? `- Assignees: ${assignees}` : "",
    issue.issueAuthor ? `- Author: @${issue.issueAuthor}` : "",
    issue.issueCreatedAt ? `- Created: ${issue.issueCreatedAt}` : "",
    issue.issueUpdatedAt ? `- Updated: ${issue.issueUpdatedAt}` : "",
  ].filter(Boolean);
  const body = normalizeImportedMarkdown(issue.issueBodyMarkdown) || "_No issue body was provided._";
  const conversation = normalizeImportedMarkdown(issue.issueConversationMarkdown);
  const sections = [
    `### ${issueRef}: ${issue.title}`,
    "",
    ...metadata,
    "",
    "#### Issue Body",
    "",
    body,
  ];

  if (issue.includeConversation !== false && conversation) {
    sections.push("", "#### Conversation", "", conversation);
  }

  return sections.join("\n");
}

function normalizeImportedMarkdown(value: string | null | undefined): string {
  return (value || "").replace(/\r\n/g, "\n").trim();
}

function removeLinkedIssueSections(markdown: string): string {
  const lines = markdown.split("\n");
  const retained: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index]?.trim() !== LINKED_ISSUES_HEADING) {
      retained.push(lines[index] || "");
      continue;
    }

    index += 1;
    while (index < lines.length && !isTopLevelSection(lines[index] || "")) {
      index += 1;
    }
    index -= 1;
  }

  return retained.join("\n").trim();
}

function hasLinkedIssueSection(markdown: string): boolean {
  return markdown.split("\n").some((line) => line.trim() === LINKED_ISSUES_HEADING);
}

function isTopLevelSection(line: string): boolean {
  return /^##\s+[^#]/.test(line);
}
