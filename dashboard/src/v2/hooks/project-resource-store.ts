import type { DashboardRealtimeServerMessage } from "../../types.js";
import { subscribeToDashboardRealtime } from "../../lib/realtime/dashboard-realtime-client.js";

type ResourceKey = string;
type SubscriberCallback<T> = (data: T, error: string | null, isLoading: boolean) => void;

interface StoreEntry<T> {
  data: T;
  error: string | null;
  isLoading: boolean;
  hasLoaded: boolean;
  promise: Promise<T> | null;
  subscribers: Set<SubscriberCallback<T>>;
  pollIntervalId?: number;
  unsubscribeRealtime?: () => void;
}

export interface ProjectResourceStoreOptions<T> {
  resourceType: string;
  fetcher: (projectId: string, args: any) => Promise<T>;
  isEqual: (current: T, next: T) => boolean;
  emptyData: T;
  getRealtimeScopes: (projectId: string) => string[];
  shouldRefreshOnRealtimeEvent: (message: DashboardRealtimeServerMessage) => boolean;
}

export class ProjectResourceStore<T> {
  private cache = new Map<ResourceKey, StoreEntry<T>>();
  private options: ProjectResourceStoreOptions<T>;

  constructor(options: ProjectResourceStoreOptions<T>) {
    this.options = options;
  }

  private getEntry(key: ResourceKey): StoreEntry<T> {
    let entry = this.cache.get(key);
    if (!entry) {
      entry = {
        data: this.options.emptyData,
        error: null,
        isLoading: false,
        hasLoaded: false,
        promise: null,
        subscribers: new Set(),
      };
      this.cache.set(key, entry);
    }
    return entry;
  }

  private notifySubscribers(entry: StoreEntry<T>) {
    for (const callback of entry.subscribers) {
      callback(entry.data, entry.error, entry.isLoading);
    }
  }

  public async fetch(
    projectId: string,
    keySuffix: string,
    args: any,
    options?: { silent?: boolean }
  ): Promise<void> {
    const key = `${this.options.resourceType}:${projectId}:${keySuffix}`;
    const entry = this.getEntry(key);

    if (entry.promise) {
      await entry.promise;
      return;
    }

    const silent = options?.silent ?? false;
    const shouldUseForegroundState = !silent && !entry.hasLoaded;

    if (shouldUseForegroundState) {
      entry.isLoading = true;
      this.notifySubscribers(entry);
    }

    entry.promise = this.options.fetcher(projectId, args);

    try {
      const result = await entry.promise;
      if (!this.options.isEqual(entry.data, result)) {
        entry.data = result;
      }
      entry.hasLoaded = true;
      entry.error = null;
    } catch (error) {
      entry.error = error instanceof Error ? error.message : String(error);
    } finally {
      entry.promise = null;
      if (shouldUseForegroundState) {
        entry.isLoading = false;
      }
      this.notifySubscribers(entry);
    }
  }

  public subscribe(
    projectId: string | null,
    keySuffix: string,
    args: any,
    callback: SubscriberCallback<T>,
    pollIntervalMs: number = 0
  ): () => void {
    if (!projectId) {
      callback(this.options.emptyData, null, false);
      return () => {};
    }

    const key = `${this.options.resourceType}:${projectId}:${keySuffix}`;
    const entry = this.getEntry(key);

    entry.subscribers.add(callback);

    if (entry.hasLoaded || entry.isLoading) {
      callback(entry.data, entry.error, entry.isLoading);
    }

    if (!entry.hasLoaded) {
      void this.fetch(projectId, keySuffix, args);
    }

    if (entry.subscribers.size === 1) {
      // Setup realtime subscription
      entry.unsubscribeRealtime = subscribeToDashboardRealtime(
        this.options.getRealtimeScopes(projectId),
        (message: DashboardRealtimeServerMessage) => {
          if (this.options.shouldRefreshOnRealtimeEvent(message)) {
            void this.fetch(projectId, keySuffix, args, { silent: true });
          }
        }
      );

      // Setup polling if requested
      if (pollIntervalMs > 0) {
        entry.pollIntervalId = window.setInterval(() => {
          void this.fetch(projectId, keySuffix, args, { silent: true });
        }, pollIntervalMs);
      }
    }

    return () => {
      entry.subscribers.delete(callback);
      if (entry.subscribers.size === 0) {
        if (entry.unsubscribeRealtime) {
          entry.unsubscribeRealtime();
          entry.unsubscribeRealtime = undefined;
        }
        if (entry.pollIntervalId) {
          window.clearInterval(entry.pollIntervalId);
          entry.pollIntervalId = undefined;
        }
        // Optionally clear cache if we want to drop data when unused
        // this.cache.delete(key);
      }
    };
  }

  public getCachedData(projectId: string, keySuffix: string): T {
    const key = `${this.options.resourceType}:${projectId}:${keySuffix}`;
    return this.getEntry(key).data;
  }
}
