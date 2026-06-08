import * as fs from "node:fs";
import { runCommandStrict } from "../../services/cli-process-runner.js";

/**
 * Initializes a new local git repository at the specified path.
 * Sets up a default branch and creates an initial empty commit.
 *
 * @param dirPath - The absolute path where the repository should be initialized.
 * @param defaultBranch - The name of the initial branch (defaults to "main").
 */
export async function initLocalRepo(dirPath: string, defaultBranch = "main"): Promise<void> {
  try {
    fs.mkdirSync(dirPath, { recursive: true });

    // 1. Initialize the repository
    try {
      await runCommandStrict("git", ["init", `--initial-branch=${defaultBranch}`], dirPath);
    } catch (error) {
      // Fallback for git versions < 2.28 which do not support --initial-branch
      await runCommandStrict("git", ["init"], dirPath);
      await runCommandStrict("git", ["checkout", "-b", defaultBranch], dirPath);
    }

    // 2. Configure local user for this repository only
    await runCommandStrict("git", ["config", "user.email", "code-ux@local"], dirPath);
    await runCommandStrict("git", ["config", "user.name", "Code UX"], dirPath);

    // 3. Create initial empty commit
    await runCommandStrict("git", ["commit", "--allow-empty", "-m", "Initial commit"], dirPath);
  } catch (cause: any) {
    throw new Error(`Failed to initialize local repo at ${dirPath}: ${cause.message}`);
  }
}
