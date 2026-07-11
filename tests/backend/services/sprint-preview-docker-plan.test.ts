import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { buildSprintPreviewDockerCreateArgs } from "../../../src/services/sprint-preview-docker-plan.js";

describe("SprintPreviewDockerPlanBuilder", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.stubGlobal("process", {
      ...process,
      env: {},
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("builds the correct docker arguments", () => {
    const args = buildSprintPreviewDockerCreateArgs({
      projectId: "proj-1",
      sprintId: "sprint-1",
      sessionId: "session-1",
      containerName: "preview-proj-1-sprint-1",
      hostPort: 4444,
      containerAppPort: 3000,
      portMappings: [
        { containerPort: 3000, hostPort: 4444, isPrimary: true },
        { containerPort: 5173, hostPort: 4445 },
      ],
      containerWorkspacePath: "/workspace",
      containerRuntimeHome: "/home",
      volumeName: "my-volume",
      userSpec: "1000:1000",
      setupScriptSource: "/path/to/setup.sh",
      shouldRunSetupScriptAtRuntime: true,
      containerGitUserName: "test",
      containerGitUserEmail: "test@example.com",
      credentialMounts: [{ type: "bind", source: "/host/cred", destination: "/container/cred", readonly: true }],
      effectiveInstallCommand: "npm install",
      buildCommand: "npm run build",
      runCommand: "npm start",
      sourceCommit: "abc1234",
      resolvedImage: "node:18",
      bootstrapScript: "echo 'bootstrap'",
    });

    expect(args).toContain("--name");
    expect(args).toContain("preview-proj-1-sprint-1");
    expect(args).toContain("-p");
    expect(args).toContain("127.0.0.1:4444:39000");
    expect(args).toContain("127.0.0.1:4445:5173");
    expect(args).toEqual(expect.arrayContaining([
      "--network",
      "bridge",
      "--security-opt",
      "no-new-privileges",
      "--label",
      "code-ux.managed=true",
    ]));
    expect(args).not.toContain("0.0.0.0:4444:39000");
    expect(args).toContain("--workdir");
    expect(args).toContain("/workspace");
    expect(args).toContain("--label");
    expect(args).toContain("code-ux.preview=true");
    expect(args).toContain("code-ux.project-id=proj-1");
    expect(args).toContain("code-ux.sprint-id=sprint-1");
    expect(args).toContain("code-ux.session-id=session-1");
    expect(args).toContain("code-ux.host-port=4444");
    expect(args).toContain("code-ux.port-mappings=3000:4444,5173:4445");
    expect(args).toContain("PORT=3000");
    expect(args).toContain("DASHBOARD_PORT=3000");
    expect(args).toContain("SPRINT_PREVIEW_PORT=3000");
    expect(args).toContain("SPRINT_PREVIEW_PRIMARY_CONTAINER_PORT=3000");
    expect(args).toContain("SPRINT_PREVIEW_PRIMARY_HOST_PORT=4444");
    expect(args).toContain("SPRINT_PREVIEW_CONTAINER_PORTS=3000,5173");
    expect(args).toContain("SPRINT_PREVIEW_HOST_PORTS=4444,4445");
    expect(args).toContain("SPRINT_PREVIEW_PORT_MAPPINGS=3000:4444,5173:4445");
    expect(args).toContain("--user");
    expect(args).toContain("1000:1000");
    expect(args).toContain("node:18");
    expect(args).toContain("preview-runner");
  });

  it("adds env-file by path without expanding secret variables into docker args", () => {
    const args = buildSprintPreviewDockerCreateArgs({
      projectId: "proj-1",
      sprintId: "sprint-1",
      sessionId: "session-1",
      containerName: "preview-proj-1-sprint-1",
      hostPort: 4444,
      containerAppPort: 3000,
      containerWorkspacePath: "/workspace",
      containerRuntimeHome: "/home",
      volumeName: "my-volume",
      userSpec: null,
      setupScriptSource: null,
      shouldRunSetupScriptAtRuntime: false,
      containerGitUserName: "test",
      containerGitUserEmail: "test@example.com",
      credentialMounts: [],
      effectiveInstallCommand: null,
      buildCommand: null,
      runCommand: "npm start",
      sourceCommit: null,
      envFileSource: "/tmp/provider.env",
      resolvedImage: "node:18",
      bootstrapScript: "echo 'bootstrap'",
    });

    expect(args).toContain("--env-file");
    expect(args[args.indexOf("--env-file") + 1]).toBe("/tmp/provider.env");
    expect(args.some((arg) => arg.includes("GEMINI_API_KEY="))).toBe(false);
  });

  it("mounts the Docker socket and CLI only when explicitly enabled", () => {
    const args = buildSprintPreviewDockerCreateArgs({
      projectId: "proj-1",
      sprintId: "sprint-1",
      sessionId: "session-1",
      containerName: "preview-proj-1-sprint-1",
      hostPort: 4444,
      containerAppPort: 3000,
      containerWorkspacePath: "/workspace",
      containerRuntimeHome: "/home",
      volumeName: "my-volume",
      userSpec: "1000:1000",
      setupScriptSource: null,
      shouldRunSetupScriptAtRuntime: false,
      containerGitUserName: "test",
      containerGitUserEmail: "test@example.com",
      credentialMounts: [],
      effectiveInstallCommand: null,
      buildCommand: null,
      runCommand: "npm start",
      sourceCommit: null,
      resolvedImage: "node:18",
      bootstrapScript: "echo bootstrap",
      dockerAccess: {
        socketSource: "/run/user/1000/docker.sock",
        socketGid: 1001,
        cliSource: "/usr/bin/docker",
        composePluginSource: "/usr/libexec/docker/cli-plugins/docker-compose",
      },
    });

    expect(args).toEqual(expect.arrayContaining([
      "--group-add",
      "1001",
      "DOCKER_HOST=unix:///var/run/docker.sock",
    ]));
    expect(args.some((arg) => arg.includes("source=/run/user/1000/docker.sock") && arg.includes("target=/var/run/docker.sock"))).toBe(true);
    expect(args.some((arg) => arg.includes("source=/usr/bin/docker") && arg.includes("target=/usr/local/bin/docker"))).toBe(true);
    expect(args.some((arg) => arg.includes("source=/usr/libexec/docker/cli-plugins/docker-compose") && arg.includes("target=/usr/local/lib/docker/cli-plugins/docker-compose"))).toBe(true);
    expect(args.at(-1)).toContain("docker version");
    expect(args.at(-1)).toContain("docker compose version");
  });

  it("matches snapshot", () => {
    const args = buildSprintPreviewDockerCreateArgs({
      projectId: "proj-1",
      sprintId: "sprint-1",
      sessionId: "session-1",
      containerName: "preview-proj-1-sprint-1",
      hostPort: 4444,
      containerAppPort: 3000,
      portMappings: [
        { containerPort: 3000, hostPort: 4444, isPrimary: true },
        { containerPort: 5173, hostPort: 4445 },
      ],
      containerWorkspacePath: "/workspace",
      containerRuntimeHome: "/home",
      volumeName: "my-volume",
      userSpec: "1000:1000",
      setupScriptSource: "/path/to/setup.sh",
      shouldRunSetupScriptAtRuntime: true,
      containerGitUserName: "test",
      containerGitUserEmail: "test@example.com",
      credentialMounts: [{ type: "bind", source: "/host/cred", destination: "/container/cred", readonly: true }],
      effectiveInstallCommand: "npm install",
      buildCommand: "npm run build",
      runCommand: "npm start",
      sourceCommit: "abc1234",
      resolvedImage: "node:18",
      bootstrapScript: "echo 'bootstrap'",
    });

    expect(args).toMatchSnapshot();
  });
});
