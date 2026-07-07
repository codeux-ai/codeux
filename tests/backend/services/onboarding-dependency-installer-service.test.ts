import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OnboardingDependencyCheck } from "../../../src/contracts/app-types.js";

const run = vi.fn();

vi.mock("../../../src/shared/subprocess/command-runner.js", () => ({
  commandRunner: { run: (...a: unknown[]) => run(...a) },
}));

import {
  detectOnboardingInstallerEnvironment,
  executeOnboardingDependencyInstall,
  planOnboardingDependencyInstallCommands,
  planOnboardingDependencyInstallerOptions,
  type OnboardingInstallerEnvironment,
  type OnboardingLinuxPackageManager,
} from "../../../src/services/onboarding-dependency-installer-service.js";

const ok = (stdout = "ok") => ({ ok: true, code: 0, stdout, stderr: "" });
const fail = (stderr = "failed", stdout = "") => ({ ok: false, code: 1, stdout, stderr });

const dependency = (id: string, status: OnboardingDependencyCheck["status"]): OnboardingDependencyCheck => ({
  id,
  label: id,
  status,
  required: true,
  description: `${id} ${status}`,
  resolution: `Resolve ${id}`,
});

const deps = (statuses: Partial<Record<"docker-cli" | "docker-daemon" | "git-cli", OnboardingDependencyCheck["status"]>> = {}): OnboardingDependencyCheck[] => [
  dependency("docker-cli", statuses["docker-cli"] ?? "missing"),
  dependency("docker-daemon", statuses["docker-daemon"] ?? "missing"),
  dependency("git-cli", statuses["git-cli"] ?? "missing"),
];

beforeEach(() => {
  run.mockReset();
  run.mockResolvedValue(ok());
});

describe("planOnboardingDependencyInstallerOptions", () => {
  it("selects Docker Desktop as the recommended macOS and Windows mode", () => {
    const mac = planOnboardingDependencyInstallerOptions({ platform: "darwin", homebrewAvailable: true });
    const windows = planOnboardingDependencyInstallerOptions({ platform: "win32", wingetAvailable: true });

    expect(mac.recommendedMode).toBe("docker-desktop-git");
    expect(mac.options.find((option) => option.mode === "docker-desktop-git")?.automation).toBe("automated");
    expect(windows.recommendedMode).toBe("docker-desktop-git");
    expect(windows.options.find((option) => option.mode === "docker-desktop-git")?.automation).toBe("automated");
  });

  it("selects Docker Engine as the recommended Linux mode", () => {
    const linux = planOnboardingDependencyInstallerOptions({ platform: "linux", linuxPackageManager: "apt" });

    expect(linux.recommendedMode).toBe("docker-engine-git");
    expect(linux.options.find((option) => option.mode === "docker-engine-git")).toMatchObject({
      recommended: true,
      automation: "automated",
      requiresPrivilege: true,
      requiresManualDownload: false,
    });
  });

  it("marks unsupported platforms as unsupported with manual guidance", () => {
    const result = planOnboardingDependencyInstallerOptions({ platform: "freebsd" });

    expect(result.platform).toBe("unsupported");
    expect(result.recommendedMode).toBeNull();
    expect(result.options.every((option) => option.automation === "unsupported")).toBe(true);
    expect(result.options.every((option) => option.requiresManualDownload)).toBe(true);
  });
});

