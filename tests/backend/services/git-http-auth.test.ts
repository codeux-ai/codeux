import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runCommandStrict = vi.fn();
const commandRun = vi.fn();

vi.mock("../../../src/services/cli-process-runner.js", () => ({
  runCommandStrict: (...a: unknown[]) => runCommandStrict(...a),
}));

vi.mock("../../../src/shared/subprocess/command-runner.js", () => ({
  commandRunner: { run: (...a: unknown[]) => commandRun(...a) },
}));

import {
  buildGitHttpAuthEnv,
  buildGitHttpAuthEnvForRepo,
  buildGitHttpAuthEnvWithFallbacks,
  buildGitHttpAuthEnvForRepoWithFallbacks,
  buildNonInteractiveGitEnv,
  readOriginRemoteUrl,
  resolveHttpsAuthOrFallback,
  clearGitHostTokenCache,
  setProviderTokenResolverForTests,
} from "../../../src/services/git-http-auth.js";

const decodeHeader = (env: NodeJS.ProcessEnv | undefined): string => {
  const keyIndex = env?.GIT_CONFIG_COUNT ? Number(env.GIT_CONFIG_COUNT) - 1 : 0;
  const header = env?.[`GIT_CONFIG_VALUE_${keyIndex}`] ?? "";
  const base64 = header.replace("Authorization: Basic ", "");
  return Buffer.from(base64, "base64").toString("utf8");
};

beforeEach(() => {
  vi.clearAllMocks();
  clearGitHostTokenCache();
  setProviderTokenResolverForTests(null);
});

afterEach(() => {
  setProviderTokenResolverForTests(null);
  clearGitHostTokenCache();
});

describe("buildGitHttpAuthEnv", () => {
  it("returns undefined for missing or non-http remotes", () => {
    expect(buildGitHttpAuthEnv(undefined)).toBeUndefined();
    expect(buildGitHttpAuthEnv("git@github.com:me/repo.git", { githubToken: "t" })).toBeUndefined();
  });

  it("builds a GitHub basic-auth extraheader using x-access-token", () => {
    const env = buildGitHttpAuthEnv("https://github.com/me/repo.git", { githubToken: "ghtok" }, {});
    expect(env?.GIT_CONFIG_KEY_0).toBe("http.https://github.com/.extraheader");
    expect(decodeHeader(env)).toBe("x-access-token:ghtok");
  });

  it("builds a GitLab basic-auth extraheader using oauth2", () => {
    const env = buildGitHttpAuthEnv("https://gitlab.com/me/repo.git", { gitlabToken: "gltok" }, {});
    expect(env?.GIT_CONFIG_KEY_0).toBe("http.https://gitlab.com/.extraheader");
    expect(decodeHeader(env)).toBe("oauth2:gltok");
  });

  it("returns undefined when the provider token is missing or blank", () => {
    expect(buildGitHttpAuthEnv("https://github.com/me/repo.git", { githubToken: "  " })).toBeUndefined();
    expect(buildGitHttpAuthEnv("https://gitlab.com/me/repo.git", {})).toBeUndefined();
  });

  it("strips embedded credentials from the host before building the config key", () => {
    const env = buildGitHttpAuthEnv("https://user:pw@github.com/me/repo.git", { githubToken: "t" }, {});
    expect(env?.GIT_CONFIG_KEY_0).toBe("http.https://github.com/.extraheader");
  });

  it("appends to an existing GIT_CONFIG_COUNT instead of overwriting", () => {
    const env = buildGitHttpAuthEnv("https://github.com/me/repo.git", { githubToken: "t" }, { GIT_CONFIG_COUNT: "2" });
    expect(env?.GIT_CONFIG_COUNT).toBe("3");
    expect(env?.GIT_CONFIG_KEY_2).toBe("http.https://github.com/.extraheader");
  });
});

describe("buildNonInteractiveGitEnv", () => {
  it("merges the non-interactive git env flags onto the base env", () => {
    const env = buildNonInteractiveGitEnv({ EXISTING: "1" });
    expect(env).toMatchObject({
      EXISTING: "1",
      GIT_TERMINAL_PROMPT: "0",
      GIT_ASKPASS: "true",
      GCM_INTERACTIVE: "never",
    });
  });
});

