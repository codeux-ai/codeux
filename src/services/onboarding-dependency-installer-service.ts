import type {
  OnboardingDependencyCheck,
  OnboardingDependencyInstallMode,
  OnboardingDependencyInstallerCommandResult,
  OnboardingDependencyInstallerMetadata,
  OnboardingDependencyInstallerOption,
  OnboardingDependencyInstallerResult,
  OnboardingDependencyInstallerSkippedGroup,
  OnboardingInstallerPlatform,
} from "../contracts/app-types.js";
import { commandRunner } from "../shared/subprocess/command-runner.js";
import type { CommandResult } from "../shared/subprocess/command-runner.js";

export type OnboardingLinuxPackageManager = "apt" | "dnf" | "yum" | "zypper" | "pacman";

export interface OnboardingInstallerEnvironment {
  platform?: NodeJS.Platform | OnboardingInstallerPlatform;
  linuxPackageManager?: OnboardingLinuxPackageManager | null;
  homebrewAvailable?: boolean;
  wingetAvailable?: boolean;
  systemctlAvailable?: boolean;
  isRoot?: boolean;
  passwordlessSudoAvailable?: boolean;
}

export interface ExecuteOnboardingDependencyInstallInput {
  mode: OnboardingDependencyInstallMode;
  dependencies: OnboardingDependencyCheck[];
  environment?: OnboardingInstallerEnvironment;
  invalidateReadinessCache?: () => void;
}

interface InstallerCommandSpec {
  id: string;
  groupId: string;
  groupLabel: string;
  label: string;
  dependencyIds: string[];
  command: string;
  args: string[];
  privileged: boolean;
  timeoutMs: number;
}

interface PlannedInstallerCommand extends InstallerCommandSpec {
  displayCommand: string;
  runCommand: string;
  runArgs: string[];
}

interface CommandGroup {
  id: string;
  label: string;
  dependencyIds: string[];
  commands: InstallerCommandSpec[];
}

interface CommandPlan {
  platform: OnboardingInstallerPlatform;
  mode: OnboardingDependencyInstallMode;
  commands: PlannedInstallerCommand[];
  privilegeSkippedCommands: PlannedInstallerCommand[];
  skippedDependencyGroups: OnboardingDependencyInstallerSkippedGroup[];
  requiresPrivilege: boolean;
  requiresManualDownload: boolean;
  postInstallGuidance: string[];
  unsupported: boolean;
  unsupportedMessage?: string;
}

const INSTALL_TIMEOUT_MS = 120_000;
const PACKAGE_INDEX_TIMEOUT_MS = 120_000;
const SERVICE_TIMEOUT_MS = 20_000;
const DETECTION_TIMEOUT_MS = 2_000;
const MAX_COMMAND_STDOUT_CHARS = 4_000;
const MAX_COMMAND_STDERR_CHARS = 4_000;
const MAX_DETECTION_OUTPUT_CHARS = 200;
const OUTPUT_SUMMARY_CHARS = 1_200;

const VALID_MODES: ReadonlySet<OnboardingDependencyInstallMode> = new Set([
  "docker-desktop-git",
  "docker-engine-git",
]);

const LINUX_PACKAGE_MANAGERS: ReadonlySet<OnboardingLinuxPackageManager> = new Set([
  "apt",
  "dnf",
  "yum",
  "zypper",
  "pacman",
]);

const LINUX_PACKAGE_MANAGER_PROBES: ReadonlyArray<{
  packageManager: OnboardingLinuxPackageManager;
  command: string;
  args: string[];
}> = [
  { packageManager: "apt", command: "apt-get", args: ["--version"] },
  { packageManager: "dnf", command: "dnf", args: ["--version"] },
  { packageManager: "yum", command: "yum", args: ["--version"] },
  { packageManager: "zypper", command: "zypper", args: ["--version"] },
  { packageManager: "pacman", command: "pacman", args: ["--version"] },
];

const normalizePlatform = (platform: NodeJS.Platform | OnboardingInstallerPlatform | undefined): OnboardingInstallerPlatform => {
  const value = platform ?? process.platform;
  if (value === "darwin" || value === "win32" || value === "linux") {
    return value;
  }
  return "unsupported";
};

const normalizePackageManager = (packageManager: OnboardingLinuxPackageManager | null | undefined): OnboardingLinuxPackageManager | null => (
  packageManager && LINUX_PACKAGE_MANAGERS.has(packageManager) ? packageManager : null
);

