import type {
  ChatProviderBridgeMode,
  ChatProviderKind,
  ChatProviderSetupSchema,
} from "../../contracts/chat-provider-types.js";
import { discordChatConnectorProfile } from "./providers/discord.js";
import { imessageChatConnectorProfile } from "./providers/imessage.js";
import { microsoftTeamsChatConnectorProfile } from "./providers/microsoft-teams.js";
import { slackChatConnectorProfile } from "./providers/slack.js";
import { telegramChatConnectorProfile } from "./providers/telegram.js";
import { whatsappChatConnectorProfile } from "./providers/whatsapp.js";
import type { ChatConnectorProfile } from "./types.js";

export const CHAT_CONNECTOR_KINDS = [
  "whatsapp",
  "imessage",
  "telegram",
  "slack",
  "microsoft-teams",
  "discord",
] as const satisfies readonly ChatProviderKind[];

export interface ChatConnectorRegistry {
  readonly profiles: readonly ChatConnectorProfile[];
  get(kind: ChatProviderKind): ChatConnectorProfile;
  getForMode(kind: ChatProviderKind, mode: ChatProviderBridgeMode): ChatConnectorProfile;
}

export function createChatConnectorRegistry(profiles: readonly ChatConnectorProfile[]): ChatConnectorRegistry {
  const profilesByKind = new Map<ChatProviderKind, ChatConnectorProfile>();
  for (const profile of profiles) {
    if (!CHAT_CONNECTOR_KINDS.includes(profile.kind)) {
      throw new Error(`Unsupported chat provider kind: ${profile.kind}`);
    }
    if (profilesByKind.has(profile.kind)) {
      throw new Error(`Duplicate chat connector profile: ${profile.kind}`);
    }
    const schemaModes = profile.setupSchema.bridgeModes.map((bridge) => bridge.mode);
    if (
      profile.setupSchema.kind !== profile.kind
      || profile.supportedTransportModes.length !== schemaModes.length
      || profile.supportedTransportModes.some((mode) => !schemaModes.includes(mode))
    ) {
      throw new Error(`Chat connector profile modes do not match its setup schema: ${profile.kind}`);
    }
    profilesByKind.set(profile.kind, profile);
  }

  for (const kind of CHAT_CONNECTOR_KINDS) {
    if (!profilesByKind.has(kind)) {
      throw new Error(`Missing chat connector profile: ${kind}`);
    }
  }

  const registeredProfiles = Object.freeze([...profiles]);
  return Object.freeze({
    profiles: registeredProfiles,
    get(kind: ChatProviderKind): ChatConnectorProfile {
      const profile = profilesByKind.get(kind);
      if (!profile) {
        throw new Error(`Unsupported chat provider kind: ${kind}`);
      }
      return profile;
    },
    getForMode(kind: ChatProviderKind, mode: ChatProviderBridgeMode): ChatConnectorProfile {
      const profile = this.get(kind);
      if (!profile.supportedTransportModes.includes(mode)) {
        throw new Error(`Unsupported bridge mode for ${kind}: ${mode}`);
      }
      return profile;
    },
  });
}

export const CHAT_CONNECTOR_REGISTRY = createChatConnectorRegistry([
  whatsappChatConnectorProfile,
  imessageChatConnectorProfile,
  telegramChatConnectorProfile,
  slackChatConnectorProfile,
  microsoftTeamsChatConnectorProfile,
  discordChatConnectorProfile,
]);

export const CHAT_PROVIDER_SETUP_SCHEMAS: readonly ChatProviderSetupSchema[] =
  CHAT_CONNECTOR_REGISTRY.profiles.map((profile) => profile.setupSchema);

export function getChatConnectorProfile(kind: ChatProviderKind): ChatConnectorProfile {
  return CHAT_CONNECTOR_REGISTRY.get(kind);
}

export function getChatConnectorProfileForMode(
  kind: ChatProviderKind,
  mode: ChatProviderBridgeMode,
): ChatConnectorProfile {
  return CHAT_CONNECTOR_REGISTRY.getForMode(kind, mode);
}

export function getChatProviderSetupSchema(kind: ChatProviderKind): ChatProviderSetupSchema {
  return getChatConnectorProfile(kind).setupSchema;
}
