import * as fs from "fs";
import * as path from "path";
import { pipeline } from "stream/promises";
import { Writable } from "stream";
import type { CustomEmbeddingModelDefinition, EmbeddingModelId, EmbeddingModelInfo, EmbeddingModelStatus } from "../contracts/memory-types.js";
import {
  getEmbeddingModelCatalog,
  getEmbeddingModelInfo,
  getModelDownloadUrl,
} from "./embedding-model-catalog.js";
import { EmbeddingService } from "./embedding-service.js";
import { MemoryRepository } from "../repositories/memory-repository.js";
import type { SettingsRepository } from "../repositories/settings-repository.js";
import type { Logger } from "../shared/logging/logger.js";
import { assertModelLicenseAccepted } from "./model-license-policy.js";

export class EmbeddingModelManager {
  private readonly activeDownloads = new Map<string, AbortController>();
  private readonly embeddingService: EmbeddingService;
  private readonly memoryRepository: MemoryRepository;
  private readonly settingsRepository: SettingsRepository | null;
  private readonly logger: Logger;

  constructor(
    embeddingService: EmbeddingService,
    memoryRepository: MemoryRepository,
    logger: Logger,
    settingsRepository?: SettingsRepository,
  ) {
    this.embeddingService = embeddingService;
    this.memoryRepository = memoryRepository;
    this.logger = logger;
    this.settingsRepository = settingsRepository ?? null;
  }

