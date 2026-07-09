/**
 * @vitest-environment jsdom
 */
import { render, screen, within, cleanup } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OnboardingInstallationStep } from "../../../dashboard/src/v2/components/onboarding/OnboardingInstallationStep.js";
import type {
  OnboardingDependencyCheck,
  OnboardingDependencyInstallMode,
  OnboardingDependencyInstallerOption,
  OnboardingDependencyInstallerResult,
  OnboardingRuntimeReadiness,
} from "../../../dashboard/src/types.js";

expect.extend(matchers);

const osInfo = {
  osLabel: "Linux",
  dockerDesktopLink: "https://example.test/docker-desktop",
  dockerDownloadLink: "https://example.test/docker-engine",
  gitLink: "",
  gitInstruction: "",
};

const dependency = (
  id: string,
  label: string,
  status: OnboardingDependencyCheck["status"],
): OnboardingDependencyCheck => ({
  id,
  label,
  status,
  required: true,
  description: `${label} description`,
  resolution: `Install ${label}`,
  detail: `${label} detail`,
});

const installerOption = (
  mode: OnboardingDependencyInstallMode,
  overrides: Partial<OnboardingDependencyInstallerOption> = {},
): OnboardingDependencyInstallerOption => ({
  mode,
  label: mode === "docker-desktop-git" ? "Docker Desktop" : "Docker Engine",
  platform: "linux",
  recommended: mode === "docker-engine-git",
  automation: mode === "docker-engine-git" ? "automated" : "partial",
  description: mode === "docker-engine-git"
    ? "Installs Docker Engine packages through the detected Linux package manager."
    : "Provides official Docker Desktop manual-download guidance.",
  dependencyIds: ["docker-cli", "docker-daemon"],
  requiresPrivilege: true,
  requiresManualDownload: mode === "docker-desktop-git",
  available: true,
  guidance: mode === "docker-engine-git"
    ? ["The Docker service may need to be started and the current user may need Docker group access after installation."]
    : ["Download Docker Desktop for Linux from Docker's official distro-specific packages, then start the desktop app."],
  ...overrides,
});

const readiness = (overrides: Partial<OnboardingRuntimeReadiness> = {}): OnboardingRuntimeReadiness => ({
  checkedAt: "2026-07-07T00:00:00.000Z",
  cluster: {
    status: "not_ready",
    label: "Cluster not ready",
    detail: "Docker is required.",
  },
  dependencies: [
    dependency("docker-cli", "Docker CLI", "missing"),
    dependency("docker-daemon", "Docker daemon", "missing"),
  ],
  providers: [],
  installers: {
    platform: "linux",
    recommendedMode: "docker-engine-git",
    options: [
      installerOption("docker-desktop-git"),
      installerOption("docker-engine-git"),
    ],
  },
  ...overrides,
});

const installResult = (overrides: Partial<OnboardingDependencyInstallerResult> = {}): OnboardingDependencyInstallerResult => ({
  mode: "docker-engine-git",
  platform: "linux",
  status: "failed",
  commands: [
    {
      id: "apt-install-docker",
      groupId: "docker-engine",
      label: "Install Docker Engine",
      command: "sudo",
      args: ["-n", "apt-get", "install", "-y", "docker.io"],
      displayCommand: "sudo -n apt-get install -y docker.io",
      status: "failed",
      timeoutMs: 120000,
      maxStdoutChars: 4000,
      maxStderrChars: 4000,
      code: 1,
      stdoutSummary: "",
      stderrSummary: "permission denied",
      message: "apt-get failed",
    },
  ],
  skippedDependencyGroups: [],
  requiresPrivilege: true,
  requiresManualDownload: true,
  postInstallGuidance: [
    "Restart the terminal after installation so PATH changes are visible.",
    "Start Docker manually, then rerun readiness checks.",
  ],
  message: "Installer commands failed. Review the bounded command summaries and follow the manual guidance.",
  ...overrides,
});

afterEach(() => {
  cleanup();
});

