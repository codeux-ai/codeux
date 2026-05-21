import axios from "axios";
import type { AxiosInstance } from "axios";
import type { JulesActivity, JulesSession, JulesSource } from "../contracts/app-types.js";
import type { JulesClient } from "../domain/jules/jules-client.js";

export interface JulesApiClientOptions {
  apiKey?: string | null;
  baseUrl: string;
}

export interface JulesPageRequest {
  page_size?: number;
  page_token?: string;
}

export interface JulesListSourcesRequest extends JulesPageRequest {
  filter?: string;
}

export interface JulesListSourcesResponse {
  sources?: JulesSource[];
  nextPageToken?: string;
}

export interface JulesListSessionsRequest extends JulesPageRequest {}

export interface JulesListSessionsResponse {
  sessions?: JulesSession[];
  nextPageToken?: string;
}

export interface JulesListActivitiesRequest extends JulesPageRequest {
  session_id: string;
}

export interface JulesListActivitiesResponse {
  activities?: JulesActivity[];
  nextPageToken?: string;
}

export interface JulesSourceContext {
  source: string;
  githubRepoContext?: {
    startingBranch?: string;
  };
}

export interface JulesCreateSessionRequest {
  prompt: string;
  sourceContext: JulesSourceContext;
  title?: string;
  requirePlanApproval?: boolean;
  automationMode?: string;
}

export interface JulesSessionActionResponse {
  id?: string;
  name?: string;
  state?: string;
  title?: string;
  createTime?: string;
  updateTime?: string;
  done?: boolean;
  message?: string;
  [key: string]: unknown;
}

interface JulesPageQuery {
  pageSize?: number;
  pageToken?: string;
}

interface JulesListSourcesQuery extends JulesPageQuery {
  filter?: string;
}

export class JulesApiClient implements JulesClient {
  private readonly axiosInstance: AxiosInstance;
  private apiKey: string | null;

  constructor(options: JulesApiClientOptions) {
    this.apiKey = this.normalizeApiKey(options.apiKey);
    this.axiosInstance = axios.create({
      baseURL: options.baseUrl,
      headers: {
        "Content-Type": "application/json",
      },
    });

    this.axiosInstance.interceptors.request.use((config) => {
      const headers = config.headers ?? {};
      if (this.apiKey) {
        headers["X-Goog-Api-Key"] = this.apiKey;
      } else {
        delete headers["X-Goog-Api-Key"];
      }
      config.headers = headers;
      return config;
    });

    const retryCounts = new WeakMap<object, number>();

    this.axiosInstance.interceptors.response.use(
      (response) => response,
      async (error) => {
        const config = error.config;
        if (!config) {
          return Promise.reject(error);
        }

        if (error.response && error.response.status === 429) {
          const retryCount = retryCounts.get(config) || 0;
          const maxRetries = 5;

          if (retryCount < maxRetries) {
            const nextCount = retryCount + 1;
            retryCounts.set(config, nextCount);

            // Exponential backoff: 1s, 2s, 4s, 8s, 16s with 0-500ms jitter
            const delay = Math.pow(2, nextCount - 1) * 1000 + Math.random() * 500;
            
            console.warn(`Jules API returned 429. Retrying request to ${config.url} (Attempt ${nextCount}/${maxRetries}) after ${Math.round(delay)}ms...`);

            await new Promise((resolve) => setTimeout(resolve, delay));
            
            return this.axiosInstance(config);
          }
        }

        return Promise.reject(error);
      }
    );

  }

  setApiKey(apiKey?: string | null): void {
    this.apiKey = this.normalizeApiKey(apiKey);
  }

  hasApiKey(): boolean {
    return this.apiKey !== null;
  }

  private ensureApiKey(): void {
    if (!this.hasApiKey()) {
      throw new Error("Jules API key is not configured.");
    }
  }