  async downloadModel(
    modelId: EmbeddingModelId,
    acceptedLicenseId?: string,
    onProgress?: (progress: number) => void,
  ): Promise<void> {
    if (this.activeDownloads.has(modelId)) {
      throw new Error(`Download already in progress for ${modelId}`);
    }

    const customModels = this.getCustomModels();
    const catalog = getEmbeddingModelInfo(modelId, customModels);
    if (!catalog) {
      throw new Error(`Unknown model: ${modelId}`);
    }
    assertModelLicenseAccepted(catalog.license, modelId, acceptedLicenseId);

    const controller = new AbortController();
    this.activeDownloads.set(modelId, controller);

    const modelDir = this.embeddingService.getModelPath(modelId);
    fs.mkdirSync(modelDir, { recursive: true });

    this.memoryRepository.upsertModelStatus(modelId, {
      downloading: true,
      downloadProgress: 0,
      error: null,
    });

    try {
      let completedBytes = 0;
      const totalFiles = catalog.files.length;

      for (let i = 0; i < totalFiles; i++) {
        const fileName = catalog.files[i];
        const url = getModelDownloadUrl(modelId, fileName, customModels);
        const destPath = path.join(modelDir, fileName);

        this.logger.info(`Downloading ${fileName} for ${modelId}...`);

        await this.downloadFile(url, destPath, controller.signal, (bytes) => {
          completedBytes = bytes;
          const fileProgress = (i + (bytes > 0 ? 0.5 : 0)) / totalFiles;
          const progress = Math.min(0.99, fileProgress);
          onProgress?.(progress);
          this.memoryRepository.upsertModelStatus(modelId, {
            downloading: true,
            downloadProgress: progress,
          });
        });

        if (controller.signal.aborted) {
          throw new Error("Download cancelled");
        }
      }

      this.memoryRepository.upsertModelStatus(modelId, {
        downloaded: true,
        downloading: false,
        downloadProgress: 1,
        localPath: modelDir,
        error: null,
      });

      onProgress?.(1);
      this.logger.info(`Model ${modelId} downloaded successfully to ${modelDir}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message !== "Download cancelled") {
        this.memoryRepository.upsertModelStatus(modelId, {
          downloaded: false,
          downloading: false,
          downloadProgress: 0,
          error: message,
        });
        this.logger.error(`Failed to download model ${modelId}: ${message}`);
      }
      throw error;
    } finally {
      this.activeDownloads.delete(modelId);
    }
  }

  validateDownloadAcceptance(modelId: EmbeddingModelId, acceptedLicenseId?: string): void {
    const catalog = getEmbeddingModelInfo(modelId, this.getCustomModels());
    if (!catalog) throw new Error(`Unknown model: ${modelId}`);
    assertModelLicenseAccepted(catalog.license, modelId, acceptedLicenseId);
  }

  cancelDownload(modelId: EmbeddingModelId): void {
    const controller = this.activeDownloads.get(modelId);
    if (controller) {
      controller.abort();
      this.activeDownloads.delete(modelId);
      this.memoryRepository.upsertModelStatus(modelId, {
        downloading: false,
        downloadProgress: 0,
        error: "Download cancelled",
      });
    }
  }

  async selectModel(modelId: EmbeddingModelId): Promise<void> {
    const catalog = this.requireModel(modelId);
    if (catalog.source === "custom" && !this.areCatalogFilesDownloaded(modelId, catalog)) {
      throw new Error(`Model ${modelId} is not downloaded. Download it first.`);
    }
    if (!this.embeddingService.isModelDownloaded(modelId)) {
      throw new Error(`Model ${modelId} is not downloaded. Download it first.`);
    }

    await this.embeddingService.loadModel(modelId, catalog);
    this.logger.info(`Embedding model switched to ${modelId}`);
  }

  async deleteModel(modelId: EmbeddingModelId): Promise<void> {
    const catalog = this.requireModel(modelId);
    if (this.embeddingService.getLoadedModelId() === modelId) {
      await this.embeddingService.unloadModel();
    }

    this.embeddingService.deleteModelFiles(modelId);
    this.memoryRepository.upsertModelStatus(modelId, {
      downloaded: false,
      downloading: false,
      downloadProgress: 0,
      localPath: null,
      error: null,
    });

    this.logger.info(`Model ${modelId} deleted`);

    if (catalog.source === "custom") {
      this.deleteCustomModelDefinition(modelId);
    }
  }

  async restorePreviousModel(): Promise<void> {
    const statuses = this.memoryRepository.listModelStatuses();
    const customModels = this.getCustomModels();
    const downloaded = statuses.filter((s) => (
      s.downloaded && !!s.localPath && getEmbeddingModelInfo(s.id, customModels) !== null
    ));

    for (const status of downloaded) {
      if (this.embeddingService.isModelDownloaded(status.id)) {
        try {
          const catalog = this.requireModel(status.id);
          await this.embeddingService.loadModel(status.id, catalog);
          this.logger.info(`Auto-restored embedding model: ${status.id}`);
          return;
        } catch (error) {
          this.logger.warn(`Failed to auto-restore model ${status.id}: ${error}`);
        }
      }
    }
  }

  getStatuses(): EmbeddingModelStatus[] {
    const catalog = this.getCatalog();
    const dbStatuses = this.memoryRepository.listModelStatuses();
    const dbMap = new Map(dbStatuses.map((s) => [s.id, s]));

    return Object.keys(catalog).map((id) => {
      const modelId = id as EmbeddingModelId;
      const dbStatus = dbMap.get(modelId);
      if (dbStatus) return dbStatus;

      // Default status for models not yet in DB
      return {
        id: modelId,
        downloaded: this.embeddingService.isModelDownloaded(modelId),
        downloading: false,
        downloadProgress: 0,
        localPath: null,
        error: null,
      };
    });
  }

  getCatalog(): Record<EmbeddingModelId, EmbeddingModelInfo> {
    return getEmbeddingModelCatalog(this.getCustomModels());
  }

  hasModel(modelId: EmbeddingModelId): boolean {
    return getEmbeddingModelInfo(modelId, this.getCustomModels()) !== null;
  }

  getModelInfo(modelId: EmbeddingModelId): EmbeddingModelInfo | null {
    return getEmbeddingModelInfo(modelId, this.getCustomModels());
  }

  private requireModel(modelId: EmbeddingModelId): EmbeddingModelInfo {
    const catalog = this.getModelInfo(modelId);
    if (!catalog) {
      throw new Error(`Unknown model: ${modelId}`);
    }
    return catalog;
  }

  private getCustomModels(): CustomEmbeddingModelDefinition[] {
    return this.settingsRepository?.getSystemSettings().defaults.memory.customEmbeddingModels ?? [];
  }

  private deleteCustomModelDefinition(modelId: EmbeddingModelId): void {
    if (!this.settingsRepository) {
      return;
    }

    const systemSettings = this.settingsRepository.getSystemSettings();
    const customEmbeddingModels = systemSettings.defaults.memory.customEmbeddingModels.filter((model) => model.id !== modelId);
    this.settingsRepository.saveSystemSettings({
      ...systemSettings,
      defaults: {
        ...systemSettings.defaults,
        memory: {
          ...systemSettings.defaults.memory,
          customEmbeddingModels,
          embeddingModel: systemSettings.defaults.memory.embeddingModel === modelId
            ? null
            : systemSettings.defaults.memory.embeddingModel,
        },
      },
    });
  }

  private areCatalogFilesDownloaded(modelId: EmbeddingModelId, catalog: EmbeddingModelInfo): boolean {
    return catalog.files.every((fileName) => fs.existsSync(path.join(this.embeddingService.getModelPath(modelId), fileName)));
  }

  private async downloadFile(
    url: string,
    destPath: string,
    signal: AbortSignal,
    onProgress?: (downloadedBytes: number) => void,
  ): Promise<void> {
    const response = await fetch(url, { signal, redirect: "follow" });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} downloading ${url}`);
    }

    if (!response.body) {
      throw new Error(`No response body for ${url}`);
    }

    const writeStream = fs.createWriteStream(destPath);
    let downloaded = 0;

    const reader = response.body.getReader();
    const writable = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        downloaded += chunk.length;
        onProgress?.(downloaded);
        writeStream.write(chunk, callback);
      },
      final(callback) {
        writeStream.end(callback);
      },
    });

    try {
      const readable = new ReadableStream({
        async pull(controller) {
          const { done, value } = await reader.read();
          if (done) {
            controller.close();
          } else {
            controller.enqueue(value);
          }
        },
        cancel() {
          reader.cancel();
        },
      });

      // Convert Web ReadableStream to Node stream and pipe
      const { Readable } = await import("stream");
      const nodeReadable = Readable.fromWeb(readable as any);
      await pipeline(nodeReadable, writable);
    } catch (error) {
      // Clean up partial file on error
      writeStream.destroy();
      try { fs.unlinkSync(destPath); } catch { /* ignore */ }
      throw error;
    }
  }
}
