import { describe, expect, it } from "vitest";
import { resolveRepositoryHost } from "../../../../src/infrastructure/git/repository-host-resolver.js";

describe("RepositoryHostResolver", () => {
  it("resolves null to local", () => {
    expect(resolveRepositoryHost(null)).toEqual({ provider: "local", hostDomain: null, repoTarget: null });
  });

  it("resolves empty string to local", () => {
    expect(resolveRepositoryHost("")).toEqual({ provider: "local", hostDomain: null, repoTarget: null });
  });

  it("resolves standard github.com SSH URL", () => {
    expect(resolveRepositoryHost("git@github.com:owner/repo.git")).toEqual({
      provider: "github",
      hostDomain: "github.com",
      repoTarget: "owner/repo",
    });
  });

  it("resolves standard github.com HTTPS URL", () => {
    expect(resolveRepositoryHost("https://github.com/owner/repo.git")).toEqual({
      provider: "github",
      hostDomain: "github.com",
      repoTarget: "owner/repo",
    });
  });

  it("resolves standard gitlab.com SSH URL", () => {
    expect(resolveRepositoryHost("git@gitlab.com:group/subgroup/repo.git")).toEqual({
      provider: "gitlab",
      hostDomain: "gitlab.com",
      repoTarget: "group/subgroup/repo",
    });
  });

  it("resolves self-hosted gitlab HTTPS URL by domain name", () => {
    expect(resolveRepositoryHost("https://gitlab.example.com/group/repo.git")).toEqual({
      provider: "gitlab",
      hostDomain: "gitlab.example.com",
      repoTarget: "group/repo",
    });
  });

  it("resolves self-hosted gitlab SSH URL by subgroup path depth", () => {
    expect(resolveRepositoryHost("git@git.mycompany.com:group/subgroup/repo.git")).toEqual({
      provider: "gitlab",
      hostDomain: "git.mycompany.com",
      repoTarget: "group/subgroup/repo",
    });
  });

  it("resolves unrecognized SSH domain with standard path to local", () => {
    expect(resolveRepositoryHost("git@git.mycompany.com:owner/repo.git")).toEqual({
      provider: "local",
      hostDomain: "git.mycompany.com",
      repoTarget: "owner/repo",
    });
  });

  it("resolves unrecognized HTTPS domain with standard path to local", () => {
    expect(resolveRepositoryHost("https://git.mycompany.com/owner/repo.git")).toEqual({
      provider: "local",
      hostDomain: "git.mycompany.com",
      repoTarget: "owner/repo",
    });
  });

  it("resolves local file path to local", () => {
    expect(resolveRepositoryHost("/Users/jules/code/my-repo")).toEqual({
      provider: "local",
      hostDomain: null,
      repoTarget: null,
    });
  });

  it("resolves Windows local file path to local", () => {
    expect(resolveRepositoryHost("C:\\Users\\jules\\code\\my-repo")).toEqual({
      provider: "local",
      hostDomain: null,
      repoTarget: null,
    });
  });

  it("resolves file:// protocol to local", () => {
    expect(resolveRepositoryHost("file:///path/to/repo")).toEqual({
      provider: "local",
      hostDomain: null,
      repoTarget: null,
    });
  });
});