describe("readOriginRemoteUrl", () => {
  it("returns the trimmed origin url", async () => {
    runCommandStrict.mockResolvedValue({ stdout: "https://github.com/me/repo.git\n" });
    await expect(readOriginRemoteUrl("/repo")).resolves.toBe("https://github.com/me/repo.git");
  });

  it("returns null for an empty url", async () => {
    runCommandStrict.mockResolvedValue({ stdout: "   " });
    await expect(readOriginRemoteUrl("/repo")).resolves.toBeNull();
  });

  it("returns null when the git command throws", async () => {
    runCommandStrict.mockRejectedValue(new Error("no origin"));
    await expect(readOriginRemoteUrl("/repo")).resolves.toBeNull();
  });
});

describe("buildGitHttpAuthEnvForRepo", () => {
  it("reads the origin remote then builds the auth env", async () => {
    runCommandStrict.mockResolvedValue({ stdout: "https://github.com/me/repo.git" });
    const env = await buildGitHttpAuthEnvForRepo("/repo", { githubToken: "t" }, {});
    expect(decodeHeader(env)).toBe("x-access-token:t");
  });
});

describe("buildGitHttpAuthEnvWithFallbacks", () => {
  it("uses an explicit token when provided", async () => {
    const env = await buildGitHttpAuthEnvWithFallbacks("https://github.com/me/repo.git", { githubToken: "explicit" }, {});
    expect(decodeHeader(env)).toBe("x-access-token:explicit");
  });

  it("falls back to the provider token resolver and caches the result", async () => {
    const resolver = vi.fn(async () => "resolved-token");
    setProviderTokenResolverForTests(resolver);

    const env = await buildGitHttpAuthEnvWithFallbacks("https://github.com/me/repo.git", {}, {});
    expect(decodeHeader(env)).toBe("x-access-token:resolved-token");

    // Second call hits the cache, resolver not called again.
    await buildGitHttpAuthEnvWithFallbacks("https://github.com/me/other.git", {}, {});
    expect(resolver).toHaveBeenCalledTimes(1);
  });

  it("does not cache null resolutions", async () => {
    const resolver = vi.fn(async () => null);
    setProviderTokenResolverForTests(resolver);

    await buildGitHttpAuthEnvWithFallbacks("https://gitlab.com/me/repo.git", {}, {});
    await buildGitHttpAuthEnvWithFallbacks("https://gitlab.com/me/repo.git", {}, {});
    expect(resolver).toHaveBeenCalledTimes(2);
  });

  it("returns undefined for non-http remotes and treats any other http host as GitLab", async () => {
    expect(await buildGitHttpAuthEnvWithFallbacks("git@github.com:me/repo.git")).toBeUndefined();
    const env = await buildGitHttpAuthEnvWithFallbacks("https://example.invalid/me/repo.git", { gitlabToken: "gl" }, {});
    expect(env?.GIT_CONFIG_KEY_0).toBe("http.https://example.invalid/.extraheader");
    expect(decodeHeader(env)).toBe("oauth2:gl");
  });

  it("returns undefined when no token is available anywhere", async () => {
    setProviderTokenResolverForTests(async () => null);
    expect(await buildGitHttpAuthEnvWithFallbacks("https://github.com/me/repo.git", {}, {})).toBeUndefined();
  });

  it("reads the repo origin in the WithFallbacks repo variant", async () => {
    runCommandStrict.mockResolvedValue({ stdout: "https://gitlab.com/me/repo.git" });
    const env = await buildGitHttpAuthEnvForRepoWithFallbacks("/repo", { gitlabToken: "gl" }, {});
    expect(decodeHeader(env)).toBe("oauth2:gl");
  });
});

describe("resolveHttpsAuthOrFallback", () => {
  it("returns undefined for non-http remotes", async () => {
    expect(await resolveHttpsAuthOrFallback("git@github.com:me/repo.git")).toBeUndefined();
  });

  it("merges the auth env with non-interactive flags when a token resolves", async () => {
    const env = await resolveHttpsAuthOrFallback("https://github.com/me/repo.git", { githubToken: "t" }, {});
    expect(env?.GIT_TERMINAL_PROMPT).toBe("0");
    expect(decodeHeader(env)).toBe("x-access-token:t");
  });

  it("falls back to a non-interactive base env when no token is available", async () => {
    setProviderTokenResolverForTests(async () => null);
    const env = await resolveHttpsAuthOrFallback("https://github.com/me/repo.git", {}, { BASE: "1" });
    expect(env).toMatchObject({ BASE: "1", GIT_TERMINAL_PROMPT: "0" });
    expect(env?.GIT_CONFIG_COUNT).toBeUndefined();
  });
});
