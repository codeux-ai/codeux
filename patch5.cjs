const fs = require('fs');

let code = fs.readFileSync('tests/backend/app/live/project-live-snapshot.test.ts', 'utf8');

code = code.replace(
  /it\("assembles full snapshot for a valid project", async \(\) => {/g,
  `it("assembles full snapshot for a valid project and logs structural counts", async () => {`
);

code = code.replace(
  /    expect\(deps\.getGitStatus\)\.toHaveBeenCalled\(\);\n  }\);/g,
  `    expect(deps.getGitStatus).toHaveBeenCalled();

    expect(deps.logger.info).toHaveBeenCalledWith(
      "project_live_snapshot_assembled",
      expect.objectContaining({
        projectId: "proj-1",
        executionItemCount: 0,
        statusSubtaskCount: 0,
        hasGitStatus: true,
      })
    );
  });`
);

fs.writeFileSync('tests/backend/app/live/project-live-snapshot.test.ts', code);
