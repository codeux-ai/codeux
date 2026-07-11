import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GoogleDriveSettings } from "../../../src/contracts/app-types.js";
import {
  GOOGLE_DRIVE_CONTAINER_TARGET,
  GOOGLE_DRIVE_PROMPT_SECTION_MARKER,
  buildGoogleDrivePromptNotice,
  composeGoogleDrivePrompt,
  resolveGoogleDriveMount,
} from "../../../src/services/google-drive-mount-service.js";

describe("google-drive-mount-service", () => {
  let repoPath: string;
  let logger: { warn: ReturnType<typeof vi.fn> };
  let onActivity: ReturnType<typeof vi.fn>;

  const settings = (overrides: Partial<GoogleDriveSettings> = {}): GoogleDriveSettings => ({
    enabled: true,
    hostPath: "drive",
    accessMode: "read-only",
    ...overrides,
  });

  beforeEach(async () => {
    repoPath = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-google-drive-"));
    logger = { warn: vi.fn() };
    onActivity = vi.fn();
  });

  afterEach(async () => {
    await fs.rm(repoPath, { recursive: true, force: true });
  });

  it("returns no mount when disabled or empty", async () => {
    await expect(resolveGoogleDriveMount(settings({ enabled: false }), repoPath, "DOCKER"))
      .resolves.toBeNull();
    await expect(resolveGoogleDriveMount(settings({ hostPath: "  " }), repoPath, "DOCKER"))
      .resolves.toBeNull();
  });

  it("returns no mount and logs an actionable missing-directory failure", async () => {
    await expect(resolveGoogleDriveMount(settings(), repoPath, "DOCKER", { logger, onActivity }))
      .resolves.toBeNull();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("does not exist"),
      expect.objectContaining({ reason: "missing-source" }),
    );
    expect(onActivity).toHaveBeenCalledWith(expect.stringContaining("does not exist"), "provider");
  });

  it("returns no mount when the source is a file", async () => {
    await fs.writeFile(path.join(repoPath, "drive"), "not a directory");

    await expect(resolveGoogleDriveMount(settings(), repoPath, "DOCKER", { logger }))
      .resolves.toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("not a directory"),
      expect.objectContaining({ reason: "source-not-directory" }),
    );
  });

  it("resolves a valid project-relative directory as read-only", async () => {
    const source = path.join(repoPath, "drive");
    await fs.mkdir(source);

    await expect(resolveGoogleDriveMount(settings(), repoPath, "DOCKER")).resolves.toEqual({
      source,
      destination: GOOGLE_DRIVE_CONTAINER_TARGET,
      readonly: true,
    });
  });

  it("resolves environment variables and maps read-write access", async () => {
    const source = path.join(repoPath, "linked-drive");
    await fs.mkdir(source);
    process.env.CODE_UX_TEST_GOOGLE_DRIVE = source;
    try {
      await expect(resolveGoogleDriveMount(
        settings({ hostPath: "$CODE_UX_TEST_GOOGLE_DRIVE", accessMode: "read-write" }),
        repoPath,
        "DOCKER",
      )).resolves.toEqual({
        source,
        destination: GOOGLE_DRIVE_CONTAINER_TARGET,
        readonly: false,
      });
    } finally {
      delete process.env.CODE_UX_TEST_GOOGLE_DRIVE;
    }
  });

  it("fails closed in host mode and for an invalid access mode", async () => {
    const source = path.join(repoPath, "drive");
    await fs.mkdir(source);

    await expect(resolveGoogleDriveMount(settings(), repoPath, "HOST", { logger }))
      .resolves.toBeNull();
    await expect(resolveGoogleDriveMount(
      settings({ accessMode: "owner" as GoogleDriveSettings["accessMode"] }),
      repoPath,
      "DOCKER",
      { logger },
    )).resolves.toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("access mode is invalid"),
      expect.objectContaining({ reason: "invalid-access-mode" }),
    );
  });

  it("builds a safe notice and composes it idempotently", () => {
    const configuredHostPath = path.join(repoPath, "private", "drive");
    const notice = buildGoogleDrivePromptNotice("read-write");
    const composed = composeGoogleDrivePrompt("Original prompt\n\n## PERSISTENT SKILL STORAGE (Opt-in)\nKeep this.", "read-write");
    const repeated = composeGoogleDrivePrompt(composed, "read-write");

    expect(notice).toContain(GOOGLE_DRIVE_CONTAINER_TARGET);
    expect(notice).toContain("read-write");
    expect(notice).toContain("separate from the Git workspace");
    expect(notice).not.toContain(configuredHostPath);
    expect(repeated).toBe(composed);
    expect(repeated.match(new RegExp(GOOGLE_DRIVE_PROMPT_SECTION_MARKER, "g"))).toHaveLength(1);
    expect(repeated).toContain("Original prompt");
    expect(repeated).toContain("## PERSISTENT SKILL STORAGE (Opt-in)");
  });
});