const detectCommandAvailable = async (command: string, args: string[]): Promise<boolean> => {
  try {
    const result = await commandRunner.run(command, args, {
      cwd: process.cwd(),
      timeout: DETECTION_TIMEOUT_MS,
      maxStdoutChars: MAX_DETECTION_OUTPUT_CHARS,
      maxStderrChars: MAX_DETECTION_OUTPUT_CHARS,
    });
    return result.ok;
  } catch {
    return false;
  }
};

const detectLinuxPackageManager = async (): Promise<OnboardingLinuxPackageManager | null> => {
  for (const probe of LINUX_PACKAGE_MANAGER_PROBES) {
    if (await detectCommandAvailable(probe.command, probe.args)) {
      return probe.packageManager;
    }
  }
  return null;
};

export const detectOnboardingInstallerEnvironment = async (
  platformInput: NodeJS.Platform | OnboardingInstallerPlatform = process.platform,
): Promise<OnboardingInstallerEnvironment> => {
  const platform = normalizePlatform(platformInput);
  const environment: OnboardingInstallerEnvironment = { platform };

  if (platform === "linux") {
    const getUid = (process as NodeJS.Process & { getuid?: () => number }).getuid;
    const isRoot = typeof getUid === "function" ? getUid() === 0 : false;
    environment.linuxPackageManager = await detectLinuxPackageManager();
    environment.systemctlAvailable = await detectCommandAvailable("systemctl", ["--version"]);
    environment.isRoot = isRoot;
    environment.passwordlessSudoAvailable = isRoot
      ? true
      : await detectCommandAvailable("sudo", ["-n", "true"]);
    return environment;
  }

  if (platform === "darwin") {
    environment.homebrewAvailable = await detectCommandAvailable("brew", ["--version"]);
    return environment;
  }

  if (platform === "win32") {
    environment.wingetAvailable = await detectCommandAvailable("winget", ["--version"]);
  }

  return environment;
};

const isDependencyReady = (dependencies: OnboardingDependencyCheck[], id: string): boolean => (
  dependencies.find((dependency) => dependency.id === id)?.status === "ready"
);

const areGroupDependenciesReady = (dependencies: OnboardingDependencyCheck[], dependencyIds: string[]): boolean => (
  dependencyIds.length > 0 && dependencyIds.every((id) => isDependencyReady(dependencies, id))
);

const quoteDisplayArg = (value: string): string => {
  if (/^[A-Za-z0-9._:/=@%+,-]+$/.test(value)) {
    return value;
  }
  return `'${value.replaceAll("'", "'\\''")}'`;
};

const formatDisplayCommand = (command: string, args: string[]): string => (
  [command, ...args].map(quoteDisplayArg).join(" ")
);

const boundText = (value: string, limit = OUTPUT_SUMMARY_CHARS): string => {
  if (value.length <= limit) {
    return value;
  }
  return `...${value.slice(value.length - limit)}`;
};

const commandResultFromSkipped = (command: PlannedInstallerCommand, message: string): OnboardingDependencyInstallerCommandResult => ({
  id: command.id,
  groupId: command.groupId,
  label: command.label,
  command: command.command,
  args: command.args,
  displayCommand: command.displayCommand,
  status: "skipped",
  timeoutMs: command.timeoutMs,
  maxStdoutChars: MAX_COMMAND_STDOUT_CHARS,
  maxStderrChars: MAX_COMMAND_STDERR_CHARS,
  code: null,
  stdoutSummary: "",
  stderrSummary: "",
  message,
});

const commandResultFromExecution = (
  command: PlannedInstallerCommand,
  result: CommandResult,
): OnboardingDependencyInstallerCommandResult => ({
  id: command.id,
  groupId: command.groupId,
  label: command.label,
  command: command.command,
  args: command.args,
  displayCommand: command.displayCommand,
  status: result.ok ? "success" : "failed",
  timeoutMs: command.timeoutMs,
  maxStdoutChars: MAX_COMMAND_STDOUT_CHARS,
  maxStderrChars: MAX_COMMAND_STDERR_CHARS,
  code: result.code,
  stdoutSummary: boundText(result.stdout),
  stderrSummary: boundText(result.stderr),
  message: result.ok ? undefined : `Command failed with exit code ${result.code ?? "unknown"}. Review bounded command summaries for details.`,
});

