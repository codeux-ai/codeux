const fs = require('fs');

let code = fs.readFileSync('tests/backend/app/live/project-live-snapshot.test.ts', 'utf8');

code += `
  it("uses generic error message if gitStatus promise rejection is not an Error instance", async () => {
    deps.getGitStatus = vi.fn().mockRejectedValue("Not an error object");

    const snapshot = await getProjectLiveSnapshot(deps);

    expect(snapshot.gitStatus).toBeNull();
    expect(snapshot.gitStatusError).toBe("Unable to load git/ci/pr tracking.");
  });

  it("handles missing project array edge cases for execution item count", async () => {
    deps.getProjectExecutionSnapshot = vi.fn().mockReturnValue({
      sprintRuns: undefined,
      taskDispatches: undefined,
      connections: undefined,
      attentionItems: undefined,
      recentEvents: undefined,
      projectId: "proj-1"
    } as any);

    deps.projectRuntimeRepository.getProjectStatus = vi.fn().mockReturnValue({
      subtasks: undefined
    } as any);

    const snapshot = await getProjectLiveSnapshot(deps);

    expect(deps.logger.info).toHaveBeenCalledWith(
      "project_live_snapshot_assembled",
      expect.objectContaining({
        executionItemCount: 0,
        statusSubtaskCount: 0,
      })
    );
  });
`;

fs.writeFileSync('tests/backend/app/live/project-live-snapshot.test.ts', code);
