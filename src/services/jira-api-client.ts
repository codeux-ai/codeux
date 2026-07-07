import type {
  JiraIssueSearchAssignee,
  JiraIssueSearchInput,
  JiraIssueSearchResult,
  JiraIssueSearchSortField,
  JiraIssueSearchStatus,
} from "../contracts/project-management-types.js";

export interface JiraIssueDetail extends JiraIssueSearchResult {
  descriptionMarkdown: string | null;
  commentsMarkdown: string | null;
}

export interface JiraTransition {
  id: string;
  name: string;
}

export interface JiraProjectStatus {
  id: string;
  name: string;
  issueTypes: string[];
}

export class JiraApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'JiraApiError';
    this.status = status;
  }
}

interface JiraAdfNode {
  type?: string;
  text?: string;
  content?: JiraAdfNode[];
  [key: string]: unknown;
}

interface JiraUser {
  displayName?: string;
  accountId?: string;
  name?: string;
}

interface JiraIssueFields {
  summary?: string;
  status?: { name?: string; statusCategory?: { name?: string; key?: string } };
  assignee?: JiraUser;
  reporter?: JiraUser;
  labels?: string[];
  project?: { key?: string };
  description?: JiraAdfNode;
  issuetype?: { name?: string };
  priority?: { name?: string };
  created?: string;
  updated?: string;
  fixVersions?: Array<{ name?: string }>;
  comment?: {
    total?: number;
    comments?: Array<{ body?: JiraAdfNode }>;
  };
}

interface JiraIssueRaw {
  key: string;
  fields?: JiraIssueFields;
}

interface JiraTransitionRaw {
  id: string;
  name: string;
  [key: string]: unknown;
}

interface JiraProjectStatusRaw {
  id?: string;
  name?: string;
  [key: string]: unknown;
}

interface JiraProjectIssueTypeStatusRaw {
  id?: string;
  name?: string;
  statuses?: JiraProjectStatusRaw[];
  [key: string]: unknown;
}

function normalizeHost(host: string): string {
  return host.replace(/\/+$/, '');
}

function getAuthHeader(email: string, apiToken: string): string {
  if (!email || email.trim() === '') {
    return `Bearer ${apiToken}`;
  }
  return `Basic ${Buffer.from(`${email}:${apiToken}`).toString('base64')}`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchJira(url: string, method: string, email: string, apiToken: string, body?: unknown): Promise<any> {
  const headers: Record<string, string> = {
    'Authorization': getAuthHeader(email, apiToken),
    'Accept': 'application/json',
  };

  if (body) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    throw new JiraApiError(response.status, `Jira API Error: ${response.status} ${response.statusText}`);
  }

  if (response.status === 204) {
    return null;
  }

  const text = await response.text();
  if (!text) {
    return null;
  }

  return JSON.parse(text);
}

function extractAdfText(adf: JiraAdfNode | null | undefined): string | null {
  if (!adf) {
    return null;
  }

  let result = '';
  let hasText = false;

  function walk(node: JiraAdfNode | null | undefined) {
    if (!node || typeof node !== 'object') return;

    if (node.type === 'text' && typeof node.text === 'string') {
      result += node.text;
      hasText = true;
    }

    if (Array.isArray(node.content)) {
      for (const child of node.content) {
        walk(child);
      }
      if (node.type === 'paragraph' || node.type === 'heading') {
        result += '\n\n';
      }
    }
  }

  walk(adf);

  if (!hasText && result.length === 0) {
    return null;
  }

  return result.trim() || null;
}

