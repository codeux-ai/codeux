export interface JiraIssueSearchResult {
  key: string;
  title: string;
  url: string;
  state: string;
  labels: string[];
  assignees: string[];
  projectKey: string;
}

export interface JiraIssueDetail extends JiraIssueSearchResult {
  descriptionMarkdown: string | null;
  commentsMarkdown: string | null;
}

export interface JiraTransition {
  id: string;
  name: string;
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
  status?: { name?: string };
  assignee?: JiraUser;
  labels?: string[];
  project?: { key?: string };
  description?: JiraAdfNode;
  comment?: {
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

export async function searchIssues(
  host: string,
  email: string,
  apiToken: string,
  jql: string,
  maxResults = 50
): Promise<JiraIssueSearchResult[]> {
  const normalizedHost = normalizeHost(host);
  const url = `${normalizedHost}/rest/api/3/search?jql=${encodeURIComponent(jql)}&fields=summary,status,assignee,labels,project&maxResults=${maxResults}`;

  const data = await fetchJira(url, 'GET', email, apiToken);

  return (data.issues || []).map((issue: JiraIssueRaw) => {
    const assigneeName = issue.fields?.assignee?.displayName || issue.fields?.assignee?.accountId || issue.fields?.assignee?.name || '';
    return {
      key: issue.key,
      title: issue.fields?.summary || '',
      url: `${normalizedHost}/browse/${issue.key}`,
      state: issue.fields?.status?.name || '',
      labels: issue.fields?.labels || [],
      assignees: issue.fields?.assignee && assigneeName ? [assigneeName] : [],
      projectKey: issue.fields?.project?.key || '',
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
  const url = `${normalizedHost}/rest/api/3/issue/${issueKey}?fields=summary,status,assignee,labels,project,description,comment`;

  const data = await fetchJira(url, 'GET', email, apiToken) as JiraIssueRaw;

  const assigneeName = data.fields?.assignee?.displayName || data.fields?.assignee?.accountId || data.fields?.assignee?.name || '';
  const searchResult: JiraIssueSearchResult = {
    key: data.key,
    title: data.fields?.summary || '',
    url: `${normalizedHost}/browse/${data.key}`,
    state: data.fields?.status?.name || '',
    labels: data.fields?.labels || [],
    assignees: data.fields?.assignee && assigneeName ? [assigneeName] : [],
    projectKey: data.fields?.project?.key || '',
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
