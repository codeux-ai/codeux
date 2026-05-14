import { resolveRepositoryHost } from "../infrastructure/git/repository-host-resolver.js";

export interface GitHttpAuthOptions {
  githubToken?: string | null;
  gitlabToken?: string | null;
}

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
