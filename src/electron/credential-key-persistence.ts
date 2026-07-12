import { link, mkdir, open, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import type { ProtectedKeyPersistence } from "../infrastructure/security/electron-safe-storage-key-provider.js";

/** Persists only the OS-encrypted root-key blob; plaintext key bytes never reach this boundary. */
export class ElectronCredentialKeyPersistence implements ProtectedKeyPersistence {
  constructor(private readonly filePath: string) {}

  async read(): Promise<Buffer | null> {
    let handle;
    try {
      handle = await open(this.filePath, "r");
      const info = await handle.stat();
      if (!info.isFile()) throw new Error("Protected credential key path must resolve to a regular file.");
      if ((info.mode & 0o077) !== 0) throw new Error("Protected credential key file must use owner-only permissions.");
      if (info.size > 64 * 1024) throw new Error("Protected credential key file is unexpectedly large.");
      return await handle.readFile();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    } finally {
      await handle?.close().catch(() => undefined);
    }
  }

  async writeIfAbsent(value: Buffer): Promise<boolean> {
    await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`;
    try {
      const handle = await open(temporaryPath, "wx", 0o600);
      try {
        await handle.writeFile(value);
        await handle.sync();
      } finally {
        await handle.close();
      }
      try {
        await link(temporaryPath, this.filePath);
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
        throw error;
      }
    } catch (error) {
      throw error;
    } finally {
      await unlink(temporaryPath).catch(() => undefined);
    }
  }
}