describe("detectOnboardingInstallerEnvironment", () => {
  it("detects Linux package manager and systemctl availability for installer metadata and execution", async () => {
    run.mockImplementation(async (command: string, args: string[]) => {
      if (command === "apt-get" && args[0] === "--version") return ok("apt 2");
      if (command === "systemctl" && args[0] === "--version") return ok("systemd 255");
      if (command === "sudo" && args.join(" ") === "-n true") return ok();
      return fail("missing");
    });

    const environment = await detectOnboardingInstallerEnvironment("linux");
    const metadata = planOnboardingDependencyInstallerOptions(environment);

    expect(environment).toMatchObject({
      platform: "linux",
      linuxPackageManager: "apt",
      systemctlAvailable: true,
    });
    expect(metadata.recommendedMode).toBe("docker-engine-git");
    expect(metadata.options.find((option) => option.mode === "docker-engine-git")).toMatchObject({
      automation: "automated",
      available: true,
      requiresManualDownload: false,
    });
  });

  it("marks macOS and Windows package-manager automation unavailable when tools are absent", async () => {
    run.mockResolvedValue(fail("missing"));

    const mac = planOnboardingDependencyInstallerOptions(await detectOnboardingInstallerEnvironment("darwin"));
    const windows = planOnboardingDependencyInstallerOptions(await detectOnboardingInstallerEnvironment("win32"));

    expect(mac.options.find((option) => option.mode === "docker-desktop-git")).toMatchObject({
      automation: "manual",
      available: false,
      requiresManualDownload: true,
    });
    expect(windows.options.find((option) => option.mode === "docker-desktop-git")).toMatchObject({
      automation: "manual",
      available: false,
      requiresManualDownload: true,
    });
  });
});

