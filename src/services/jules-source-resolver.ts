import { execFileSync } from "child_process";
import type { JulesApiClient } from "../integrations/jules-api-client.js";

interface ResolveSourceIdArgs {
  repoPath: string;
  requestedSourceId?: string;
}

interface RepoIdentity {
  owner: string;
  repo: string;
}

const toCanonicalSourceName = (value: string): string => {
  const trimmed = value.trim();
  if (trimmed.startsWith("sources/")) {
    return trimmed;
  }
  return `sources/${trimmed.replace(/^\/+/, "")}`;
};

const parseRepoIdentity = (remoteUrl: string): RepoIdentity | null => {
  const trimmed = remoteUrl.trim();
  if (!trimmed) {
    return null;
  }

  const sshMatch = trimmed.match(/^git@[^:]+:(.+)$/);
  if (sshMatch) {
    const path = sshMatch[1].replace(/\.git$/i, "").replace(/^\/+/, "");
    const parts = path.split("/").filter(Boolean);
    if (parts.length >= 2) {
      return {
        owner: parts[parts.length - 2].toLowerCase(),
        repo: parts[parts.length - 1].toLowerCase(),
      };
    }
  }

  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      const path = parsed.pathname.replace(/\.git$/i, "").replace(/^\/+/, "");
      const parts = path.split("/").filter(Boolean);
      if (parts.length >= 2) {
        return {
          owner: parts[parts.length - 2].toLowerCase(),
          repo: parts[parts.length - 1].toLowerCase(),
        };
      }
    } catch {
      return null;
    }
  }

  return null;
};

const sourceToCanonicalName = (source: Record<string, unknown>): string | null => {
  if (typeof source.name === "string" && source.name.trim().length > 0) {
    return toCanonicalSourceName(source.name);
  }
  if (typeof source.id === "string" && source.id.trim().length > 0) {
    return toCanonicalSourceName(source.id);
  }
  return null;
};

const sourceMatchesRepo = (source: Record<string, unknown>, target: RepoIdentity): boolean => {
  const githubRepo =
    source.githubRepo && typeof source.githubRepo === "object"
      ? (source.githubRepo as Record<string, unknown>)
      : null;
  const owner = typeof githubRepo?.owner === "string" ? githubRepo.owner.trim().toLowerCase() : "";
  const repo = typeof githubRepo?.repo === "string" ? githubRepo.repo.trim().toLowerCase() : "";
  if (owner && repo) {
    return owner === target.owner && repo === target.repo;
  }

  const canonical = sourceToCanonicalName(source);
  if (!canonical) {
    return false;
  }
  return canonical.toLowerCase() === `sources/github/${target.owner}/${target.repo}`;
};

export class JulesSourceResolver {
  private readonly autoResolvedByRepo = new Map<string, string>();

  constructor(private readonly julesApi: JulesApiClient) {}

  private getLocalRepoIdentity(repoPath: string): RepoIdentity {
    const remoteUrl = execFileSync("git", ["config", "--get", "remote.origin.url"], {
      cwd: repoPath,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();

    const parsed = parseRepoIdentity(remoteUrl);
    if (!parsed) {
      throw new Error(`Unable to parse repository remote URL '${remoteUrl}'.`);
    }
    return parsed;
  }

  async resolveSourceId(args: ResolveSourceIdArgs): Promise<string> {
    const repo = this.getLocalRepoIdentity(args.repoPath);
    const cacheKey = `${repo.owner}/${repo.repo}`;

    if (!args.requestedSourceId) {
      const cached = this.autoResolvedByRepo.get(cacheKey);
      if (cached) {
        return cached;
      }
    }

    if (args.requestedSourceId) {
      const requested = toCanonicalSourceName(args.requestedSourceId);
      const details = await this.julesApi.getSource(requested);
      if (!sourceMatchesRepo(details, repo)) {
        throw new Error(`Provided source_id '${requested}' does not match repository '${repo.owner}/${repo.repo}'.`);
      }
      return requested;
    }

    const sources = await this.julesApi.listAllSources();
    const matched = sources.find((source) => sourceMatchesRepo(source, repo));
    if (!matched) {
      throw new Error(`No Jules source matches repository '${repo.owner}/${repo.repo}'.`);
    }

    const canonical = sourceToCanonicalName(matched);
    if (!canonical) {
      throw new Error(`Matched Jules source for '${repo.owner}/${repo.repo}' has no usable id/name.`);
    }
    this.autoResolvedByRepo.set(cacheKey, canonical);
    return canonical;
  }
}
