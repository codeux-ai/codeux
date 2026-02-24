import axios from "axios";
import type { AxiosInstance } from "axios";
import type { JulesActivity, JulesSession, JulesSource } from "./types.js";

export interface JulesApiClientOptions {
  apiKey: string;
  baseUrl: string;
}

export class JulesApiClient {
  private readonly axiosInstance: AxiosInstance;

  constructor(options: JulesApiClientOptions) {
    this.axiosInstance = axios.create({
      baseURL: options.baseUrl,
      headers: {
        "X-Goog-Api-Key": options.apiKey,
        "Content-Type": "application/json",
      },
    });
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
    const response = await this.axiosInstance.get(`/${this.normalizeName("sources", sourceId)}`);
    return response.data;
  }

  async listSources(args: { filter?: string; page_size?: number; page_token?: string }): Promise<unknown> {
    const params: any = { filter: args.filter, pageSize: args.page_size, pageToken: args.page_token };
    const response = await this.axiosInstance.get("/sources", { params });
    return response.data;
  }

  async listAllSources(filter?: string): Promise<JulesSource[]> {
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
    const response = await this.axiosInstance.post<JulesSession>("/sessions", data);
    return response.data;
  }

  async getSession(sessionId: string): Promise<JulesSession> {
    const name = this.normalizeName("sessions", sessionId);
    const response = await this.axiosInstance.get<JulesSession>(`/${name}`);
    return response.data;
  }

  async listSessions(args: { page_size?: number; page_token?: string } = {}): Promise<{ sessions?: JulesSession[]; nextPageToken?: string }> {
    const params: any = { pageSize: args.page_size, pageToken: args.page_token };
    const response = await this.axiosInstance.get("/sessions", { params });
    return response.data;
  }

  async approveSessionPlan(sessionId: string): Promise<unknown> {
    const name = this.normalizeName("sessions", sessionId);
    const response = await this.axiosInstance.post(`/${name}:approvePlan`);
    return response.data;
  }

  async sendSessionMessage(sessionId: string, prompt: string): Promise<unknown> {
    const name = this.normalizeName("sessions", sessionId);
    const response = await this.axiosInstance.post(`/${name}:sendMessage`, { prompt });
    return response.data;
  }

  async getActivity(sessionId: string, activityId: string): Promise<unknown> {
    const sessionName = this.normalizeName("sessions", sessionId);
    const activityName = this.normalizeName("activities", activityId);
    const response = await this.axiosInstance.get(`/${sessionName}/${activityName}`);
    return response.data;
  }

  async listActivities(args: { session_id: string; page_size?: number; page_token?: string }): Promise<{ activities?: JulesActivity[]; nextPageToken?: string }> {
    const sessionName = this.normalizeName("sessions", args.session_id);
    const params: any = { pageSize: args.page_size, pageToken: args.page_token };
    const response = await this.axiosInstance.get<{ activities?: JulesActivity[]; nextPageToken?: string }>(`/${sessionName}/activities`, { params });
    return response.data;
  }

  async listAllActivities(sessionId: string): Promise<JulesActivity[]> {
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