describe("OnboardingInstallationStep", () => {
  it("renders missing dependencies, manual links, and the primary auto install action", () => {
    render(<OnboardingInstallationStep clusterReady={false} readiness={readiness()} osInfo={osInfo} onAutoInstall={vi.fn()} />);

    expect(screen.getByRole("status", { name: "Docker CLI: missing" })).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Docker daemon: missing" })).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: `Install for ${osInfo.osLabel}` })).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: "Engine alternative" })).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Auto Install dependencies" })).toBeEnabled();
    expect(screen.getByText(/run the detected OS package manager for Docker/i)).toBeInTheDocument();
  });

  it("fires the primary auto-install callback from explicit user action", async () => {
    const onAutoInstall = vi.fn();
    const user = userEvent.setup();

    render(<OnboardingInstallationStep clusterReady={false} readiness={readiness()} osInfo={osInfo} onAutoInstall={onAutoInstall} />);
    await user.click(screen.getByRole("button", { name: "Auto Install dependencies" }));

    expect(onAutoInstall).toHaveBeenCalledTimes(1);
  });

  it("shows advanced installer choices with guided and recommended states", () => {
    render(<OnboardingInstallationStep clusterReady={false} readiness={readiness()} osInfo={osInfo} onInstallMode={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "Advanced installer choices" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Docker Desktop" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Docker Engine" })).toBeInTheDocument();
    expect(screen.getByText("Guided")).toBeInTheDocument();
    expect(screen.getByText("Recommended")).toBeInTheDocument();
    expect(screen.getByText(/manual download guidance for platform-specific Docker packages/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Use Docker Desktop" })).toBeEnabled();
  });

  it("disables unavailable advanced modes and keeps manual guidance visible", () => {
    const unsupported = readiness({
      installers: {
        platform: "unsupported",
        recommendedMode: null,
        options: [
          installerOption("docker-desktop-git", {
            platform: "unsupported",
            recommended: false,
            automation: "unsupported",
            available: false,
            requiresPrivilege: false,
            requiresManualDownload: true,
            guidance: ["Install Docker manually for this platform, then rerun readiness checks."],
          }),
          installerOption("docker-engine-git", {
            platform: "unsupported",
            recommended: false,
            automation: "unsupported",
            available: false,
            requiresPrivilege: false,
            requiresManualDownload: true,
            guidance: ["Install Docker Engine manually for this platform, then rerun readiness checks."],
          }),
        ],
      },
    });

    render(<OnboardingInstallationStep clusterReady={false} readiness={unsupported} osInfo={osInfo} onInstallMode={vi.fn()} />);

    expect(screen.queryByRole("button", { name: "Auto Install dependencies" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Manual setup required" })).toHaveLength(2);
    for (const button of screen.getAllByRole("button", { name: "Manual setup required" })) {
      expect(button).toBeDisabled();
    }
    expect(screen.getByText(/Install Docker manually for this platform/i)).toBeInTheDocument();
  });

  it("displays privilege, manual download, skipped groups, failed summaries, and retry paths from results", () => {
    const onInstallMode = vi.fn();
    const onRecheck = vi.fn();

    render(
      <OnboardingInstallationStep
        clusterReady={false}
        readiness={readiness()}
        osInfo={osInfo}
        lastInstallResult={installResult()}
        onInstallMode={onInstallMode}
        onRecheck={onRecheck}
      />,
    );

    expect(screen.getByRole("heading", { name: "Latest install result" })).toBeInTheDocument();
    expect(screen.getByText(/Administrator privileges or passwordless sudo are required/i)).toBeInTheDocument();
    expect(screen.getByText(/Manual Docker download is still required/i)).toBeInTheDocument();
    expect(screen.queryByText("Skipped ready dependency groups")).not.toBeInTheDocument();
    expect(screen.getByText("Failed command summaries")).toBeInTheDocument();
    expect(screen.getByText("sudo -n apt-get install -y docker.io")).toBeInTheDocument();
    expect(screen.getByText(/stderr: permission denied/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry Docker Engine" })).toBeEnabled();
    expect(screen.getAllByRole("button", { name: "Recheck readiness" }).length).toBeGreaterThan(0);
  });

  it("bounds failed command messages before rendering installer output", () => {
    const longMessage = `raw-start-${"x".repeat(700)}-raw-end`;

    render(
      <OnboardingInstallationStep
        clusterReady={false}
        readiness={readiness()}
        osInfo={osInfo}
        lastInstallResult={installResult({
          commands: [
            {
              ...installResult().commands[0],
              message: longMessage,
            },
          ],
        })}
      />,
    );

    expect(screen.queryByText(longMessage)).not.toBeInTheDocument();
    expect(screen.getByText((content) => (
      content.startsWith("...")
      && content.endsWith("-raw-end")
      && content.length <= 503
    ))).toBeInTheDocument();
  });

  it("announces install progress in a polite live region", () => {
    render(
      <OnboardingInstallationStep
        clusterReady={false}
        readiness={readiness()}
        osInfo={osInfo}
        runningInstallMode="docker-engine-git"
        onAutoInstall={vi.fn()}
        onInstallMode={vi.fn()}
      />,
    );

    const status = screen.getByText("Installing Docker Engine").closest("[role='status']");
    expect(status).not.toBeNull();
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(within(status as HTMLElement).getByText(/running package-manager commands now/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Auto Install dependencies" })).toBeDisabled();
  });

  it("shows successful result guidance and recheck action", () => {
    render(
      <OnboardingInstallationStep
        clusterReady={false}
        readiness={readiness()}
        osInfo={osInfo}
        lastInstallResult={installResult({
          status: "success",
          commands: [],
          skippedDependencyGroups: [],
          requiresPrivilege: false,
          requiresManualDownload: false,
          message: "Installer commands completed. Rerun readiness checks after refreshing the terminal or starting Docker if needed.",
        })}
        onRecheck={vi.fn()}
      />,
    );

    expect(screen.getByText(/Installer commands completed/i)).toBeInTheDocument();
    expect(screen.getByText(/Restart the terminal after installation/i)).toBeInTheDocument();
    expect(screen.getByText(/Start Docker manually/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Recheck readiness" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Retry Docker Engine" })).not.toBeInTheDocument();
  });

  it("renders the all-ready state without an install prompt", () => {
    render(
      <OnboardingInstallationStep
        clusterReady
        readiness={readiness({
          cluster: {
            status: "ready",
            label: "Cluster ready",
            detail: "Docker is ready.",
          },
          dependencies: [
            dependency("docker-cli", "Docker CLI", "ready"),
            dependency("docker-daemon", "Docker daemon", "ready"),
          ],
        })}
        osInfo={osInfo}
        onRecheck={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: "Auto Install dependencies" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Advanced installer choices" })).not.toBeInTheDocument();
    expect(screen.getByText(/No dependency install action is needed/i)).toBeInTheDocument();
  });
});
