import { resolveRepositoryHost, type GitProvider } from "../infrastructure/git/repository-host-resolver.js";
import { runCommandStrict } from "./cli-process-runner.js";
import { commandRunner } from "../shared/subprocess/command-runner.js";

export interface GitHttpAuthOptions {
  githubToken?: string | null;
  gitlabToken?: string | null;
}

const NON_INTERACTIVE_GIT_ENV = {
  GIT_TERMINAL_PROMPT: "0",
  GIT_ASKPASS: "true",
  SSH_ASKPASS: "true",
  GCM_INTERACTIVE: "never",
} as const;

const normalizeToken = (value?: string | null): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const isHttpRemote = (remoteUrl: string): boolean => /^https?:\/\//i.test(remoteUrl.trim());

const stripHttpCredentials = (remoteUrl: string): string => {
  try {
    const parsed = new URL(remoteUrl);
    parsed.username = "";
    parsed.password = "";
    return parsed.toString();
  } catch {
    return remoteUrl;
  }
};

const appendGitConfig = (
  env: NodeJS.ProcessEnv,
  key: string,
  value: string,
): NodeJS.ProcessEnv => {
  const existingCount = Number.parseInt(env.GIT_CONFIG_COUNT || "0", 10);
  const index = Number.isFinite(existingCount) && existingCount >= 0 ? existingCount : 0;
  return {
    ...env,
    GIT_CONFIG_COUNT: String(index + 1),
    [`GIT_CONFIG_KEY_${index}`]: key,
    [`GIT_CONFIG_VALUE_${index}`]: value,
  };
};

