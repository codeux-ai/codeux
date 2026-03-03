import { execFileSync } from "child_process";
import type { JulesApiClient } from "../integrations/jules-api-client.js";

interface ResolveSourceIdArgs {
  repoPath: string;
  requestedSourceId?: string;
}

const normalizeSourceId = (sourceId: string): string => {
  return sourceId.startsWith("sources/") ? sourceId : `sources/${sourceId}`;
};

interface RepoIdentity {
  host: string;
  owner: string;
  repo: string;
  fullRef: string;
}

const parseRepoIdentity = (value: string): RepoIdentity | null => {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const sshMatch = trimmed.match(/^git@([^:]+):(.+)$/);
  if (sshMatch) {
    const host = sshMatch[1].toLowerCase();
    const path = sshMatch[2].replace(/\.git$/i, "").replace(/^\/+/, "").toLowerCase();
    const segments = path.split("/").filter(Boolean);
    if (segments.length < 2) {
      return null;
    }
    const owner = segments[segments.length - 2];
    const repo = segments[segments.length - 1];
    return { host, owner, repo, fullRef: `${host}/${path}` };
  }

  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      const host = parsed.hostname.toLowerCase();
      const path = parsed.pathname.replace(/\.git$/i, "").replace(/^\/+/, "").toLowerCase();
      const segments = path.split("/").filter(Boolean);
      if (!host || segments.length < 2) {
        return null;
      }
      const owner = segments[segments.length - 2];
      const repo = segments[segments.length - 1];
      return { host, owner, repo, fullRef: `${host}/${path}` };
    } catch {
      return null;
    }
  }

  return null;
};

const normalizeSourceGithubKey = (source: unknown): string | null => {
  if (!source || typeof source !== "object") {
    return null;
  }
  const record = source as Record<string, unknown>;
  const githubRepo =
    record.githubRepo && typeof record.githubRepo === "object"
      ? (record.githubRepo as Record<string, unknown>)
      : null;
  const owner = typeof githubRepo?.owner === "string" ? githubRepo.owner.trim().toLowerCase() : "";
  const repo = typeof githubRepo?.repo === "string" ? githubRepo.repo.trim().toLowerCase() : "";
  if (owner && repo) {
    return `${owner}/${repo}`;
  }
  return null;
};

const parseGithubKeyFromSourceName = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  const withoutPrefix = normalized.startsWith("sources/") ? normalized.slice("sources/".length) : normalized;
  const match = withoutPrefix.match(/^github\/([^/]+)\/([^/]+)$/);
  if (!match) {
    return null;
  }
  return `${match[1]}/${match[2]}`;
};

const collectStrings = (value: unknown, output: string[], depth: number): void => {
  if (depth > 5 || output.length > 300) {
    return;
  }
  if (typeof value === "string") {
    output.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectStrings(item, output, depth + 1);
    }
    return;
  }
  if (value && typeof value === "object") {
    for (const nested of Object.values(value as Record<string, unknown>)) {
      collectStrings(nested, output, depth + 1);
    }
  }
};

const extractRepoRefs = (value: unknown): Set<string> => {
  const strings: string[] = [];
  collectStrings(value, strings, 0);
  const refs = new Set<string>();
  for (const entry of strings) {
    const parsed = parseRepoIdentity(entry);
    if (parsed) {
      refs.add(parsed.fullRef);
      refs.add(`${parsed.owner}/${parsed.repo}`);
    }
  }
  return refs;
};

export class JulesSourceResolver {
  private readonly autoResolvedByRepo = new Map<string, string>();

  constructor(private readonly julesApi: JulesApiClient) {}

  private getLocalRepoRef(repoPath: string): RepoIdentity {
    const remoteUrl = execFileSync("git", ["config", "--get", "remote.origin.url"], {
      cwd: repoPath,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();

    const repoRef = parseRepoIdentity(remoteUrl);
    if (!repoRef) {
      throw new Error(
        `Unable to parse repository remote URL '${remoteUrl}'. Set a valid git origin URL or pass source_id explicitly.`
      );
    }
    return repoRef;
  }

  private sourceMatchesRepo(source: unknown, repoRef: RepoIdentity): boolean {
    const githubRepoKey = normalizeSourceGithubKey(source);
    if (githubRepoKey && githubRepoKey === `${repoRef.owner}/${repoRef.repo}`) {
      return true;
    }

    if (source && typeof source === "object") {
      const record = source as Record<string, unknown>;
      const nameKey = parseGithubKeyFromSourceName(record.name);
      const idKey = parseGithubKeyFromSourceName(record.id);
      const expected = `${repoRef.owner}/${repoRef.repo}`;
      if (nameKey === expected || idKey === expected) {
        return true;
      }
    }

    const refs = extractRepoRefs(source);
    if (refs.size === 0) {
      return false;
    }
    return refs.has(repoRef.fullRef) || refs.has(`${repoRef.owner}/${repoRef.repo}`);
  }

  async resolveSourceId(args: ResolveSourceIdArgs): Promise<string> {
    const repoRef = this.getLocalRepoRef(args.repoPath);
    const cacheKey = `${args.repoPath}:${repoRef.fullRef}`;
    if (!args.requestedSourceId) {
      const cached = this.autoResolvedByRepo.get(cacheKey);
      if (cached) {
        return cached;
      }
    }

    if (args.requestedSourceId) {
      const normalizedRequested = normalizeSourceId(args.requestedSourceId);
      const sourceDetails = await this.julesApi.getSource(normalizedRequested);
      if (!this.sourceMatchesRepo(sourceDetails, repoRef)) {
        throw new Error(
          `Provided source_id '${normalizedRequested}' does not match repository '${repoRef.owner}/${repoRef.repo}'.`
        );
      }
      return normalizedRequested;
    }

    const sources = await this.julesApi.listAllSources();
    for (const source of sources) {
      if (this.sourceMatchesRepo(source, repoRef)) {
        this.autoResolvedByRepo.set(cacheKey, source.id);
        return source.id;
      }
    }

    for (const source of sources) {
      const sourceDetails = await this.julesApi.getSource(source.id);
      if (this.sourceMatchesRepo(sourceDetails, repoRef)) {
        this.autoResolvedByRepo.set(cacheKey, source.id);
        return source.id;
      }
    }

    throw new Error(
      `No Jules source matches repository '${repoRef.owner}/${repoRef.repo}'. Create/link a source for this repo or pass source_id explicitly.`
    );
  }
}