const commandResultFromThrownError = (
  command: PlannedInstallerCommand,
  error: unknown,
): OnboardingDependencyInstallerCommandResult => ({
  id: command.id,
  groupId: command.groupId,
  label: command.label,
  command: command.command,
  args: command.args,
  displayCommand: command.displayCommand,
  status: "failed",
  timeoutMs: command.timeoutMs,
  maxStdoutChars: MAX_COMMAND_STDOUT_CHARS,
  maxStderrChars: MAX_COMMAND_STDERR_CHARS,
  code: null,
  stdoutSummary: "",
  stderrSummary: boundText(error instanceof Error ? error.message : String(error)),
  message: "Command could not be started. Review bounded error summary for details.",
});

const platformLabel = (platform: OnboardingInstallerPlatform): string => {
  if (platform === "darwin") return "macOS";
  if (platform === "win32") return "Windows";
  if (platform === "linux") return "Linux";
  return "Unsupported platform";
};

const option = (
  input: Omit<OnboardingDependencyInstallerOption, "dependencyIds"> & { dependencyIds?: string[] },
): OnboardingDependencyInstallerOption => ({
  dependencyIds: ["docker-cli", "docker-daemon", "git-cli"],
  ...input,
});

export const planOnboardingDependencyInstallerOptions = (
  environment: OnboardingInstallerEnvironment = {},
): OnboardingDependencyInstallerMetadata => {
  const platform = normalizePlatform(environment.platform);
  const packageManager = normalizePackageManager(environment.linuxPackageManager);
  const homebrewAvailable = environment.homebrewAvailable !== false;
  const wingetAvailable = environment.wingetAvailable !== false;

  if (platform === "darwin") {
    return {
      platform,
      recommendedMode: "docker-desktop-git",
      options: [
        option({
          mode: "docker-desktop-git",
          label: "Docker Desktop and Git",
          platform,
          recommended: true,
          automation: homebrewAvailable ? "automated" : "manual",
          description: "Installs Docker Desktop and Git with Homebrew.",
          requiresPrivilege: false,
          requiresManualDownload: !homebrewAvailable,
          available: homebrewAvailable,
          guidance: homebrewAvailable
            ? ["Open Docker Desktop after installation, then rerun readiness checks once the daemon starts."]
            : ["Install Homebrew or install Docker Desktop and Git manually, then refresh the terminal PATH."],
        }),
        option({
          mode: "docker-engine-git",
          label: "Docker Engine and Git",
          platform,
          recommended: false,
          automation: homebrewAvailable ? "partial" : "manual",
          description: "Installs Git when possible, but Docker Engine on macOS still needs a Linux VM.",
          requiresPrivilege: false,
          requiresManualDownload: true,
          available: homebrewAvailable,
          guidance: ["Use Docker Desktop on macOS unless you manage a separate Linux VM for Docker Engine."],
        }),
      ],
    };
  }

  if (platform === "win32") {
    return {
      platform,
      recommendedMode: "docker-desktop-git",
      options: [
        option({
          mode: "docker-desktop-git",
          label: "Docker Desktop and Git",
          platform,
          recommended: true,
          automation: wingetAvailable ? "automated" : "manual",
          description: "Installs Docker Desktop and Git with winget.",
          requiresPrivilege: false,
          requiresManualDownload: !wingetAvailable,
          available: wingetAvailable,
          guidance: wingetAvailable
            ? ["Restart the terminal after installation and start Docker Desktop before rerunning readiness checks."]
            : ["Install winget or install Docker Desktop and Git manually, then refresh the terminal PATH."],
        }),
        option({
          mode: "docker-engine-git",
          label: "Docker Engine and Git",
          platform,
          recommended: false,
          automation: wingetAvailable ? "partial" : "manual",
          description: "Installs Git when possible, but Docker Engine on Windows should run through WSL or Docker Desktop.",
          requiresPrivilege: false,
          requiresManualDownload: true,
          available: wingetAvailable,
          guidance: ["Use Docker Desktop with WSL integration on Windows unless you manage Docker Engine inside a WSL distribution."],
        }),
      ],
    };
  }

  if (platform === "linux") {
    return {
      platform,
      recommendedMode: "docker-engine-git",
      options: [
        option({
          mode: "docker-engine-git",
          label: "Docker Engine and Git",
          platform,
          recommended: true,
          automation: packageManager ? "automated" : "manual",
          description: "Installs Docker Engine packages and Git through the detected Linux package manager.",
          requiresPrivilege: true,
          requiresManualDownload: !packageManager,
          available: Boolean(packageManager),
          guidance: packageManager
            ? ["The Docker service may need to be started and the current user may need Docker group access after installation."]
            : ["Install Docker Engine and Git manually because no supported Linux package manager was detected."],
        }),
        option({
          mode: "docker-desktop-git",
          label: "Docker Desktop and Git",
          platform,
          recommended: false,
          automation: packageManager ? "partial" : "manual",
          description: "Installs Git automatically when possible and provides official Docker Desktop manual-download guidance.",
          requiresPrivilege: true,
          requiresManualDownload: true,
          available: Boolean(packageManager),
          guidance: ["Download Docker Desktop for Linux from Docker's official distro-specific packages, then start the desktop app."],
        }),
      ],
    };
  }

  return {
    platform,
    recommendedMode: null,
    options: [
      option({
        mode: "docker-desktop-git",
        label: "Docker Desktop and Git",
        platform,
        recommended: false,
        automation: "unsupported",
        description: "Automated onboarding dependency installation is not available on this platform.",
        requiresPrivilege: false,
        requiresManualDownload: true,
        available: false,
        guidance: ["Install Docker and Git manually for this platform, then rerun readiness checks."],
      }),
      option({
        mode: "docker-engine-git",
        label: "Docker Engine and Git",
        platform,
        recommended: false,
        automation: "unsupported",
        description: "Automated onboarding dependency installation is not available on this platform.",
        requiresPrivilege: false,
        requiresManualDownload: true,
        available: false,
        guidance: ["Install Docker Engine and Git manually for this platform, then rerun readiness checks."],
      }),
    ],
  };
};