  private normalizeApiKey(apiKey?: string | null): string | null {
    if (typeof apiKey !== "string") {
      return null;
    }
    const trimmed = apiKey.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  normalizeName(type: string, id: string): string {
    if (id.startsWith(`${type}/`)) return id;
    return `${type}/${id}`;
  }

  private toSessionId(sessionNameOrId: string): string {
    return sessionNameOrId.replace(/^sessions\//, "");
  }

  private toSessionName(sessionNameOrId: string): string {
    return this.normalizeName("sessions", this.toSessionId(sessionNameOrId));
  }

  private toPageQuery(args: JulesPageRequest): JulesPageQuery {
    return {
      pageSize: args.page_size,
      pageToken: args.page_token,
    };
  }

  extractSessionId(session: Partial<JulesSession>): string | undefined {
    if (typeof session.id === "string" && session.id.length > 0) {
      return this.toSessionId(session.id);
    }
    if (typeof session.name === "string" && session.name.length > 0) {
      return this.toSessionId(session.name);
    }
    return undefined;
  }

  resolveSessionName(session: Partial<JulesSession>): string | undefined {
    if (typeof session.name === "string" && session.name.length > 0) {
      return this.toSessionName(session.name);
    }
    if (typeof session.id === "string" && session.id.length > 0) {
      return this.toSessionName(session.id);
    }
    return undefined;
  }

  async getSource(sourceId: string): Promise<JulesSource> {
    this.ensureApiKey();
    const response = await this.axiosInstance.get<JulesSource>(`/${this.normalizeName("sources", sourceId)}`);
    return response.data;
  }

  async listSources(args: JulesListSourcesRequest): Promise<JulesListSourcesResponse> {
    this.ensureApiKey();
    const params: JulesListSourcesQuery = { filter: args.filter, ...this.toPageQuery(args) };
    const response = await this.axiosInstance.get<JulesListSourcesResponse>("/sources", { params });
    return response.data;
  }

  async listAllSources(filter?: string): Promise<JulesSource[]> {
    this.ensureApiKey();
    let allSources: JulesSource[] = [];
    let pageToken: string | undefined = undefined;

    do {
      const params: JulesListSourcesQuery = { filter, pageToken };
      const response = await this.axiosInstance.get<JulesListSourcesResponse>("/sources", { params });
      allSources = allSources.concat(response.data.sources || []);
      pageToken = response.data.nextPageToken;
    } while (pageToken);

    return allSources;
  }

  async createSession(data: JulesCreateSessionRequest): Promise<JulesSession> {
    this.ensureApiKey();
    const response = await this.axiosInstance.post<JulesSession>("/sessions", data);
    return response.data;
  }

  async getSession(sessionId: string): Promise<JulesSession> {
    this.ensureApiKey();
    const name = this.toSessionName(sessionId);
    const response = await this.axiosInstance.get<JulesSession>(`/${name}`);
    return response.data;
  }

  async listSessions(args: JulesListSessionsRequest = {}): Promise<JulesListSessionsResponse> {
    this.ensureApiKey();
    const params: JulesPageQuery = this.toPageQuery(args);
    const response = await this.axiosInstance.get<JulesListSessionsResponse>("/sessions", { params });
    return response.data;
  }

  async approveSessionPlan(sessionId: string): Promise<JulesSessionActionResponse> {
    this.ensureApiKey();
    const name = this.toSessionName(sessionId);
    const response = await this.axiosInstance.post<JulesSessionActionResponse>(`/${name}:approvePlan`);
    return response.data;
  }

  async sendSessionMessage(sessionId: string, prompt: string): Promise<JulesSessionActionResponse> {
    this.ensureApiKey();
    const name = this.toSessionName(sessionId);
    const response = await this.axiosInstance.post<JulesSessionActionResponse>(`/${name}:sendMessage`, { prompt });
    return response.data;
  }

  async getActivity(sessionId: string, activityId: string): Promise<JulesActivity> {
    this.ensureApiKey();
    const sessionName = this.toSessionName(sessionId);
    const activityName = this.normalizeName("activities", activityId);
    const response = await this.axiosInstance.get<JulesActivity>(`/${sessionName}/${activityName}`);
    return response.data;
  }

  async listActivities(args: JulesListActivitiesRequest): Promise<JulesListActivitiesResponse> {
    this.ensureApiKey();
    const sessionName = this.toSessionName(args.session_id);
    const params: JulesPageQuery = this.toPageQuery(args);
    const response = await this.axiosInstance.get<JulesListActivitiesResponse>(`/${sessionName}/activities`, { params });
    return response.data;
  }

  async getFullConversation(sessionId: string): Promise<JulesActivity[]> {
    return this.listAllActivities(sessionId);
  }

  async listAllActivities(sessionId: string): Promise<JulesActivity[]> {
    this.ensureApiKey();
    const sessionName = this.toSessionName(sessionId);
    let allActivities: JulesActivity[] = [];
    let pageToken: string | undefined = undefined;

    do {
      const params: JulesPageQuery = { pageToken };
      const response = await this.axiosInstance.get<JulesListActivitiesResponse>(`/${sessionName}/activities`, { params });
      allActivities = allActivities.concat(response.data.activities || []);
      pageToken = response.data.nextPageToken;
    } while (pageToken);

    return allActivities;
  }

  async fetchRecentActivities(sessionName: string, pageSize: number): Promise<JulesActivity[]> {
    this.ensureApiKey();
    if (pageSize <= 0) {
      return [];
    }
    const normalizedSessionName = this.toSessionName(sessionName);
    let pageToken: string | undefined = undefined;
    let recentActivities: JulesActivity[] = [];

    do {
      const response: { data: JulesListActivitiesResponse } = await this.axiosInstance.get<JulesListActivitiesResponse>(`/${normalizedSessionName}/activities`, {
        params: { pageSize, pageToken },
      });
      const activities = response.data.activities || [];
      if (activities.length > 0) {
        recentActivities = recentActivities.concat(activities).slice(-pageSize);
      }
      pageToken = response.data.nextPageToken;
    } while (pageToken);

    const hydratedActivities = await Promise.all(
      recentActivities.map(async (activity) => {
        const activityId = this.extractActivityId(activity);
        if (!activityId) {
          return activity;
        }
        try {
          return await this.getActivity(normalizedSessionName, activityId);
        } catch {
          return activity;
        }
      })
    );

    return hydratedActivities.slice().sort((a, b) => {
      const left = new Date(a.createTime || 0).getTime();
      const right = new Date(b.createTime || 0).getTime();
      return left - right;
    });
  }

  private extractActivityId(activity: Pick<JulesActivity, "id" | "name">): string | null {
    const rawId = typeof activity.id === "string" && activity.id.trim().length > 0
      ? activity.id.trim()
      : typeof activity.name === "string" && activity.name.trim().length > 0
        ? activity.name.trim().split("/").pop() || ""
        : "";

    if (!rawId) {
      return null;
    }

    return rawId.split("/").pop() || null;
  }
}
