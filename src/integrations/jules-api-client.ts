import axios from "axios";
import type { AxiosInstance } from "axios";
import type { JulesActivity, JulesSession, JulesSource } from "../contracts/app-types.js";

export interface JulesApiClientOptions {
  apiKey?: string | null;
  baseUrl: string;
}

export class JulesApiClient {
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

  extractSessionId(session: Partial<JulesSession>): string | undefined {
    if (session.id) {
      return session.id.replace(/^sessions\//, "");
    }
    if (session.name && session.name.startsWith("sessions/")) {
      return session.name.replace(/^sessions\//, "");
    }
    return undefined;
  }

  resolveSessionName(session: Partial<JulesSession>): string | undefined {
    if (session.name && session.name.startsWith("sessions/")) {
      return session.name;
    }
    const sessionId = this.extractSessionId(session);
    return sessionId ? this.normalizeName("sessions", sessionId) : undefined;
  }

  async getSource(sourceId: string): Promise<unknown> {
    this.ensureApiKey();
    const response = await this.axiosInstance.get(`/${this.normalizeName("sources", sourceId)}`);
    return response.data;
  }

  async listSources(args: { filter?: string; page_size?: number; page_token?: string }): Promise<unknown> {
    this.ensureApiKey();
    const params: any = { filter: args.filter, pageSize: args.page_size, pageToken: args.page_token };
    const response = await this.axiosInstance.get("/sources", { params });
    return response.data;
  }

  async listAllSources(filter?: string): Promise<JulesSource[]> {
    this.ensureApiKey();
    let allSources: JulesSource[] = [];
    let pageToken: string | undefined = undefined;

    do {
      const params: any = { filter, pageToken };
      const response = await this.axiosInstance.get<{ sources?: JulesSource[]; nextPageToken?: string }>("/sources", { params });
      allSources = allSources.concat(response.data.sources || []);
      pageToken = response.data.nextPageToken;
    } while (pageToken);

    return allSources;
  }

  async createSession(data: any): Promise<JulesSession> {
    this.ensureApiKey();
    const response = await this.axiosInstance.post<JulesSession>("/sessions", data);
    return response.data;
  }

  async getSession(sessionId: string): Promise<JulesSession> {
    this.ensureApiKey();
    const name = this.normalizeName("sessions", sessionId);
    const response = await this.axiosInstance.get<JulesSession>(`/${name}`);
    return response.data;
  }

  async listSessions(args: { page_size?: number; page_token?: string } = {}): Promise<{ sessions?: JulesSession[]; nextPageToken?: string }> {
    this.ensureApiKey();
    const params: any = { pageSize: args.page_size, pageToken: args.page_token };
    const response = await this.axiosInstance.get("/sessions", { params });
    return response.data;
  }

  async approveSessionPlan(sessionId: string): Promise<unknown> {
    this.ensureApiKey();
    const name = this.normalizeName("sessions", sessionId);
    const response = await this.axiosInstance.post(`/${name}:approvePlan`);
    return response.data;
  }

  async sendSessionMessage(sessionId: string, prompt: string): Promise<unknown> {
    this.ensureApiKey();
    const name = this.normalizeName("sessions", sessionId);
    const response = await this.axiosInstance.post(`/${name}:sendMessage`, { prompt });
    return response.data;
  }

  async getActivity(sessionId: string, activityId: string): Promise<unknown> {
    this.ensureApiKey();
    const sessionName = this.normalizeName("sessions", sessionId);
    const activityName = this.normalizeName("activities", activityId);
    const response = await this.axiosInstance.get(`/${sessionName}/${activityName}`);
    return response.data;
  }

  async listActivities(args: { session_id: string; page_size?: number; page_token?: string }): Promise<{ activities?: JulesActivity[]; nextPageToken?: string }> {
    this.ensureApiKey();
    const sessionName = this.normalizeName("sessions", args.session_id);
    const params: any = { pageSize: args.page_size, pageToken: args.page_token };
    const response = await this.axiosInstance.get<{ activities?: JulesActivity[]; nextPageToken?: string }>(`/${sessionName}/activities`, { params });
    return response.data;
  }

  async listAllActivities(sessionId: string): Promise<JulesActivity[]> {
    this.ensureApiKey();
    const sessionName = this.normalizeName("sessions", sessionId);
    let allActivities: JulesActivity[] = [];
    let pageToken: string | undefined = undefined;

    do {
      const params: any = { pageToken };
      const response = await this.axiosInstance.get<{ activities?: JulesActivity[]; nextPageToken?: string }>(`/${sessionName}/activities`, { params });
      allActivities = allActivities.concat(response.data.activities || []);
      pageToken = response.data.nextPageToken;
    } while (pageToken);

    return allActivities;
  }

  async fetchRecentActivities(sessionName: string, pageSize: number): Promise<JulesActivity[]> {
    this.ensureApiKey();
    const response = await this.axiosInstance.get<{ activities?: JulesActivity[] }>(`/${sessionName}/activities`, {
      params: { pageSize },
    });
    const activities = response.data.activities || [];
    return activities.slice().sort((a, b) => {
      const left = new Date(a.createTime || 0).getTime();
      const right = new Date(b.createTime || 0).getTime();
      return left - right;
    });
  }
}