const linuxEnginePackageCommands = (packageManager: OnboardingLinuxPackageManager): InstallerCommandSpec[] => {
  if (packageManager === "apt") {
    return [
      {
        id: "apt-update",
        groupId: "linux-engine-packages",
        groupLabel: "Docker Engine and Git packages",
        label: "Refresh apt package metadata",
        dependencyIds: ["docker-cli", "git-cli"],
        command: "apt-get",
        args: ["update"],
        privileged: true,
        timeoutMs: PACKAGE_INDEX_TIMEOUT_MS,
      },
      {
        id: "apt-install-docker-git",
        groupId: "linux-engine-packages",
        groupLabel: "Docker Engine and Git packages",
        label: "Install Docker Engine and Git packages",
        dependencyIds: ["docker-cli", "git-cli"],
        command: "apt-get",
        args: ["install", "-y", "docker.io", "docker-compose-plugin", "git"],
        privileged: true,
        timeoutMs: INSTALL_TIMEOUT_MS,
      },
    ];
  }

  if (packageManager === "dnf") {
    return [{
      id: "dnf-install-docker-git",
      groupId: "linux-engine-packages",
      groupLabel: "Docker Engine and Git packages",
      label: "Install Docker Engine and Git packages",
      dependencyIds: ["docker-cli", "git-cli"],
      command: "dnf",
      args: ["install", "-y", "moby-engine", "docker-compose", "git"],
      privileged: true,
      timeoutMs: INSTALL_TIMEOUT_MS,
    }];
  }

  if (packageManager === "yum") {
    return [{
      id: "yum-install-docker-git",
      groupId: "linux-engine-packages",
      groupLabel: "Docker Engine and Git packages",
      label: "Install Docker and Git packages",
      dependencyIds: ["docker-cli", "git-cli"],
      command: "yum",
      args: ["install", "-y", "docker", "git"],
      privileged: true,
      timeoutMs: INSTALL_TIMEOUT_MS,
    }];
  }

  if (packageManager === "zypper") {
    return [{
      id: "zypper-install-docker-git",
      groupId: "linux-engine-packages",
      groupLabel: "Docker Engine and Git packages",
      label: "Install Docker and Git packages",
      dependencyIds: ["docker-cli", "git-cli"],
      command: "zypper",
      args: ["--non-interactive", "install", "docker", "git"],
      privileged: true,
      timeoutMs: INSTALL_TIMEOUT_MS,
    }];
  }

  return [{
    id: "pacman-install-docker-git",
    groupId: "linux-engine-packages",
    groupLabel: "Docker Engine and Git packages",
    label: "Install Docker and Git packages",
    dependencyIds: ["docker-cli", "git-cli"],
    command: "pacman",
    args: ["-Sy", "--noconfirm", "docker", "git"],
    privileged: true,
    timeoutMs: INSTALL_TIMEOUT_MS,
  }];
};

