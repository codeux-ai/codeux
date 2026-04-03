const fs = require('fs');

const path = 'src/app/live/project-live-snapshot.ts';
let code = fs.readFileSync(path, 'utf8');

code = code.replace(
  /  const tRuntime = Date\.now\(\);\n  const status = deps\.projectRuntimeRepository\.getProjectStatus\(projectId, selectedSprintId\);\n  const runtimeMs = Date\.now\(\) - tRuntime;\n\n  const tExecution = Date\.now\(\);\n  const execution = deps\.getProjectExecutionSnapshot\(projectId\);\n  const executionMs = Date\.now\(\) - tExecution;\n/,
  `  const fetchStatus = async () => {
    const t = Date.now();
    const result = deps.projectRuntimeRepository.getProjectStatus(projectId, selectedSprintId);
    return { result, ms: Date.now() - t };
  };

  const fetchExecution = async () => {
    const t = Date.now();
    const result = deps.getProjectExecutionSnapshot(projectId);
    return { result, ms: Date.now() - t };
  };
`
);

code = code.replace(
  /  let gitStatus: GitTrackingStatus \| null = null;\n  let gitStatusError: string \| null = null;\n  const tGit = Date\.now\(\);\n  try {\n    gitStatus = await deps\.getGitStatus\(\);\n  } catch \(error\) {\n    gitStatusError = error instanceof Error\n      \? error\.message\n      : "Unable to load git\/ci\/pr tracking\.";\n  }\n  const gitMs = Date\.now\(\) - tGit;\n/,
  `  const fetchGitStatus = async () => {
    const t = Date.now();
    try {
      const result = await deps.getGitStatus();
      return { result, error: null, ms: Date.now() - t };
    } catch (error) {
      return {
        result: null,
        error: error instanceof Error ? error.message : "Unable to load git/ci/pr tracking.",
        ms: Date.now() - t
      };
    }
  };

  const [statusData, executionData, gitData] = await Promise.all([
    fetchStatus(),
    fetchExecution(),
    fetchGitStatus(),
  ]);

  const status = statusData.result;
  const runtimeMs = statusData.ms;

  const execution = executionData.result;
  const executionMs = executionData.ms;

  const gitStatus = gitData.result;
  const gitStatusError = gitData.error;
  const gitMs = gitData.ms;
`
);

code = code.replace(
  /  const executionSizeBytes = Buffer\.byteLength\(JSON\.stringify\(execution\), "utf8"\);\n  const gitSizeBytes = gitStatus \? Buffer\.byteLength\(JSON\.stringify\(gitStatus\), "utf8"\) : 0;\n  const statusSizeBytes = Buffer\.byteLength\(JSON\.stringify\(status\), "utf8"\);\n/,
  `  const executionItemCount =
    execution.sprintRuns.length +
    execution.taskDispatches.length +
    execution.connections.length +
    execution.attentionItems.length +
    execution.recentEvents.length;
  const statusSubtaskCount = status.subtasks.length;
`
);

code = code.replace(
  /    executionSizeBytes,\n    gitSizeBytes,\n    statusSizeBytes,\n    payloadSizeBytes: Buffer\.byteLength\(JSON\.stringify\(snapshot\), "utf8"\),\n/,
  `    executionItemCount,
    statusSubtaskCount,
    hasGitStatus: !!gitStatus,
`
);

fs.writeFileSync(path, code);