export function buildJiraSearchJql(input: JiraIssueSearchInput, defaultProjectKey = ''): string {
  if (input.jql?.trim()) {
    return input.jql.trim();
  }

  const clauses: string[] = [];
  const projectKey = normalizeProjectKey(input.projectKey || defaultProjectKey);
  if (projectKey) {
    clauses.push(`project = ${projectKey}`);
  }

  const issueKey = input.issueKey?.trim();
  if (issueKey) {
    clauses.push(`key = ${issueKey.toUpperCase()}`);
  }

  const search = input.search?.trim();
  if (search) {
    if (!issueKey && isExactJiraIssueKey(search)) {
      clauses.push(`key = ${search.toUpperCase()}`);
    } else {
      clauses.push(`text ~ ${quoteJqlString(search)}`);
    }
  }

  const statusNames = normalizeStringList(input.statusNames);
  if (statusNames.length > 0) {
    clauses.push(`status in (${statusNames.map(quoteJqlString).join(', ')})`);
  } else {
    const status = input.status || 'open';
    if (status === 'open') {
      clauses.push('statusCategory != Done');
    } else if (status === 'in_progress') {
      clauses.push('statusCategory = "In Progress"');
    } else if (status === 'done') {
      clauses.push('statusCategory = Done');
    }
  }

  const assigneeText = input.assigneeText?.trim();
  if (assigneeText) {
    const normalizedAssigneeText = assigneeText.toLowerCase();
    if (normalizedAssigneeText === 'me' || normalizedAssigneeText === 'currentuser()') {
      clauses.push('assignee = currentUser()');
    } else if (normalizedAssigneeText === 'unassigned' || normalizedAssigneeText === 'empty') {
      clauses.push('assignee is EMPTY');
    } else {
      clauses.push(`assignee = ${quoteJqlString(assigneeText)}`);
    }
  } else if (input.assignee === 'me') {
    clauses.push('assignee = currentUser()');
  } else if (input.assignee === 'unassigned') {
    clauses.push('assignee is EMPTY');
  }

  const reporterText = input.reporterText?.trim();
  if (reporterText) {
    const normalizedReporterText = reporterText.toLowerCase();
    if (normalizedReporterText === 'me' || normalizedReporterText === 'currentuser()') {
      clauses.push('reporter = currentUser()');
    } else {
      clauses.push(`reporter = ${quoteJqlString(reporterText)}`);
    }
  }

  if (input.issueType?.trim()) {
    clauses.push(`issuetype = ${quoteJqlString(input.issueType.trim())}`);
  }

  if (input.priority?.trim()) {
    clauses.push(`priority = ${quoteJqlString(input.priority.trim())}`);
  }

  if (input.updatedAfter?.trim()) {
    clauses.push(`updated >= ${quoteJqlString(input.updatedAfter.trim())}`);
  }
  if (input.updatedBefore?.trim()) {
    clauses.push(`updated <= ${quoteJqlString(input.updatedBefore.trim())}`);
  }

  const labels = Array.from(new Set((input.labels || []).map((label) => label.trim()).filter(Boolean))).slice(0, 12);
  if (labels.length > 0) {
    clauses.push(`labels in (${labels.map(quoteJqlString).join(', ')})`);
  }

  const sortField = normalizeJiraSortField(input.sortField);
  const sortDirection = input.sortDirection === 'asc' ? 'ASC' : 'DESC';
  const orderClause = `ORDER BY ${sortField} ${sortDirection}`;
  return `${clauses.length > 0 ? clauses.join(' AND ') : orderClause}${clauses.length > 0 ? ` ${orderClause}` : ''}`;
}