const linuxGitPackageCommands = (packageManager: OnboardingLinuxPackageManager): InstallerCommandSpec[] => {
  if (packageManager === "apt") {
    return [
      {
        id: "apt-update-for-git",
        groupId: "linux-git-package",
        groupLabel: "Git package",
        label: "Refresh apt package metadata",
        dependencyIds: ["git-cli"],
        command: "apt-get",
        args: ["update"],
        privileged: true,
        timeoutMs: PACKAGE_INDEX_TIMEOUT_MS,
      },
      {
        id: "apt-install-git",
        groupId: "linux-git-package",
        groupLabel: "Git package",
        label: "Install Git package",
        dependencyIds: ["git-cli"],
        command: "apt-get",
        args: ["install", "-y", "git"],
        privileged: true,
        timeoutMs: INSTALL_TIMEOUT_MS,
      },
    ];
  }

  if (packageManager === "dnf") {
    return [{
      id: "dnf-install-git",
      groupId: "linux-git-package",
      groupLabel: "Git package",
      label: "Install Git package",
      dependencyIds: ["git-cli"],
      command: "dnf",
      args: ["install", "-y", "git"],
      privileged: true,
      timeoutMs: INSTALL_TIMEOUT_MS,
    }];
  }

  if (packageManager === "yum") {
    return [{
      id: "yum-install-git",
      groupId: "linux-git-package",
      groupLabel: "Git package",
      label: "Install Git package",
      dependencyIds: ["git-cli"],
      command: "yum",
      args: ["install", "-y", "git"],
      privileged: true,
      timeoutMs: INSTALL_TIMEOUT_MS,
    }];
  }

  if (packageManager === "zypper") {
    return [{
      id: "zypper-install-git",
      groupId: "linux-git-package",
      groupLabel: "Git package",
      label: "Install Git package",
      dependencyIds: ["git-cli"],
      command: "zypper",
      args: ["--non-interactive", "install", "git"],
      privileged: true,
      timeoutMs: INSTALL_TIMEOUT_MS,
    }];
  }

  return [{
    id: "pacman-install-git",
    groupId: "linux-git-package",
    groupLabel: "Git package",
    label: "Install Git package",
    dependencyIds: ["git-cli"],
    command: "pacman",
    args: ["-Sy", "--noconfirm", "git"],
    privileged: true,
    timeoutMs: INSTALL_TIMEOUT_MS,
  }];
};

