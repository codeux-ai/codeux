import * as fs from "fs/promises";
import type {
  CliExecutionMode,
  GoogleDriveAccessMode,
  GoogleDriveSettings,
} from "../contracts/app-types.js";
import type { Logger } from "../shared/logging/logger.js";
import {
  resolveConfiguredPath,
  type ContainerMount,
} from "./cli-docker-utils.js";

export const GOOGLE_DRIVE_CONTAINER_TARGET = "/mnt/code-ux/google-drive";
export const GOOGLE_DRIVE_PROMPT_SECTION_MARKER = "## LINKED GOOGLE DRIVE";

export interface GoogleDriveRuntimeMount extends ContainerMount {
  source: string;
  destination: typeof GOOGLE_DRIVE_CONTAINER_TARGET;
  readonly: boolean;
}

export interface GoogleDriveMountResolutionDependencies {
  logger?: Pick<Logger, "warn">;
  onActivity?: (description: string, originator?: string) => void;
}

const isGoogleDriveAccessMode = (value: unknown): value is GoogleDriveAccessMode => (
  value === "read-only" || value === "read-write"
);

const reportResolutionFailure = (
  reason: "invalid-access-mode" | "missing-source" | "source-not-directory" | "source-unavailable",
  configuredHostPath: string,
  dependencies: GoogleDriveMountResolutionDependencies,
  error?: unknown,
): void => {
  const descriptions = {
    "invalid-access-mode": "Google Drive mount disabled because its access mode is invalid.",
    "missing-source": "Google Drive mount disabled because the configured directory does not exist.",
    "source-not-directory": "Google Drive mount disabled because the configured source is not a directory.",
    "source-unavailable": "Google Drive mount disabled because the configured directory could not be inspected.",
  } as const;
  const description = descriptions[reason];
  dependencies.onActivity?.(description, "provider");
  dependencies.logger?.warn(description, {
    logPurpose: "settings",
    reason,
    configuredHostPath,
    ...(error === undefined
      ? {}
      : { error: error instanceof Error ? error.message : String(error) }),
  });
};

export const resolveGoogleDriveMount = async (
  settings: GoogleDriveSettings,
  repoPath: string,
  executionMode: CliExecutionMode,
  dependencies: GoogleDriveMountResolutionDependencies = {},
): Promise<GoogleDriveRuntimeMount | null> => {
  if (!settings.enabled || executionMode !== "DOCKER") {
    return null;
  }
  if (!isGoogleDriveAccessMode(settings.accessMode)) {
    reportResolutionFailure("invalid-access-mode", settings.hostPath, dependencies);
    return null;
  }

  const source = resolveConfiguredPath(repoPath, settings.hostPath);
  if (!source) {
    return null;
  }

  try {
    const sourceStat = await fs.stat(source);
    if (!sourceStat.isDirectory()) {
      reportResolutionFailure("source-not-directory", source, dependencies);
      return null;
    }
  } catch (error) {
    const reason = (error as NodeJS.ErrnoException)?.code === "ENOENT"
      ? "missing-source"
      : "source-unavailable";
    reportResolutionFailure(reason, source, dependencies, error);
    return null;
  }

  return {
    source,
    destination: GOOGLE_DRIVE_CONTAINER_TARGET,
    readonly: settings.accessMode === "read-only",
  };
};

export const buildGoogleDrivePromptNotice = (accessMode: GoogleDriveAccessMode): string => {
  const accessDescription = accessMode === "read-only" ? "read-only" : "read-write";
  return [
    GOOGLE_DRIVE_PROMPT_SECTION_MARKER,
    `A linked Google Drive directory is available at \`${GOOGLE_DRIVE_CONTAINER_TARGET}\` with ${accessDescription} access.`,
    "This directory is separate from the Git workspace: use it only for linked Drive files, and keep repository changes in the Git workspace.",
  ].join("\n");
};

export const composeGoogleDrivePrompt = (
  prompt: string,
  accessMode: GoogleDriveAccessMode,
): string => {
  const alreadyComposed = prompt
    .split(/\r?\n/u)
    .some((line) => line.trim() === GOOGLE_DRIVE_PROMPT_SECTION_MARKER);
  return alreadyComposed ? prompt : `${prompt}\n\n${buildGoogleDrivePromptNotice(accessMode)}`;
};
