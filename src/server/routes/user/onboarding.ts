import type { Express } from "express";
import type { DashboardDependencies } from "../../dashboard-server.js";
import { syncRoute } from "../../route-utils.js";
import { toOnboardingStateResponse } from "../../../domain/user/onboarding-state.js";

export function registerUserOnboardingRoutes(router: Express, deps: DashboardDependencies): void {
  router.get("/api/user/onboarding", syncRoute((req, res) => {
    if (!deps.getOnboardingState) {
      res.status(501).json({ error: "Onboarding state is not available." });
      return;
    }
    res.json(toOnboardingStateResponse(deps.getOnboardingState()));
  }));

  router.post("/api/user/onboarding/complete", syncRoute((req, res) => {
    if (!deps.markOnboardingCompleted) {
      res.status(501).json({ error: "Onboarding state is not available." });
      return;
    }
    res.json(toOnboardingStateResponse(deps.markOnboardingCompleted()));
  }));

  router.post("/api/user/onboarding/cancel", syncRoute((req, res) => {
    if (!deps.markOnboardingCompleted) {
      res.status(501).json({ error: "Onboarding state is not available." });
      return;
    }
    res.json(toOnboardingStateResponse(deps.markOnboardingCompleted()));
  }));

  router.post("/api/user/onboarding/reset", syncRoute((req, res) => {
    if (!deps.resetOnboardingState) {
      res.status(501).json({ error: "Onboarding state is not available." });
      return;
    }
    res.json(toOnboardingStateResponse(deps.resetOnboardingState()));
  }));
}