const commandGroupsForMode = (
  mode: OnboardingDependencyInstallMode,
  environment: Required<Pick<OnboardingInstallerEnvironment, "systemctlAvailable" | "homebrewAvailable" | "wingetAvailable">> & OnboardingInstallerEnvironment,
): { groups: CommandGroup[]; guidance: string[]; requiresManualDownload: boolean; unsupportedMessage?: string } => {
  const platform = normalizePlatform(environment.platform);
  const linuxPackageManager = normalizePackageManager(environment.linuxPackageManager);

  if (platform === "darwin" && mode === "docker-desktop-git") {
    if (!environment.homebrewAvailable) {
      return {
        groups: [],
        guidance: ["Homebrew was not detected. Install Homebrew or manually install Docker Desktop and Git, then refresh the terminal PATH."],
        requiresManualDownload: true,
      };
    }
    return {
      groups: [
        {
          id: "macos-docker-desktop",
          label: "Docker Desktop",
          dependencyIds: ["docker-cli", "docker-daemon"],
          commands: [{
            id: "brew-install-docker-desktop",
            groupId: "macos-docker-desktop",
            groupLabel: "Docker Desktop",
            label: "Install Docker Desktop with Homebrew",
            dependencyIds: ["docker-cli", "docker-daemon"],
            command: "brew",
            args: ["install", "--cask", "docker"],
            privileged: false,
            timeoutMs: INSTALL_TIMEOUT_MS,
          }],
        },
        {
          id: "macos-git",
          label: "Git",
          dependencyIds: ["git-cli"],
          commands: [{
            id: "brew-install-git",
            groupId: "macos-git",
            groupLabel: "Git",
            label: "Install Git with Homebrew",
            dependencyIds: ["git-cli"],
            command: "brew",
            args: ["install", "git"],
            privileged: false,
            timeoutMs: INSTALL_TIMEOUT_MS,
          }],
        },
      ],
      guidance: ["Open Docker Desktop after installation and rerun readiness checks after the daemon starts."],
      requiresManualDownload: false,
    };
  }

  if (platform === "darwin" && mode === "docker-engine-git") {
    return {
      groups: environment.homebrewAvailable
        ? [{
            id: "macos-git",
            label: "Git",
            dependencyIds: ["git-cli"],
            commands: [{
              id: "brew-install-git",
              groupId: "macos-git",
              groupLabel: "Git",
              label: "Install Git with Homebrew",
              dependencyIds: ["git-cli"],
              command: "brew",
              args: ["install", "git"],
              privileged: false,
              timeoutMs: INSTALL_TIMEOUT_MS,
            }],
          }]
        : [],
      guidance: [
        "Standalone Docker Engine on macOS needs a Linux VM. Use Docker Desktop unless you manage that VM yourself.",
        ...(environment.homebrewAvailable ? [] : ["Homebrew was not detected, so Git installation also requires manual setup."]),
      ],
      requiresManualDownload: true,
    };
  }

  if (platform === "win32" && mode === "docker-desktop-git") {
    if (!environment.wingetAvailable) {
      return {
        groups: [],
        guidance: ["winget was not detected. Install winget or manually install Docker Desktop and Git, then refresh the terminal PATH."],
        requiresManualDownload: true,
      };
    }
    return {
      groups: [
        {
          id: "windows-docker-desktop",
          label: "Docker Desktop",
          dependencyIds: ["docker-cli", "docker-daemon"],
          commands: [{
            id: "winget-install-docker-desktop",
            groupId: "windows-docker-desktop",
            groupLabel: "Docker Desktop",
            label: "Install Docker Desktop with winget",
            dependencyIds: ["docker-cli", "docker-daemon"],
            command: "winget",
            args: ["install", "--id", "Docker.DockerDesktop", "--exact", "--accept-package-agreements", "--accept-source-agreements"],
            privileged: false,
            timeoutMs: INSTALL_TIMEOUT_MS,
          }],
        },
        {
          id: "windows-git",
          label: "Git",
          dependencyIds: ["git-cli"],
          commands: [{
            id: "winget-install-git",
            groupId: "windows-git",
            groupLabel: "Git",
            label: "Install Git with winget",
            dependencyIds: ["git-cli"],
            command: "winget",
            args: ["install", "--id", "Git.Git", "--exact", "--accept-package-agreements", "--accept-source-agreements"],
            privileged: false,
            timeoutMs: INSTALL_TIMEOUT_MS,
          }],
        },
      ],
      guidance: ["Restart the terminal after installation and start Docker Desktop before rerunning readiness checks."],
      requiresManualDownload: false,
    };
  }

  if (platform === "win32" && mode === "docker-engine-git") {
    return {
      groups: environment.wingetAvailable
        ? [{
            id: "windows-git",
            label: "Git",
            dependencyIds: ["git-cli"],
            commands: [{
              id: "winget-install-git",
              groupId: "windows-git",
              groupLabel: "Git",
              label: "Install Git with winget",
              dependencyIds: ["git-cli"],
              command: "winget",
              args: ["install", "--id", "Git.Git", "--exact", "--accept-package-agreements", "--accept-source-agreements"],
              privileged: false,
              timeoutMs: INSTALL_TIMEOUT_MS,
            }],
          }]
        : [],
      guidance: [
        "Docker Engine on Windows should run through WSL or Docker Desktop. Use Docker Desktop with WSL integration unless you manage Docker Engine inside WSL.",
        ...(environment.wingetAvailable ? [] : ["winget was not detected, so Git installation also requires manual setup."]),
      ],
      requiresManualDownload: true,
    };
  }

  if (platform === "linux" && mode === "docker-engine-git") {
    if (!linuxPackageManager) {
      return {
        groups: [],
        guidance: ["No supported Linux package manager was detected. Install Docker Engine and Git manually, then rerun readiness checks."],
        requiresManualDownload: true,
      };
    }
    return {
      groups: [
        {
          id: "linux-engine-packages",
          label: "Docker Engine and Git packages",
          dependencyIds: ["docker-cli", "git-cli"],
          commands: linuxEnginePackageCommands(linuxPackageManager),
        },
        {
          id: "linux-docker-daemon",
          label: "Docker daemon",
          dependencyIds: ["docker-daemon"],
          commands: environment.systemctlAvailable
            ? [{
                id: "systemctl-enable-now-docker",
                groupId: "linux-docker-daemon",
                groupLabel: "Docker daemon",
                label: "Enable and start Docker daemon",
                dependencyIds: ["docker-daemon"],
                command: "systemctl",
                args: ["enable", "--now", "docker"],
                privileged: true,
                timeoutMs: SERVICE_TIMEOUT_MS,
              }]
            : [],
        },
      ],
      guidance: environment.systemctlAvailable
        ? ["If Docker commands still fail after installation, log out and back in after adding your user to the Docker group."]
        : ["systemctl was not detected. Start the Docker daemon with your distribution's service manager, then rerun readiness checks."],
      requiresManualDownload: false,
    };
  }

  if (platform === "linux" && mode === "docker-desktop-git") {
    if (!linuxPackageManager) {
      return {
        groups: [],
        guidance: [
          "No supported Linux package manager was detected for automated Git installation.",
          "Download Docker Desktop for Linux from Docker's official distro-specific packages and install Git manually.",
        ],
        requiresManualDownload: true,
      };
    }
    return {
      groups: [{
        id: "linux-git-package",
        label: "Git package",
        dependencyIds: ["git-cli"],
        commands: linuxGitPackageCommands(linuxPackageManager),
      }],
      guidance: ["Download Docker Desktop for Linux from Docker's official distro-specific packages, install it manually, then start the desktop app."],
      requiresManualDownload: true,
    };
  }

  return {
    groups: [],
    guidance: [`${platformLabel(platform)} does not support automated ${mode} installation in Code UX.`],
    requiresManualDownload: true,
    unsupportedMessage: "Automated onboarding dependency installation is not available for this platform and mode.",
  };
};

