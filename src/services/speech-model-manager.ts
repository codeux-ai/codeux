import * as fs from "fs";
import * as path from "path";
import { pipeline } from "stream/promises";
import { Readable } from "stream";
import { createHash } from "crypto";
import type { SpeechModelStatus } from "../contracts/speech-types.js";
import type { Logger } from "../shared/logging/logger.js";
import {
  getSpeechModelPaths,
  isSpeechModelAvailable,
  resolveSpeechModelEntry,
  SPEECH_MODEL_CATALOG,
} from "./speech-model-catalog.js";
import { assertModelLicenseAccepted } from "./model-license-policy.js";

interface DownloadState {
  controller: AbortController;
  progress: number;
  error: string | null;
}

export class SpeechModelManager {
  private readonly downloads = new Map<string, DownloadState>();
  private readonly errors = new Map<string, string>();

  constructor(
    private readonly logger: Logger,
    private readonly dataDir?: string,
  ) {}

  hasModel(modelId: string): boolean {
    return Object.hasOwn(SPEECH_MODEL_CATALOG, modelId);
  }

  validateDownloadAcceptance(modelId: string, acceptedLicenseId?: string): void {
    if (!this.hasModel(modelId)) throw new Error(`Unknown speech model: ${modelId}`);
    const model = resolveSpeechModelEntry(modelId);
    assertModelLicenseAccepted(model.license, model.id, acceptedLicenseId);
  }

  async listModels(): Promise<SpeechModelStatus[]> {
    return await Promise.all(Object.values(SPEECH_MODEL_CATALOG).map(async (model) => {
      const state = this.downloads.get(model.id);
      return {
        ...model,
        downloaded: await isSpeechModelAvailable(model.id, this.dataDir),
        downloading: Boolean(state),
        downloadProgress: state?.progress ?? 0,
        error: state?.error ?? this.errors.get(model.id) ?? null,
      };
    }));
  }

  async downloadModel(modelId: string, acceptedLicenseId?: string): Promise<void> {
    this.validateDownloadAcceptance(modelId, acceptedLicenseId);
    if (this.downloads.has(modelId)) throw new Error(`Download already in progress for ${modelId}`);

    const model = resolveSpeechModelEntry(modelId);
    this.errors.delete(modelId);
    const controller = new AbortController();
    const state: DownloadState = { controller, progress: 0, error: null };
    this.downloads.set(modelId, state);
    const { modelDir } = getSpeechModelPaths(modelId, this.dataDir);
    fs.mkdirSync(modelDir, { recursive: true });

    try {
      for (let index = 0; index < model.files.length; index += 1) {
        const modelFile = model.files[index]!;
        const destination = path.join(modelDir, modelFile.localName);
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        if (await this.isReusableFile(destination, modelFile.sha256)) {
          state.progress = Math.min(0.99, (index + 1) / model.files.length);
          continue;
        }
        const revision = model.revision ?? "main";
        const url = modelFile.downloadUrl ?? `https://huggingface.co/${model.repository}/resolve/${revision}/${modelFile.sourcePath}`;
        await this.downloadFile(url, destination, modelFile.sha256, controller.signal, (fileProgress) => {
          state.progress = Math.min(0.99, (index + fileProgress) / model.files.length);
        });
      }
      state.progress = 1;
      this.logger.info("Speech model downloaded", { modelId, modelDir });
    } catch (error) {
      state.error = error instanceof Error ? error.message : String(error);
      this.errors.set(modelId, state.error);
      this.logger.error("Speech model download failed", { modelId, error: state.error });
      throw error;
    } finally {
      this.downloads.delete(modelId);
    }
  }

  cancelDownload(modelId: string): void {
    this.downloads.get(modelId)?.controller.abort();
  }

  async deleteModel(modelId: string): Promise<void> {
    if (!this.hasModel(modelId)) throw new Error(`Unknown speech model: ${modelId}`);
    this.cancelDownload(modelId);
    this.errors.delete(modelId);
    const { modelDir } = getSpeechModelPaths(modelId, this.dataDir);
    await fs.promises.rm(modelDir, { recursive: true, force: true });
  }

  private async downloadFile(
    url: string,
    destination: string,
    sha256: string | undefined,
    signal: AbortSignal,
    onProgress: (progress: number) => void,
  ): Promise<void> {
    const response = await fetch(url, { signal, redirect: "follow" });
    if (!response.ok || !response.body) throw new Error(`HTTP ${response.status} downloading ${url}`);
    const total = Number(response.headers.get("content-length") || 0);
    let downloaded = 0;
    const temporary = `${destination}.part`;
    const writeStream = fs.createWriteStream(temporary);
    try {
      const source = Readable.fromWeb(response.body as import("stream/web").ReadableStream);
      source.on("data", (chunk: Buffer) => {
        downloaded += chunk.length;
        onProgress(total > 0 ? downloaded / total : 0.5);
      });
      await pipeline(source, writeStream);
      if (sha256) {
        const actual = await this.hashFile(temporary);
        if (actual !== sha256) throw new Error(`Integrity check failed downloading ${url}`);
      }
      await fs.promises.rename(temporary, destination);
    } catch (error) {
      writeStream.destroy();
      await fs.promises.rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  private async isReusableFile(destination: string, sha256?: string): Promise<boolean> {
    try {
      const stat = await fs.promises.stat(destination);
      if (!stat.isFile() || stat.size === 0) return false;
      return sha256 ? await this.hashFile(destination) === sha256 : true;
    } catch {
      return false;
    }
  }

  private async hashFile(filePath: string): Promise<string> {
    const hash = createHash("sha256");
    const stream = fs.createReadStream(filePath);
    for await (const chunk of stream) hash.update(chunk as Buffer);
    return hash.digest("hex");
  }
}
