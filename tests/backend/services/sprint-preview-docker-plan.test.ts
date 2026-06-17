import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { buildSprintPreviewDockerCreateArgs } from "../../../src/services/sprint-preview-docker-plan.js";

describe("SprintPreviewDockerPlanBuilder", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.stubGlobal("process", {
      ...process,
      env: {
        ...originalEnv,
        GITHUB_TOKEN: undefined,
        GH_TOKEN: undefined,
        GEMINI_CLI_TRUST_WORKSPACE: undefined,
      },
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
      resolvedImage: "node:18",
      bootstrapScript: "echo 'bootstrap'",
    });

    expect(args).toContain("--name");
    expect(args).toContain("preview-proj-1-sprint-1");
    expect(args).toContain("-p");
    expect(args).toContain("127.0.0.1:4444:39000");
    expect(args).toContain("--workdir");
    expect(args).toContain("/workspace");
    expect(args).toContain("--label");
    expect(args).toContain("code-ux.preview=true");
    expect(args).toContain("code-ux.project-id=proj-1");
    expect(args).toContain("code-ux.sprint-id=sprint-1");
    expect(args).toContain("code-ux.session-id=session-1");
    expect(args).toContain("code-ux.host-port=4444");
    expect(args).toContain("--user");
    expect(args).toContain("1000:1000");
    expect(args).toContain("node:18");
    expect(args).toContain("preview-runner");
  });

  it("matches snapshot", () => {
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
      setupScriptSource: "/path/to/setup.sh",
      shouldRunSetupScriptAtRuntime: true,
      containerGitUserName: "test",
      containerGitUserEmail: "test@example.com",
      credentialMounts: [{ type: "bind", source: "/host/cred", destination: "/container/cred", readonly: true }],
      effectiveInstallCommand: "npm install",
      buildCommand: "npm run build",
      runCommand: "npm start",
      resolvedImage: "node:18",
      bootstrapScript: "echo 'bootstrap'",
    });

    expect(args).toMatchSnapshot();
  });
});
