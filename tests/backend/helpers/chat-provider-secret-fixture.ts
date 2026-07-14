import type { ChatProviderRepository } from "../../../src/repositories/chat-provider-repository.js";
import { ChatProviderSecretService } from "../../../src/services/chat-provider-secret-service.js";
import type { KeyProvider } from "../../../src/services/credentials/key-provider.js";

export function createChatProviderSecretFixture(repository: ChatProviderRepository): ChatProviderSecretService {
  const key = Buffer.alloc(32, 31);
  const keyProvider: KeyProvider = {
    providerName: "chat-provider-test-key",
    health: async () => ({ available: true, secure: true, provider: "chat-provider-test-key", keyId: "root", keyVersion: 1 }),
    getActiveKey: async () => ({ key: Buffer.from(key), keyId: "root", version: 1 }),
    getKey: async () => ({ key: Buffer.from(key), keyId: "root", version: 1 }),
  };
  return new ChatProviderSecretService(repository, keyProvider);
}
