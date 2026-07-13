import { randomBytes, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { dirname } from "node:path";
import { link, lstat, mkdir, open, unlink, type FileHandle } from "node:fs/promises";
import type { CredentialBackendHealth } from "../../contracts/automation-credential-types.js";
import {
  KeyProviderUnavailableError,
  type KeyMaterial,
  type KeyProvider,
} from "../../services/credentials/key-provider.js";

const ROOT_KEY_BYTES = 32;
const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;
const UNSUPPORTED_FSYNC_ERROR_CODES = new Set(["EINVAL", "ENOTSUP", "EOPNOTSUPP", "EPERM", "EISDIR"]);

function unavailable(message: string): KeyProviderUnavailableError {
  return new KeyProviderUnavailableError(message);
}

class MissingLocalKeyError extends KeyProviderUnavailableError {}

function hasExpectedOwner(info: { uid: number }): boolean {
  return typeof process.getuid !== "function" || info.uid === process.getuid();
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

function alreadyExists(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "EEXIST";
}

async function syncWhereSupported(handle: FileHandle): Promise<void> {
  try {
    await handle.sync();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (!code || !UNSUPPORTED_FSYNC_ERROR_CODES.has(code)) throw error;
  }
}

/**
 * Persists a single raw 256-bit root key for the trusted, loopback dashboard runtime.
 * Selection policy is intentionally kept outside this filesystem boundary.
 */
export class LocalFileKeyProvider implements KeyProvider {
  readonly providerName = "local-file";

  constructor(
    private readonly filePath: string,
    private readonly keyId = "local-file-root",
    private readonly version = 1,
  ) {}

  async health(): Promise<CredentialBackendHealth> {
    try {
      const material = await this.getActiveKey();
      material.key.fill(0);
      return {
        available: true,
        secure: true,
        provider: this.providerName,
        keyId: this.keyId,
        keyVersion: this.version,
      };
    } catch (error) {
      return {
        available: false,
        secure: false,
        provider: this.providerName,
        keyId: null,
        keyVersion: null,
        reason: error instanceof Error ? error.message : "Local credential root-key custody is unavailable.",
      };
    }
  }

  async getActiveKey(): Promise<KeyMaterial> {
    await this.ensureParentDirectory();
    try {
      return await this.readKey();
    } catch (error) {
      if (!(error instanceof MissingLocalKeyError)) throw error;
    }

    await this.provision();
    return this.readKey();
  }

  async getKey(keyId: string, version: number): Promise<KeyMaterial> {
    if (keyId !== this.keyId || version !== this.version) {
      throw unavailable("Requested local credential root-key version is unavailable.");
    }
    return this.getActiveKey();
  }

  private async ensureParentDirectory(): Promise<void> {
    const parentPath = dirname(this.filePath);
    const codeUxHomePath = dirname(parentPath);
    try {
      await this.createDirectoryIfMissing(codeUxHomePath);
      await this.validateDirectory(codeUxHomePath, false);
      await this.createDirectoryIfMissing(parentPath);

      // Revalidate the complete custody chain after creation so lstat checks each
      // component itself instead of following an ancestor symlink implicitly.
      await this.validateDirectory(codeUxHomePath, false);
      await this.validateDirectory(parentPath, true);
    } catch (error) {
      if (error instanceof KeyProviderUnavailableError) throw error;
      throw unavailable("Local credential root-key directory is unavailable; ensure it is owner-controlled with 0700 permissions.");
    }
  }

  private async createDirectoryIfMissing(directoryPath: string): Promise<void> {
    try {
      await mkdir(directoryPath, { mode: DIRECTORY_MODE });
    } catch (error) {
      if (!alreadyExists(error)) throw error;
    }
  }

  private async validateDirectory(directoryPath: string, requireOwnerOnlyMode: boolean): Promise<void> {
    const info = await lstat(directoryPath);
    if (info.isSymbolicLink()) {
      throw unavailable("Local credential root-key directory chain must not contain a symbolic link.");
    }
    if (!info.isDirectory()) {
      throw unavailable("Local credential root-key directory chain must contain directories only.");
    }
    if (!hasExpectedOwner(info)) {
      throw unavailable("Local credential root-key directory chain must be owned by the current user.");
    }
    if (requireOwnerOnlyMode && (info.mode & 0o777) !== DIRECTORY_MODE) {
      throw unavailable("Local credential root-key directory must use owner-only permissions (0700).");
    }
  }

  private async readKey(): Promise<KeyMaterial> {
    let pathInfo;
    try {
      pathInfo = await lstat(this.filePath);
    } catch (error) {
      if (isMissing(error)) {
        throw new MissingLocalKeyError("Local credential root key has not been provisioned.");
      }
      throw unavailable("Local credential root-key file is unavailable.");
    }

    if (pathInfo.isSymbolicLink()) {
      throw unavailable("Local credential root-key path must not be a symbolic link.");
    }
    if (!pathInfo.isFile()) {
      throw unavailable("Local credential root-key path must resolve to a regular file.");
    }
    if ((pathInfo.mode & 0o777) !== FILE_MODE) {
      throw unavailable("Local credential root-key file must use owner-only permissions (0600).");
    }
    if (!hasExpectedOwner(pathInfo)) {
      throw unavailable("Local credential root-key file must be owned by the current user.");
    }
    if (pathInfo.size !== ROOT_KEY_BYTES) {
      throw unavailable("Local credential root-key file is malformed; restore the original 32-byte key or configure another secure provider.");
    }

    let handle: FileHandle | undefined;
    try {
      handle = await open(this.filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
      const openInfo = await handle.stat();
      if (!openInfo.isFile() || openInfo.dev !== pathInfo.dev || openInfo.ino !== pathInfo.ino) {
        throw unavailable("Local credential root-key file changed during validation.");
      }
      if ((openInfo.mode & 0o777) !== FILE_MODE || !hasExpectedOwner(openInfo) || openInfo.size !== ROOT_KEY_BYTES) {
        throw unavailable("Local credential root-key file security changed during validation.");
      }
      const key = await handle.readFile();
      if (key.length !== ROOT_KEY_BYTES) {
        key.fill(0);
        throw unavailable("Local credential root-key file is malformed; restore the original 32-byte key or configure another secure provider.");
      }
      return { key, keyId: this.keyId, version: this.version };
    } catch (error) {
      if (error instanceof KeyProviderUnavailableError) throw error;
      throw unavailable("Local credential root-key file is unavailable.");
    } finally {
      await handle?.close().catch(() => undefined);
    }
  }

  private async provision(): Promise<void> {
    const generated = randomBytes(ROOT_KEY_BYTES);
    const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`;
    let temporaryHandle: FileHandle | undefined;
    let installed = false;
    try {
      temporaryHandle = await open(
        temporaryPath,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        FILE_MODE,
      );
      await temporaryHandle.writeFile(generated);
      await syncWhereSupported(temporaryHandle);
      await temporaryHandle.close();
      temporaryHandle = undefined;

      try {
        await link(temporaryPath, this.filePath);
        installed = true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }

      if (installed) await this.syncParentDirectory();
    } catch (error) {
      if (error instanceof KeyProviderUnavailableError) throw error;
      throw unavailable("Local credential root key could not be provisioned; check owner-only access to the Code UX security directory.");
    } finally {
      generated.fill(0);
      await temporaryHandle?.close().catch(() => undefined);
      await unlink(temporaryPath).catch(() => undefined);
    }
  }

  private async syncParentDirectory(): Promise<void> {
    let directoryHandle: FileHandle | undefined;
    try {
      directoryHandle = await open(dirname(this.filePath), constants.O_RDONLY);
      await syncWhereSupported(directoryHandle);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (!code || !UNSUPPORTED_FSYNC_ERROR_CODES.has(code)) throw error;
    } finally {
      await directoryHandle?.close().catch(() => undefined);
    }
  }
}
