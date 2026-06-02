import { execFileSync } from "node:child_process";
import * as fs from "node:fs";

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

    const execOptions = { cwd: dirPath, stdio: "pipe" as const };

    // 1. Initialize the repository
    try {
      execFileSync("git", ["init", `--initial-branch=${defaultBranch}`], execOptions);
    } catch (error) {
      // Fallback for git versions < 2.28 which do not support --initial-branch
      execFileSync("git", ["init"], execOptions);
      execFileSync("git", ["checkout", "-b", defaultBranch], execOptions);
    }

    // 2. Configure local user for this repository only
    execFileSync("git", ["config", "user.email", "code-ux@local"], execOptions);
    execFileSync("git", ["config", "user.name", "Code UX"], execOptions);

    // 3. Create initial empty commit
    execFileSync("git", ["commit", "--allow-empty", "-m", "Initial commit"], execOptions);
  } catch (cause: any) {
    throw new Error(`Failed to initialize local repo at ${dirPath}: ${cause.message}`);
  }
}