describe("executeOnboardingDependencyInstall", () => {
  it("runs the macOS Docker Desktop and Git Homebrew commands", async () => {
    const result = await executeOnboardingDependencyInstall({
      mode: "docker-desktop-git",
      dependencies: deps(),
      environment: { platform: "darwin", homebrewAvailable: true },
    });

    expect(result.status).toBe("success");
    expect(run.mock.calls.map(([cmd, args]) => [cmd, args])).toEqual([
      ["brew", ["install", "--cask", "docker"]],
      ["brew", ["install", "git"]],
    ]);
    expect(result.postInstallGuidance.join(" ")).toMatch(/Open Docker Desktop/);
  });

  it("runs exact Windows winget installs for Docker Desktop and Git", async () => {
    await executeOnboardingDependencyInstall({
      mode: "docker-desktop-git",
      dependencies: deps(),
      environment: { platform: "win32", wingetAvailable: true },
    });

    expect(run.mock.calls.map(([cmd, args]) => [cmd, args])).toEqual([
      ["winget", ["install", "--id", "Docker.DockerDesktop", "--exact", "--accept-package-agreements", "--accept-source-agreements"]],
      ["winget", ["install", "--id", "Git.Git", "--exact", "--accept-package-agreements", "--accept-source-agreements"]],
    ]);
  });

  it.each([
    ["apt", [
      ["apt-get", ["update"]],
      ["apt-get", ["install", "-y", "docker.io", "docker-compose-plugin", "git"]],
      ["systemctl", ["enable", "--now", "docker"]],
    ]],
    ["dnf", [
      ["dnf", ["install", "-y", "moby-engine", "docker-compose", "git"]],
      ["systemctl", ["enable", "--now", "docker"]],
    ]],
    ["yum", [
      ["yum", ["install", "-y", "docker", "git"]],
      ["systemctl", ["enable", "--now", "docker"]],
    ]],
    ["zypper", [
      ["zypper", ["--non-interactive", "install", "docker", "git"]],
      ["systemctl", ["enable", "--now", "docker"]],
    ]],
    ["pacman", [
      ["pacman", ["-Sy", "--noconfirm", "docker", "git"]],
      ["systemctl", ["enable", "--now", "docker"]],
    ]],
  ] satisfies Array<[OnboardingLinuxPackageManager, Array<[string, string[]]>]>)("plans Linux Engine commands for %s", (packageManager, expected) => {
    const plan = planOnboardingDependencyInstallCommands("docker-engine-git", deps(), {
      platform: "linux",
      linuxPackageManager: packageManager,
      isRoot: true,
      systemctlAvailable: true,
    });

    expect(plan.commands.map((command) => [command.runCommand, command.runArgs])).toEqual(expected);
  });

  it("prefixes privileged Linux commands with sudo -n for passwordless non-root installs", async () => {
    await executeOnboardingDependencyInstall({
      mode: "docker-engine-git",
      dependencies: deps(),
      environment: {
        platform: "linux",
        linuxPackageManager: "apt",
        isRoot: false,
        passwordlessSudoAvailable: true,
        systemctlAvailable: true,
      },
    });

    expect(run.mock.calls.map(([cmd, args]) => [cmd, args])).toEqual([
      ["sudo", ["-n", "apt-get", "update"]],
      ["sudo", ["-n", "apt-get", "install", "-y", "docker.io", "docker-compose-plugin", "git"]],
      ["sudo", ["-n", "systemctl", "enable", "--now", "docker"]],
    ]);
  });

  it("does not run privileged Linux commands when passwordless sudo is unavailable", async () => {
    const result = await executeOnboardingDependencyInstall({
      mode: "docker-engine-git",
      dependencies: deps(),
      environment: {
        platform: "linux",
        linuxPackageManager: "apt",
        isRoot: false,
        passwordlessSudoAvailable: false,
        systemctlAvailable: true,
      },
    });

    expect(run).not.toHaveBeenCalled();
    expect(result.status).toBe("partial");
    expect(result.requiresPrivilege).toBe(true);
    expect(result.commands.map((command) => command.status)).toEqual(["skipped", "skipped", "skipped"]);
    expect(result.commands[0].displayCommand).toBe("sudo -n apt-get update");
    expect(result.postInstallGuidance.join(" ")).toMatch(/Passwordless sudo/);
  });

  it("skips command groups whose dependencies are already ready", async () => {
    const result = await executeOnboardingDependencyInstall({
      mode: "docker-engine-git",
      dependencies: deps({ "docker-cli": "ready", "docker-daemon": "ready", "git-cli": "ready" }),
      environment: { platform: "linux", linuxPackageManager: "apt", isRoot: true, systemctlAvailable: true },
    });

    expect(run).not.toHaveBeenCalled();
    expect(result.status).toBe("skipped");
    expect(result.skippedDependencyGroups.map((group) => group.groupId)).toEqual(["linux-engine-packages", "linux-docker-daemon"]);
  });

  it("keeps installer commands inside the hardcoded whitelist", () => {
    const allowedCommands = new Set(["brew", "winget", "apt-get", "dnf", "yum", "zypper", "pacman", "systemctl", "sudo"]);
    const cases: Array<[OnboardingInstallerEnvironment["platform"], OnboardingLinuxPackageManager | null, OnboardingInstallerEnvironment]> = [
      ["darwin", null, { homebrewAvailable: true }],
      ["win32", null, { wingetAvailable: true }],
      ["linux", "apt", { isRoot: false, passwordlessSudoAvailable: true, systemctlAvailable: true }],
      ["linux", "dnf", { isRoot: true, systemctlAvailable: true }],
      ["linux", "yum", { isRoot: true, systemctlAvailable: true }],
      ["linux", "zypper", { isRoot: true, systemctlAvailable: true }],
      ["linux", "pacman", { isRoot: true, systemctlAvailable: true }],
    ];

    for (const [platform, packageManager, environment] of cases) {
      for (const mode of ["docker-desktop-git", "docker-engine-git"] as const) {
        const plan = planOnboardingDependencyInstallCommands(mode, deps(), {
          platform,
          linuxPackageManager: packageManager,
          ...environment,
        });
        for (const command of [...plan.commands, ...plan.privilegeSkippedCommands]) {
          expect(allowedCommands.has(command.runCommand)).toBe(true);
          expect(command.runArgs.some((arg) => /curl|sh\s|powershell|Invoke-WebRequest/i.test(arg))).toBe(false);
        }
      }
    }
  });

  it("bounds command output summaries and passes explicit timeouts and output limits", async () => {
    const longOutput = "x".repeat(2_000);
    run.mockResolvedValue(fail(longOutput, longOutput));

    const result = await executeOnboardingDependencyInstall({
      mode: "docker-desktop-git",
      dependencies: deps({ "docker-cli": "ready", "docker-daemon": "ready" }),
      environment: { platform: "darwin", homebrewAvailable: true },
    });

    expect(result.status).toBe("failed");
    expect(result.commands).toHaveLength(1);
    expect(result.commands[0].stdoutSummary.length).toBeLessThanOrEqual(1_203);
    expect(result.commands[0].stderrSummary.length).toBeLessThanOrEqual(1_203);
    expect(result.commands[0].stderrSummary.startsWith("...")).toBe(true);
    expect(result.commands[0].message).toBe("Command failed with exit code 1. Review bounded command summaries for details.");
    expect(result.commands[0].message).not.toContain(longOutput);
    expect(run).toHaveBeenCalledWith("brew", ["install", "git"], expect.objectContaining({
      timeout: 120_000,
      maxStdoutChars: 4_000,
      maxStderrChars: 4_000,
    }));
  });

  it("returns degraded macOS Engine guidance and only automates Git", async () => {
    const result = await executeOnboardingDependencyInstall({
      mode: "docker-engine-git",
      dependencies: deps(),
      environment: { platform: "darwin", homebrewAvailable: true },
    });

    expect(result.status).toBe("partial");
    expect(result.requiresManualDownload).toBe(true);
    expect(run.mock.calls.map(([cmd, args]) => [cmd, args])).toEqual([["brew", ["install", "git"]]]);
    expect(result.postInstallGuidance.join(" ")).toMatch(/Linux VM/);
  });

  it("returns degraded Linux Desktop guidance and only automates Git", async () => {
    const result = await executeOnboardingDependencyInstall({
      mode: "docker-desktop-git",
      dependencies: deps(),
      environment: { platform: "linux", linuxPackageManager: "apt", isRoot: true },
    });

    expect(result.status).toBe("partial");
    expect(result.requiresManualDownload).toBe(true);
    expect(run.mock.calls.map(([cmd, args]) => [cmd, args])).toEqual([
      ["apt-get", ["update"]],
      ["apt-get", ["install", "-y", "git"]],
    ]);
    expect(result.postInstallGuidance.join(" ")).toMatch(/Docker Desktop for Linux/);
  });

  it("returns manual guidance without running commands when package managers are missing", async () => {
    const linux = await executeOnboardingDependencyInstall({
      mode: "docker-engine-git",
      dependencies: deps(),
      environment: { platform: "linux", linuxPackageManager: null },
    });
    const mac = await executeOnboardingDependencyInstall({
      mode: "docker-desktop-git",
      dependencies: deps(),
      environment: { platform: "darwin", homebrewAvailable: false },
    });
    const windows = await executeOnboardingDependencyInstall({
      mode: "docker-desktop-git",
      dependencies: deps(),
      environment: { platform: "win32", wingetAvailable: false },
    });

    expect(run).not.toHaveBeenCalled();
    expect(linux.requiresManualDownload).toBe(true);
    expect(linux.postInstallGuidance.join(" ")).toMatch(/No supported Linux package manager/);
    expect(mac.postInstallGuidance.join(" ")).toMatch(/Homebrew was not detected/);
    expect(windows.postInstallGuidance.join(" ")).toMatch(/winget was not detected/);
  });

  it("returns structured command failure summaries and daemon start guidance", async () => {
    run.mockImplementation(async (cmd: string, args: string[]) => {
      if (cmd === "systemctl" && args[0] === "enable") {
        return fail("unit docker.service not found");
      }
      return ok();
    });

    const result = await executeOnboardingDependencyInstall({
      mode: "docker-engine-git",
      dependencies: deps(),
      environment: { platform: "linux", linuxPackageManager: "apt", isRoot: true, systemctlAvailable: true },
    });

    expect(result.status).toBe("partial");
    expect(result.commands.find((command) => command.id === "systemctl-enable-now-docker")).toMatchObject({
      status: "failed",
      stderrSummary: "unit docker.service not found",
      code: 1,
    });
    expect(result.postInstallGuidance.join(" ")).toMatch(/daemon did not start/);
  });

  it("invalidates readiness cache after an installer command is executed", async () => {
    const invalidateReadinessCache = vi.fn();

    await executeOnboardingDependencyInstall({
      mode: "docker-desktop-git",
      dependencies: deps({ "docker-cli": "ready", "docker-daemon": "ready" }),
      environment: { platform: "darwin", homebrewAvailable: true },
      invalidateReadinessCache,
    });

    expect(invalidateReadinessCache).toHaveBeenCalledTimes(1);
  });
});
