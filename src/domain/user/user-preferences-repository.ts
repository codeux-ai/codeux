import { SettingsDbStorage } from "../../repositories/settings-db-storage.js";
import type { OnboardingStateRecord } from "./onboarding-state.js";

export class UserPreferencesRepository {
  private readonly storage: SettingsDbStorage;

  constructor(dbPath?: string) {
    this.storage = new SettingsDbStorage(dbPath);
  }

  getOnboardingState(): OnboardingStateRecord {
    const onboardingCompletedAt = this.storage.readOnboardingCompletedAt();
    return { onboardingCompletedAt };
  }

  markOnboardingCompleted(completedAt?: string): OnboardingStateRecord {
    const nextCompletedAt = completedAt || new Date().toISOString();
    this.storage.writeOnboardingCompletedAt(nextCompletedAt);
    return { onboardingCompletedAt: nextCompletedAt };
  }

  resetOnboardingState(): OnboardingStateRecord {
    this.storage.clearOnboardingCompletedAt();
    return { onboardingCompletedAt: null };
  }
}