export function buildGitHttpAuthEnv(
  remoteUrl: string | null | undefined,
  auth: GitHttpAuthOptions = {},
  baseEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv | undefined {
  const normalizedRemote = remoteUrl?.trim();
  if (!normalizedRemote || !isHttpRemote(normalizedRemote)) {
    return undefined;
  }

  const hostRemote = stripHttpCredentials(normalizedRemote);
  const { provider, hostDomain } = resolveRepositoryHost(hostRemote);
  if (!hostDomain) {
    return undefined;
  }

  if (provider === "github") {
    const token = normalizeToken(auth.githubToken);
    if (!token) {
      return undefined;
    }
    const encoded = Buffer.from(`x-access-token:${token}`).toString("base64");
    return appendGitConfig(
      baseEnv,
      `http.https://${hostDomain}/.extraheader`,
      `Authorization: Basic ${encoded}`,
    );
  }

  if (provider === "gitlab") {
    const token = normalizeToken(auth.gitlabToken);
    if (!token) {
      return undefined;
    }
    const encoded = Buffer.from(`oauth2:${token}`).toString("base64");
    return appendGitConfig(
      baseEnv,
      `http.https://${hostDomain}/.extraheader`,
      `Authorization: Basic ${encoded}`,
    );
  }

  return undefined;
}

export async function readOriginRemoteUrl(repoPath: string): Promise<string | null> {
  try {
    const result = await runCommandStrict("git", ["remote", "get-url", "origin"], repoPath);
    const value = result.stdout.trim();
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

export async function buildGitHttpAuthEnvForRepo(
  repoPath: string,
  auth: GitHttpAuthOptions = {},
  baseEnv: NodeJS.ProcessEnv = process.env,
): Promise<NodeJS.ProcessEnv | undefined> {
  const remoteUrl = await readOriginRemoteUrl(repoPath);
  return buildGitHttpAuthEnv(remoteUrl, auth, baseEnv);
}

const CLI_TOKEN_TIMEOUT_MS = 3000;
const tokenResolutionCache = new Map<GitProvider, Promise<string | null>>();

const tryCommandToken = async (command: string, args: string[]): Promise<string | null> => {
  try {
    const result = await commandRunner.run(command, args, { timeout: CLI_TOKEN_TIMEOUT_MS });
    if (!result.ok) {
      return null;
    }
    return normalizeToken(result.stdout);
  } catch {
    return null;
  }
};

const defaultProviderTokenResolver = async (provider: GitProvider): Promise<string | null> => {
  if (provider === "github") {
    const fromEnv = normalizeToken(process.env.GH_TOKEN) ?? normalizeToken(process.env.GITHUB_TOKEN);
    if (fromEnv) {
      return fromEnv;
    }
    return await tryCommandToken("gh", ["auth", "token"]);
  }
  if (provider === "gitlab") {
    const fromEnv = normalizeToken(process.env.GITLAB_TOKEN) ?? normalizeToken(process.env.GLAB_TOKEN);
    if (fromEnv) {
      return fromEnv;
    }
    return await tryCommandToken("glab", ["auth", "token"]);
  }
  return null;
};

type ProviderTokenResolver = (provider: GitProvider) => Promise<string | null>;
let providerTokenResolver: ProviderTokenResolver = defaultProviderTokenResolver;

const resolveProviderToken = async (provider: GitProvider): Promise<string | null> => {
  const cached = tokenResolutionCache.get(provider);
  if (cached) {
    return cached;
  }
  const pending = providerTokenResolver(provider);
  tokenResolutionCache.set(provider, pending);
  const resolved = await pending;
  if (resolved === null) {
    tokenResolutionCache.delete(provider);
  }
  return resolved;
};

export function clearGitHostTokenCache(): void {
  tokenResolutionCache.clear();
}

export function setProviderTokenResolverForTests(resolver: ProviderTokenResolver | null): void {
  tokenResolutionCache.clear();
  providerTokenResolver = resolver ?? defaultProviderTokenResolver;
}

export async function buildGitHttpAuthEnvWithFallbacks(
  remoteUrl: string | null | undefined,
  auth: GitHttpAuthOptions = {},
  baseEnv: NodeJS.ProcessEnv = process.env,
): Promise<NodeJS.ProcessEnv | undefined> {
  const normalizedRemote = remoteUrl?.trim();
  if (!normalizedRemote || !isHttpRemote(normalizedRemote)) {
    return undefined;
  }

  const hostRemote = stripHttpCredentials(normalizedRemote);
  const { provider, hostDomain } = resolveRepositoryHost(hostRemote);
  if (!hostDomain || (provider !== "github" && provider !== "gitlab")) {
    return undefined;
  }

  const explicitToken = provider === "github"
    ? normalizeToken(auth.githubToken)
    : normalizeToken(auth.gitlabToken);
  const token = explicitToken ?? await resolveProviderToken(provider);
  if (!token) {
    return undefined;
  }

  const credentialPair = provider === "github"
    ? `x-access-token:${token}`
    : `oauth2:${token}`;
  const encoded = Buffer.from(credentialPair).toString("base64");
  return appendGitConfig(
    baseEnv,
    `http.https://${hostDomain}/.extraheader`,
    `Authorization: Basic ${encoded}`,
  );
}

export async function buildGitHttpAuthEnvForRepoWithFallbacks(
  repoPath: string,
  auth: GitHttpAuthOptions = {},
  baseEnv: NodeJS.ProcessEnv = process.env,
): Promise<NodeJS.ProcessEnv | undefined> {
  const remoteUrl = await readOriginRemoteUrl(repoPath);
  return buildGitHttpAuthEnvWithFallbacks(remoteUrl, auth, baseEnv);
}

export function buildNonInteractiveGitEnv(
  baseEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  return { ...baseEnv, ...NON_INTERACTIVE_GIT_ENV };
}

export async function resolveHttpsAuthOrFallback(
  remoteUrl: string | null | undefined,
  auth: GitHttpAuthOptions = {},
  baseEnv: NodeJS.ProcessEnv = process.env,
): Promise<NodeJS.ProcessEnv | undefined> {
  const normalizedRemote = remoteUrl?.trim();
  if (!normalizedRemote || !isHttpRemote(normalizedRemote)) {
    return undefined;
  }
  const authEnv = await buildGitHttpAuthEnvWithFallbacks(remoteUrl, auth, baseEnv);
  if (authEnv) {
    return { ...authEnv, ...NON_INTERACTIVE_GIT_ENV };
  }
  // No token available from any source. Force non-interactive so we fail
  // fast against a private HTTPS remote instead of hanging on an askpass
  // helper that has no way to authenticate from a long-running daemon.
  return { ...baseEnv, ...NON_INTERACTIVE_GIT_ENV };
}