export const planOnboardingDependencyInstallCommands = (
  mode: OnboardingDependencyInstallMode,
  dependencies: OnboardingDependencyCheck[],
  environment: OnboardingInstallerEnvironment = {},
): CommandPlan => {
  const platform = normalizePlatform(environment.platform);
  const homebrewAvailable = environment.homebrewAvailable !== false;
  const wingetAvailable = environment.wingetAvailable !== false;
  const systemctlAvailable = environment.systemctlAvailable === true;
  const isRoot = environment.isRoot ?? (typeof process.getuid === "function" ? process.getuid() === 0 : platform === "win32" || platform === "darwin");
  const passwordlessSudoAvailable = environment.passwordlessSudoAvailable === true;

  if (!VALID_MODES.has(mode)) {
    return {
      platform,
      mode,
      commands: [],
      privilegeSkippedCommands: [],
      skippedDependencyGroups: [],
      requiresPrivilege: false,
      requiresManualDownload: true,
      postInstallGuidance: ["Unsupported installer mode requested. Choose one of the advertised onboarding installer options."],
      unsupported: true,
      unsupportedMessage: "Unsupported installer mode requested.",
    };
  }

  const planned = commandGroupsForMode(mode, {
    ...environment,
    platform,
    homebrewAvailable,
    wingetAvailable,
    systemctlAvailable,
  });
  const skippedDependencyGroups: OnboardingDependencyInstallerSkippedGroup[] = [];
  const commands: PlannedInstallerCommand[] = [];
  const privilegeSkippedCommands: PlannedInstallerCommand[] = [];

  for (const group of planned.groups) {
    if (areGroupDependenciesReady(dependencies, group.dependencyIds)) {
      skippedDependencyGroups.push({
        groupId: group.id,
        label: group.label,
        dependencyIds: group.dependencyIds,
        reason: `${group.label} is already reported ready by onboarding readiness checks.`,
      });
      continue;
    }

    if (group.commands.length === 0) {
      skippedDependencyGroups.push({
        groupId: group.id,
        label: group.label,
        dependencyIds: group.dependencyIds,
        reason: `${group.label} cannot be automated in this environment.`,
      });
      continue;
    }

    for (const command of group.commands) {
      const needsSudo = command.privileged && !isRoot;
      const runCommand = needsSudo ? "sudo" : command.command;
      const runArgs = needsSudo ? ["-n", command.command, ...command.args] : command.args;
      const plannedCommand: PlannedInstallerCommand = {
        ...command,
        displayCommand: formatDisplayCommand(runCommand, runArgs),
        runCommand,
        runArgs,
      };

      if (needsSudo && !passwordlessSudoAvailable) {
        privilegeSkippedCommands.push(plannedCommand);
      } else {
        commands.push(plannedCommand);
      }
    }
  }

  const requiresPrivilege = privilegeSkippedCommands.length > 0;
  return {
    platform,
    mode,
    commands,
    privilegeSkippedCommands,
    skippedDependencyGroups,
    requiresPrivilege,
    requiresManualDownload: planned.requiresManualDownload,
    postInstallGuidance: [
      ...planned.guidance,
      ...(requiresPrivilege ? ["Passwordless sudo is required for automated Linux package installation. Run the displayed commands in an elevated shell, then rerun readiness checks."] : []),
    ],
    unsupported: Boolean(planned.unsupportedMessage),
    unsupportedMessage: planned.unsupportedMessage,
  };
};

