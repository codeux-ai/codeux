export interface LinearSearchInput {
  search?: string;
  status?: string;
  state?: string;
  labels?: string[];
  assignee?: string;
  teamId?: string;
  teamKey?: string;
  projectId?: string;
  externalIds?: string[];
  includeConversation?: boolean;
  limit: number;
}

export interface LinearIssueItem {
  id: string;
  identifier: string;
  title: string;
  url: string;
  state: string;
  labels: string[];
  assignees: string[];
  bodyMarkdown: string;
  conversationMarkdown: string;
  createdAt: string | null;
  updatedAt: string | null;
  issueAuthor: string | null;
  teamKey: string | null;
  projectName: string | null;
  metadata: Record<string, unknown>;
}

const LINEAR_GRAPHQL_URL = "https://api.linear.app/graphql";

const ISSUE_FIELDS = `
  id
  identifier
  title
  description
  url
  createdAt
  updatedAt
  state { name type }
  labels { nodes { name } }
  assignee { name displayName email }
  creator { name displayName email }
  team { id key name }
  project { id name url }
`;

interface LinearGraphQlResponse<T> {
  data?: T;
  errors?: Array<{ message?: string }>;
}

interface LinearConnection<T> {
  nodes?: T[];
}

interface LinearIssueRaw {
  id?: string;
  identifier?: string;
  title?: string;
  description?: string | null;
  url?: string;
  createdAt?: string | null;
  updatedAt?: string | null;
  state?: { name?: string; type?: string } | null;
  labels?: LinearConnection<{ name?: string }>;
  assignee?: { name?: string; displayName?: string; email?: string } | null;
  creator?: { name?: string; displayName?: string; email?: string } | null;
  team?: { id?: string; key?: string; name?: string } | null;
  project?: { id?: string; name?: string; url?: string } | null;
  comments?: LinearConnection<LinearCommentRaw>;
}

interface LinearCommentRaw {
  body?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  url?: string | null;
  user?: { name?: string; displayName?: string; email?: string } | null;
}

export async function searchIssues(token: string, input: LinearSearchInput): Promise<LinearIssueItem[]> {
  const filter = buildLinearIssueFilter(input);
  const data = await requestLinear<{
    issues: LinearConnection<LinearIssueRaw>;
  }>(token, `
    query CodeUxIssueSearch($first: Int!, $filter: IssueFilter) {
      issues(first: $first, filter: $filter, orderBy: updatedAt) {
        nodes { ${ISSUE_FIELDS} }
      }
    }
  `, {
    first: input.limit,
    filter,
  });

  const issues = data.issues.nodes || [];
  return Promise.all(issues
    .filter((issue): issue is LinearIssueRaw & { id: string } => typeof issue.id === "string")
    .slice(0, input.limit)
    .map((issue) => toLinearIssueItem(token, issue, input.includeConversation === true)));
}

export async function getIssues(token: string, externalIds: string[], input: Omit<LinearSearchInput, "externalIds">): Promise<LinearIssueItem[]> {
  const items: LinearIssueItem[] = [];
  for (const externalId of uniqueStrings(externalIds).slice(0, input.limit)) {
    const issue = await getIssueByExternalId(token, externalId);
    if (issue) {
      items.push(await toLinearIssueItem(token, issue, input.includeConversation !== false));
    }
  }
  return items;
}

async function getIssueByExternalId(token: string, externalId: string): Promise<(LinearIssueRaw & { id: string }) | null> {
  const filter = {
    or: [
      { id: { eq: externalId } },
      { identifier: { eq: externalId.toUpperCase() } },
    ],
  };
  const data = await requestLinear<{
    issues: LinearConnection<LinearIssueRaw>;
  }>(token, `
    query CodeUxIssueByExternalId($filter: IssueFilter) {
      issues(first: 1, filter: $filter) {
        nodes { ${ISSUE_FIELDS} }
      }
    }
  `, { filter });
  const issue = data.issues.nodes?.[0];
  return issue && typeof issue.id === "string" ? issue as LinearIssueRaw & { id: string } : null;
}

async function toLinearIssueItem(token: string, issue: LinearIssueRaw & { id: string }, includeConversation: boolean): Promise<LinearIssueItem> {
  const comments = includeConversation ? await getIssueComments(token, issue.id) : [];
  const assignee = formatLinearUser(issue.assignee);
  const creator = formatLinearUser(issue.creator);
  return {
    id: issue.id,
    identifier: issue.identifier || issue.id,
    title: issue.title || "Untitled Linear issue",
    url: issue.url || "",
    state: issue.state?.name || issue.state?.type || "open",
    labels: (issue.labels?.nodes || []).map((label) => label.name || "").filter(Boolean),
    assignees: assignee ? [assignee] : [],
    bodyMarkdown: normalizeMarkdown(issue.description || ""),
    conversationMarkdown: formatCommentsMarkdown(comments),
    createdAt: issue.createdAt || null,
    updatedAt: issue.updatedAt || null,
    issueAuthor: creator || null,
    teamKey: issue.team?.key || null,
    projectName: issue.project?.name || null,
    metadata: {
      identifier: issue.identifier || null,
      teamId: issue.team?.id || null,
      teamKey: issue.team?.key || null,
      teamName: issue.team?.name || null,
      projectId: issue.project?.id || null,
      projectName: issue.project?.name || null,
      projectUrl: issue.project?.url || null,
      stateType: issue.state?.type || null,
    },
  };
}

