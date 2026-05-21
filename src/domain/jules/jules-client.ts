import type { JulesActivity, JulesSession } from "../../contracts/app-types.js";

export interface JulesClient {
  getFullConversation(sessionId: string): Promise<JulesActivity[]>;
  getSession(sessionId: string): Promise<JulesSession>;
}