const getInstallerStatus = (
  plan: CommandPlan,
  commandResults: OnboardingDependencyInstallerCommandResult[],
): OnboardingDependencyInstallerResult["status"] => {
  if (plan.unsupported) {
    return "unsupported";
  }

  const executed = commandResults.filter((command) => command.status === "success" || command.status === "failed");
  const failed = commandResults.some((command) => command.status === "failed");
  const succeeded = commandResults.some((command) => command.status === "success");

  if (failed) {
    return succeeded || plan.requiresManualDownload || plan.requiresPrivilege ? "partial" : "failed";
  }

  if (plan.requiresManualDownload || plan.requiresPrivilege) {
    return "partial";
  }

  if (executed.length === 0) {
    return plan.skippedDependencyGroups.length > 0 ? "skipped" : "partial";
  }

  return "success";
};

const resultMessage = (status: OnboardingDependencyInstallerResult["status"]): string => {
  if (status === "success") return "Installer commands completed. Rerun readiness checks after refreshing the terminal or starting Docker if needed.";
  if (status === "skipped") return "Installer commands were skipped because the selected dependency groups are already ready.";
  if (status === "unsupported") return "The selected installer mode is not supported on this platform.";
  if (status === "failed") return "Installer commands failed. Review the bounded command summaries and follow the manual guidance.";
  return "Installer commands completed partially. Follow the remaining guidance, then rerun readiness checks.";
};

export const executeOnboardingDependencyInstall = async (
  input: ExecuteOnboardingDependencyInstallInput,
): Promise<OnboardingDependencyInstallerResult> => {
  const plan = planOnboardingDependencyInstallCommands(input.mode, input.dependencies, input.environment);
  const commandResults: OnboardingDependencyInstallerCommandResult[] = [
    ...plan.privilegeSkippedCommands.map((command) => commandResultFromSkipped(command, "Passwordless sudo is not available; command was not run to avoid an interactive password prompt.")),
  ];

  for (const command of plan.commands) {
    try {
      const result = await commandRunner.run(command.runCommand, command.runArgs, {
        cwd: process.cwd(),
        timeout: command.timeoutMs,
        maxStdoutChars: MAX_COMMAND_STDOUT_CHARS,
        maxStderrChars: MAX_COMMAND_STDERR_CHARS,
      });
      commandResults.push(commandResultFromExecution(command, result));
    } catch (error) {
      commandResults.push(commandResultFromThrownError(command, error));
    }
  }

  if (plan.commands.length > 0) {
    input.invalidateReadinessCache?.();
  }

  const failedDaemonStart = commandResults.find((command) => command.id === "systemctl-enable-now-docker" && command.status === "failed");
  const postInstallGuidance = [
    ...plan.postInstallGuidance,
    ...(failedDaemonStart ? ["Docker was installed but the daemon did not start through systemctl. Start Docker manually with your distribution's service manager, then rerun readiness checks."] : []),
  ];
  const status = getInstallerStatus({ ...plan, postInstallGuidance }, commandResults);

  return {
    mode: input.mode,
    platform: plan.platform,
    status,
    commands: commandResults,
    skippedDependencyGroups: plan.skippedDependencyGroups,
    requiresPrivilege: plan.requiresPrivilege,
    requiresManualDownload: plan.requiresManualDownload,
    postInstallGuidance,
    message: plan.unsupportedMessage ?? resultMessage(status),
  };
};
