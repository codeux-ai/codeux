import { createHash } from "node:crypto";
import * as os from "node:os";
import * as path from "node:path";

/** Docker label used to keep assets from independent Code UX runtimes isolated. */
export const RUNTIME_OWNER_LABEL = "code-ux.runtime-owner";

let cachedOwnerId: string | null = null;

/**
 * Stable identity for the current Code UX state directory. Test/pentest runtimes use an isolated
 * HOME, so their Docker cleanup must never remove assets owned by the user's live runtime.
 */
export function getRuntimeOwnerId(): string {
  if (cachedOwnerId) {
    return cachedOwnerId;
  }
  const resolvedHome = path.resolve(os.homedir(), ".code-ux").replace(/\\/g, "/");
  const canonicalHome = process.platform === "win32" ? resolvedHome.toLowerCase() : resolvedHome;
  cachedOwnerId = createHash("sha256").update(canonicalHome).digest("hex").slice(0, 24);
  return cachedOwnerId;
}

export function getRuntimeOwnerLabel(): string {
  return `${RUNTIME_OWNER_LABEL}=${getRuntimeOwnerId()}`;
}

export function getRuntimeOwnerDockerArgs(): string[] {
  return ["--label", getRuntimeOwnerLabel()];
}
