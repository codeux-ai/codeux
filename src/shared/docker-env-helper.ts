import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

/**
 * Detects if the current active Docker context is unreachable and resolves it using
 * platform-specific default fallbacks if available (e.g., named pipe resolution on Windows).
 * 
 * This helper is fully compatible across all platforms:
 * - On Windows (win32): Resolves active vs default named pipe mismatches if the active context is broken.
 * - On macOS (darwin) & Linux: Returns immediately with no action, allowing standard Unix socket 
 *   resolution to function natively.
 */
export async function fixDockerHostEnvironment(): Promise<void> {
  if (process.platform !== "win32") {
    // Standard Unix socket resolution works natively on macOS and Linux; no Named Pipe fallback needed.
    return;
  }

  if (process.env.DOCKER_HOST) {
    // Respect explicitly set DOCKER_HOST in system environment or .env file
    return;
  }

  try {
    // Test if the current active Docker context on Windows is responsive
    await execAsync("docker ps -q");
  } catch (error) {
    // The active context failed (e.g., dockerDesktopLinuxEngine named pipe not found).
    // Test if the default Windows Docker engine named pipe is responsive instead.
    const defaultPipe = "npipe:////./pipe/docker_engine";
    try {
      await execAsync(`docker -H ${defaultPipe} ps -q`);
      // It succeeded! Override DOCKER_HOST to use the working pipe.
      process.env.DOCKER_HOST = defaultPipe;
      console.log(`[Docker Setup] Windows active Docker context is unreachable. Auto-fallback to: ${defaultPipe}`);
    } catch (fallbackError) {
      // Both failed, which means Docker daemon is probably not running at all.
      // Leave DOCKER_HOST alone so standard errors/warnings are reported.
    }
  }
}
