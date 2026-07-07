# Onboarding Flow Documentation

The onboarding experience for Code UX walks users through configuring their installation, establishing AI provider credentials, and setting up repository-specific integrations.

## Provider Settings & Catalog Synchronization
The logic for transforming provider credentials, sorting, filtering, and mapping defaults resides in a dedicated module:
\`src/v2/lib/onboarding-provider-settings.ts\`

This module provides pure functions that process the \`SystemSettings\` state, enabling components like \`OnboardingExperience.tsx\` to manage only the UI and side-effects.

Key functions:
- \`syncProjectProvidersToIntegrationCatalog\`: Ensures project provider configurations remain in sync with the global system integrations. It also handles falling back to valid default virtual worker selections when providers are added or removed.
- \`getProviderInitialSelection\`: Automatically pre-selects providers that have been detected locally.
- \`getSystemProvidersByType\`: Sorts and groups integration instances for display in the onboarding settings cards.

## UI Flow
The UI uses GSAP and a reduced motion hook for transitions. Deep Ocean background applies for aesthetic appeal. State is preserved across multiple settings tabs until the user finishes onboarding.

## Installation Step

`OnboardingInstallationStep.tsx` is the reusable presentational view for Docker/Git readiness setup. It receives readiness installer metadata and callback props from its parent; it does not call installer APIs directly. When required dependencies are missing and the recommended installer option is available, the step shows `Auto Install dependencies` and explains that Code UX will run the detected OS package manager only after that explicit click. Advanced choices expose `Docker Desktop + Git` and `Docker Engine + Git` with availability, recommended/degraded state, privilege and manual-download guidance, live progress, latest command results, retry/recheck actions, and preserved manual Docker/Git links.
