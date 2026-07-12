import type { SettingsCredentialReference } from "../../contracts/app-types.js";
import { resolveRepositoryHost, type GitProvider } from "../../infrastructure/git/repository-host-resolver.js";
import { readLocalGitOriginUrl } from "../../infrastructure/git/local-git-origin.js";
import type { GitHttpAuthOptions } from "../git-http-auth.js";
import type { SettingsCredentialResolver } from "./settings-credential-resolver.js";

type GitCredentialProvider = Extract<GitProvider, "github" | "gitlab">;

export interface GitSettingsCredentialRequest {
  resolver?: SettingsCredentialResolver;
  projectId?: string | null;
  workspaceId?: string;
  repoPath?: string;
  provider?: GitCredentialProvider;
  consumer: string;
  git: {
    githubToken?: string | null;
    githubTokenCredentialRef?: SettingsCredentialReference | null;
    gitlabToken?: string | null;
    gitlabTokenCredentialRef?: SettingsCredentialReference | null;
  };
}

async function resolveGitProvider(request: GitSettingsCredentialRequest): Promise<GitCredentialProvider | null> {
  if (request.provider) return request.provider;
  if (!request.repoPath) return null;
  const remoteUrl = readLocalGitOriginUrl(request.repoPath);
  const provider = resolveRepositoryHost(remoteUrl || "").provider;
  return provider === "github" || provider === "gitlab" ? provider : null;
}

/**
 * Resolves the credential for the repository host only for the duration of one
 * remote operation. Legacy string fields are retained solely for explicit
 * environment compatibility when no broker reference is configured.
 */
export async function withResolvedGitSettingsCredentials<T>(
  request: GitSettingsCredentialRequest,
  consumer: (auth: GitHttpAuthOptions) => T | Promise<T>,
): Promise<T> {
  const provider = await resolveGitProvider(request);
  const fallback: GitHttpAuthOptions = {
    githubToken: request.git.githubToken ?? undefined,
    gitlabToken: request.git.gitlabToken ?? undefined,
  };
  if (!provider) {
    if (request.git.githubTokenCredentialRef || request.git.gitlabTokenCredentialRef) {
      throw new Error("Broker-resolved Git credentials require a recognizable repository origin.");
    }
    return await consumer(fallback);
  }

  const reference = provider === "github"
    ? request.git.githubTokenCredentialRef
    : request.git.gitlabTokenCredentialRef;
  if (!reference) return await consumer(fallback);

  const projectId = request.projectId?.trim();
  if (!request.resolver || !projectId) {
    throw new Error(`Broker-resolved ${provider} credentials require an active project scope.`);
  }

  return await request.resolver.withCredential(reference, {
    projectId,
    workspaceId: request.workspaceId,
    consumer: `${request.consumer}.${provider}`,
  }, async (secret) => {
    const auth: GitHttpAuthOptions = provider === "github"
      ? { githubToken: secret.toString("utf8") }
      : { gitlabToken: secret.toString("utf8") };
    try {
      return await consumer(auth);
    } finally {
      auth.githubToken = undefined;
      auth.gitlabToken = undefined;
    }
  });
}
