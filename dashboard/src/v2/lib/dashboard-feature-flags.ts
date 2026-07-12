export const DASHBOARD_FEATURE_IDS = ["nodes", "custom-dashboards"] as const;

export type DashboardFeatureId = typeof DASHBOARD_FEATURE_IDS[number];

export type DashboardFeatureFlagMap = Record<DashboardFeatureId, boolean>;

export type DashboardFeatureFlagValues = Partial<Record<DashboardFeatureId, unknown>>;

export interface DashboardFeatureFlagSource {
  devMode?: boolean;
  values?: DashboardFeatureFlagValues;
  prerequisites?: Partial<Record<"nodeFlowBackend" | "automationSecurity", unknown>>;
}

export const DASHBOARD_FEATURE_ENV_KEYS: Record<DashboardFeatureId, string> = {
  nodes: "VITE_CODEUX_FEATURE_NODES",
  "custom-dashboards": "VITE_CODEUX_FEATURE_CUSTOM_DASHBOARDS",
};

const ENABLED_VALUES = new Set(["1", "true", "yes", "on", "enabled"]);
const DISABLED_VALUES = new Set(["0", "false", "no", "off", "disabled"]);

export const parseDashboardFeatureFlagValue = (value: unknown): boolean | null => {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (ENABLED_VALUES.has(normalized)) {
    return true;
  }
  if (DISABLED_VALUES.has(normalized)) {
    return false;
  }
  return null;
};

const readDashboardFeatureFlagSource = (): DashboardFeatureFlagSource => {
  const env = import.meta.env as ImportMetaEnv & Record<string, unknown>;
  return {
    devMode: Boolean(env.DEV),
    values: {
      nodes: env[DASHBOARD_FEATURE_ENV_KEYS.nodes],
      "custom-dashboards": env[DASHBOARD_FEATURE_ENV_KEYS["custom-dashboards"]],
    },
    prerequisites: {
      nodeFlowBackend: env.VITE_CODEUX_NODE_FLOW_BACKEND,
      automationSecurity: env.VITE_CODEUX_AUTOMATION_SECURITY,
    },
  };
};

export const resolveDashboardFeatureFlags = (
  source: DashboardFeatureFlagSource = readDashboardFeatureFlagSource(),
): DashboardFeatureFlagMap => {
  // Development is the feature-discovery environment: every flagged surface must
  // remain reachable even when a checked-in/local env file disables it for a
  // production bundle. Outside development, explicit values still control the
  // feature and omitted values remain disabled by default.
  if (source.devMode) {
    return DASHBOARD_FEATURE_IDS.reduce<DashboardFeatureFlagMap>((flags, feature) => {
      flags[feature] = true;
      return flags;
    }, {} as DashboardFeatureFlagMap);
  }

  return DASHBOARD_FEATURE_IDS.reduce<DashboardFeatureFlagMap>((flags, feature) => {
    const explicitValue = parseDashboardFeatureFlagValue(source.values?.[feature]);
    if (feature === "nodes") {
      const backendReady = parseDashboardFeatureFlagValue(source.prerequisites?.nodeFlowBackend) === true;
      const securityReady = parseDashboardFeatureFlagValue(source.prerequisites?.automationSecurity) === true;
      flags[feature] = explicitValue === true && backendReady && securityReady;
    } else {
      flags[feature] = explicitValue ?? false;
    }
    return flags;
  }, {} as DashboardFeatureFlagMap);
};

export const isDashboardFeatureEnabled = (
  feature: DashboardFeatureId,
  flags: DashboardFeatureFlagMap = resolveDashboardFeatureFlags(),
): boolean => flags[feature];
