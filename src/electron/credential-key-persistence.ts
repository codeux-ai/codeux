import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ProtectedKeyPersistence } from "../infrastructure/security/electron-safe-storage-key-provider.js";

/** Persists only the OS-encrypted root-key blob; plaintext key bytes never reach this boundary. */
export class ElectronCredentialKeyPersistence implements ProtectedKeyPersistence {
  constructor(private readonly filePath: string) {}

  async read(): Promise<Buffer | null> {
    try { return await readFile(this.filePath); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async write(value: Buffer): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    await writeFile(temporaryPath, value, { mode: 0o600 });
    await rename(temporaryPath, this.filePath);
  }
}