async function getIssueComments(token: string, issueId: string): Promise<LinearCommentRaw[]> {
  const data = await requestLinear<{
    issue: LinearIssueRaw | null;
  }>(token, `
    query CodeUxIssueComments($id: String!) {
      issue(id: $id) {
        comments(first: 100) {
          nodes {
            body
            createdAt
            updatedAt
            url
            user { name displayName email }
          }
        }
      }
    }
  `, { id: issueId });
  return data.issue?.comments?.nodes || [];
}

async function requestLinear<T>(token: string, query: string, variables: Record<string, unknown>): Promise<T> {
  const response = await fetch(LINEAR_GRAPHQL_URL, {
    method: "POST",
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Linear API request failed (${response.status} ${response.statusText})${text ? `: ${truncatePreview(text)}` : ""}`);
  }
  const payload = await response.json() as LinearGraphQlResponse<T>;
  if (payload.errors && payload.errors.length > 0) {
    throw new Error(`Linear API request failed: ${payload.errors.map((error) => error.message || "GraphQL error").join("; ")}`);
  }
  if (!payload.data) {
    throw new Error("Linear API response did not include data.");
  }
  return payload.data;
}

function buildLinearIssueFilter(input: LinearSearchInput): Record<string, unknown> | undefined {
  const clauses: Record<string, unknown>[] = [];
  const externalIds = uniqueStrings(input.externalIds || []);
  if (externalIds.length > 0) {
    clauses.push({
      or: externalIds.flatMap((externalId) => [
        { id: { eq: externalId } },
        { identifier: { eq: externalId.toUpperCase() } },
      ]),
    });
  }
  if (input.search?.trim()) {
    const search = input.search.trim();
    clauses.push({
      or: [
        { title: { containsIgnoreCase: search } },
        { description: { containsIgnoreCase: search } },
        { identifier: { eq: search.toUpperCase() } },
      ],
    });
  }
  const state = input.state?.trim() || input.status?.trim();
  if (state && state !== "all") {
    if (state === "open") {
      clauses.push({ state: { type: { neq: "completed" } } });
    } else if (state === "closed" || state === "done") {
      clauses.push({ state: { type: { eq: "completed" } } });
    } else {
      clauses.push({ state: { name: { eq: state } } });
    }
  }
  if (input.labels && input.labels.length > 0) {
    clauses.push({ labels: { some: { name: { in: input.labels } } } });
  }
  if (input.assignee?.trim()) {
    clauses.push({
      assignee: {
        or: [
          { name: { eq: input.assignee.trim() } },
          { displayName: { eq: input.assignee.trim() } },
          { email: { eq: input.assignee.trim() } },
        ],
      },
    });
  }
  if (input.teamId?.trim()) {
    clauses.push({ team: { id: { eq: input.teamId.trim() } } });
  }
  if (input.teamKey?.trim()) {
    clauses.push({ team: { key: { eq: input.teamKey.trim().toUpperCase() } } });
  }
  if (input.projectId?.trim()) {
    clauses.push({ project: { id: { eq: input.projectId.trim() } } });
  }
  if (clauses.length === 0) {
    return undefined;
  }
  return clauses.length === 1 ? clauses[0] : { and: clauses };
}

function formatCommentsMarkdown(comments: LinearCommentRaw[]): string {
  return comments
    .filter((comment) => Boolean(comment.body?.trim()))
    .map((comment, index) => {
      const author = formatLinearUser(comment.user) || "unknown";
      const meta = [
        `Comment ${index + 1}`,
        `@${author}`,
        comment.createdAt || "",
        comment.updatedAt && comment.updatedAt !== comment.createdAt ? `updated ${comment.updatedAt}` : "",
        comment.url ? `[source](${comment.url})` : "",
      ].filter(Boolean).join(" - ");
      return `##### ${meta}\n\n${normalizeMarkdown(comment.body || "") || "_No comment body provided._"}`;
    })
    .join("\n\n");
}

function formatLinearUser(user: { name?: string; displayName?: string; email?: string } | null | undefined): string {
  return user?.displayName || user?.name || user?.email || "";
}

function normalizeMarkdown(value: string): string {
  return value.replace(/\r\n/g, "\n").trim();
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function truncatePreview(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > 220 ? `${compact.slice(0, 217)}...` : compact;
}
