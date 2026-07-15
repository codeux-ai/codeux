import type { InvocationRoutingId, ProjectSettings, ProviderConfigId } from "../../../types.js";
import { translateDashboardMessage, type DashboardLocale } from "../../i18n/locales.js";
import { settingsModelsMessages } from "../../i18n/messages/settings-models.js";

type InvocationRoute = ProjectSettings["aiProvider"]["invocationRouting"][InvocationRoutingId];

const ROUTE_MESSAGE_KEYS = {
  task_coding: ["routeTaskCoding", "routeTaskCodingDescription"],
  planning: ["routePlanning", "routePlanningDescription"],
  dashboard_reply: ["routeDashboardReply", "routeDashboardReplyDescription"],
  clarification_reply: ["routeClarificationReply", "routeClarificationReplyDescription"],
  qa_review: ["routeQaReview", "routeQaReviewDescription"],
  ci_fix: ["routeCiFix", "routeCiFixDescription"],
  merge_conflict: ["routeMergeConflict", "routeMergeConflictDescription"],
  remediation: ["routeRemediation", "routeRemediationDescription"],
} as const;

export const getInvocationRouteDisplay = (
  routeId: InvocationRoutingId,
  locale: DashboardLocale = "en",
): { label: string; description: string } => {
  const [labelKey, descriptionKey] = ROUTE_MESSAGE_KEYS[routeId];
  return {
    label: translateDashboardMessage(settingsModelsMessages, locale, labelKey),
    description: translateDashboardMessage(settingsModelsMessages, locale, descriptionKey),
  };
};

export const getRoutingProfileLabel = (
  profile: "GLOBAL" | "WORKER",
  locale: DashboardLocale = "en",
): string => translateDashboardMessage(
  settingsModelsMessages,
  locale,
  profile === "GLOBAL" ? "profileGlobal" : "profileWorker",
);

export function resolveRouteDisplayProviderPool(
  route: InvocationRoute,
  primaryProviderId: ProviderConfigId | null,
  providers: ProjectSettings["aiProvider"]["providers"],
): ProviderConfigId[] {
  if (route.strategy === "MANUAL") {
    return primaryProviderId ? [primaryProviderId] : [];
  }

  if (route.allowedProviders.length > 0) {
    return route.allowedProviders.filter((providerConfigId) => providers[providerConfigId]);
  }

  return primaryProviderId ? [primaryProviderId] : [];
}