export async function searchIssues(
  host: string,
  email: string,
  apiToken: string,
  input: string | JiraIssueSearchInput,
  maxResults = 50
): Promise<JiraIssueSearchResult[]> {
  const normalizedHost = normalizeHost(host);
  const searchInput = typeof input === 'string' ? { jql: input } : input;
  const jql = buildJiraSearchJql(searchInput);
  const resultLimit = clampMaxResults(searchInput.limit ?? searchInput.maxResults ?? maxResults);
  const fields = ['summary', 'status', 'assignee', 'labels', 'project', 'description', 'issuetype', 'priority', 'updated', 'created', 'reporter', 'fixVersions', 'comment'];

  const data = await fetchJira(`${normalizedHost}/rest/api/3/search/jql`, 'POST', email, apiToken, {
    jql,
    fields,
    maxResults: resultLimit,
  });

  return (data.issues || []).map((issue: JiraIssueRaw) => {
    const assigneeName = issue.fields?.assignee?.displayName || issue.fields?.assignee?.accountId || issue.fields?.assignee?.name || '';
    const reporterName = issue.fields?.reporter?.displayName || issue.fields?.reporter?.accountId || issue.fields?.reporter?.name || null;
    return {
      key: issue.key,
      title: issue.fields?.summary || '',
      url: `${normalizedHost}/browse/${issue.key}`,
      state: issue.fields?.status?.name || '',
      labels: issue.fields?.labels || [],
      assignees: issue.fields?.assignee && assigneeName ? [assigneeName] : [],
      projectKey: issue.fields?.project?.key || '',
      issueType: issue.fields?.issuetype?.name || null,
      priority: issue.fields?.priority?.name || null,
      bodyPreview: truncatePreview(extractAdfText(issue.fields?.description) || ''),
      createdAt: issue.fields?.created || null,
      updatedAt: issue.fields?.updated || null,
      issueAuthor: reporterName,
      issueReporter: reporterName,
      issueMilestone: issue.fields?.fixVersions?.[0]?.name || null,
      issueCommentCount: typeof issue.fields?.comment?.total === 'number'
        ? issue.fields.comment.total
        : Array.isArray(issue.fields?.comment?.comments)
          ? issue.fields.comment.comments.length
          : null,
      sourceProvider: "jira",
    };
  });
}

export async function getIssue(
  host: string,
  email: string,
  apiToken: string,
  issueKey: string
): Promise<JiraIssueDetail> {
  const normalizedHost = normalizeHost(host);
  const url = `${normalizedHost}/rest/api/3/issue/${issueKey}?fields=summary,status,assignee,labels,project,description,comment,created,reporter,issuetype,priority,fixVersions`;

  const data = await fetchJira(url, 'GET', email, apiToken) as JiraIssueRaw;

  const assigneeName = data.fields?.assignee?.displayName || data.fields?.assignee?.accountId || data.fields?.assignee?.name || '';
  const reporterName = data.fields?.reporter?.displayName || data.fields?.reporter?.accountId || data.fields?.reporter?.name || null;
  const searchResult: JiraIssueSearchResult = {
    key: data.key,
    title: data.fields?.summary || '',
    url: `${normalizedHost}/browse/${data.key}`,
    state: data.fields?.status?.name || '',
    labels: data.fields?.labels || [],
    assignees: data.fields?.assignee && assigneeName ? [assigneeName] : [],
    projectKey: data.fields?.project?.key || '',
    issueType: data.fields?.issuetype?.name || null,
    priority: data.fields?.priority?.name || null,
    bodyPreview: truncatePreview(extractAdfText(data.fields?.description) || ''),
    createdAt: data.fields?.created || null,
    updatedAt: data.fields?.updated || null,
    issueAuthor: reporterName,
    issueReporter: reporterName,
    issueMilestone: data.fields?.fixVersions?.[0]?.name || null,
    issueCommentCount: typeof data.fields?.comment?.total === 'number'
      ? data.fields.comment.total
      : Array.isArray(data.fields?.comment?.comments)
        ? data.fields.comment.comments.length
        : null,
    sourceProvider: "jira",
  };

  let commentsMarkdown: string | null = null;
  if (data.fields?.comment?.comments && Array.isArray(data.fields.comment.comments)) {
    const comments = data.fields.comment.comments
      .map(c => extractAdfText(c.body))
      .filter((text): text is string => text !== null && text.trim() !== '')
      .join('\n\n---\n\n');
    if (comments.length > 0) {
      commentsMarkdown = comments;
    }
  }

  return {
    ...searchResult,
    descriptionMarkdown: extractAdfText(data.fields?.description),
    commentsMarkdown,
  };
}

