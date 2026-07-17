import type { JulesActivity, JulesSession } from "../../contracts/app-types.js";
import type { JulesUsageConversation } from "./jules-activity-projection.js";

export interface JulesClient {
  getFullConversation(sessionId: string): Promise<JulesActivity[]>;
  getUsageConversation?(sessionId: string): Promise<JulesUsageConversation>;
  getSession(sessionId: string): Promise<JulesSession>;
}