export async function listProjectStatuses(
  host: string,
  email: string,
  apiToken: string,
  projectIdOrKey: string
): Promise<JiraProjectStatus[]> {
  const normalizedHost = normalizeHost(host);
  const projectPath = encodeURIComponent(projectIdOrKey.trim());
  const data = await fetchJira(`${normalizedHost}/rest/api/3/project/${projectPath}/statuses`, 'GET', email, apiToken) as JiraProjectIssueTypeStatusRaw[];
  const statuses: JiraProjectStatus[] = [];
  const idToIndex = new Map<string, number>();
  const nameToIndex = new Map<string, number>();

  for (const issueType of Array.isArray(data) ? data : []) {
    const issueTypeName = typeof issueType.name === 'string' ? issueType.name.trim() : '';
    for (const status of Array.isArray(issueType.statuses) ? issueType.statuses : []) {
      const name = typeof status.name === 'string' ? status.name.trim() : '';
      if (!name) {
        continue;
      }

      const id = typeof status.id === 'string' ? status.id.trim() : '';
      const normalizedName = normalizeStatusName(name);
      let existingIndex = id ? idToIndex.get(id) : undefined;
      existingIndex ??= nameToIndex.get(normalizedName);

      if (existingIndex === undefined) {
        existingIndex = statuses.length;
        statuses.push({
          id: id || normalizedName,
          name,
          issueTypes: [],
        });
      }

      const record = statuses[existingIndex];
      if (issueTypeName && !record.issueTypes.includes(issueTypeName)) {
        record.issueTypes.push(issueTypeName);
      }
      if (id) {
        idToIndex.set(id, existingIndex);
      }
      nameToIndex.set(normalizedName, existingIndex);
    }
  }

  return statuses
    .map((status) => ({
      ...status,
      issueTypes: [...status.issueTypes].sort(compareDisplayName),
    }))
    .sort((left, right) => compareDisplayName(left.name, right.name) || compareDisplayName(left.id, right.id));
}

function normalizeProjectKey(projectKey: string): string {
  return projectKey.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '');
}

function normalizeStatusName(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function normalizeStringList(values: string[] | undefined): string[] {
  return Array.from(new Set((values || []).map((value) => value.trim()).filter(Boolean)));
}

function compareDisplayName(left: string, right: string): number {
  return left.localeCompare(right, undefined, { sensitivity: 'base' });
}

function quoteJqlString(value: string): string {
  return `"${value.trim().replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function isExactJiraIssueKey(value: string): boolean {
  return /^[A-Z][A-Z0-9_]+-\d+$/i.test(value.trim());
}

function normalizeJiraSortField(value?: JiraIssueSearchSortField): string {
  if (value === "created") return "created";
  if (value === "priority") return "priority";
  if (value === "status") return "status";
  if (value === "assignee") return "assignee";
  if (value === "reporter") return "reporter";
  return "updated";
}

function clampMaxResults(value: number): number {
  if (!Number.isFinite(value)) {
    return 50;
  }
  return Math.max(1, Math.min(100, Math.trunc(value)));
}

function truncatePreview(value: string): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  return compact.length > 220 ? `${compact.slice(0, 217)}...` : compact;
}

export async function getTransitions(
  host: string,
  email: string,
  apiToken: string,
  issueKey: string
): Promise<JiraTransition[]> {
  const normalizedHost = normalizeHost(host);
  const url = `${normalizedHost}/rest/api/3/issue/${issueKey}/transitions`;

  const data = await fetchJira(url, 'GET', email, apiToken);

  return (data.transitions || []).map((t: JiraTransitionRaw) => ({
    id: t.id,
    name: t.name,
  }));
}

export async function transitionIssue(
  host: string,
  email: string,
  apiToken: string,
  issueKey: string,
  transitionId: string
): Promise<void> {
  const normalizedHost = normalizeHost(host);
  const url = `${normalizedHost}/rest/api/3/issue/${issueKey}/transitions`;

  await fetchJira(url, 'POST', email, apiToken, {
    transition: {
      id: transitionId,
    },
  });
}
