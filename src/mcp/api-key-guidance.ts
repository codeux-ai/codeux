export const buildMissingJulesApiKeyMessage = (dashboardPort: number): string => {
  return [
    "Jules API key is not configured.",
    "Set it in one of these locations:",
    "1. `.env` file (`JULES_API_KEY=...`)",
    "2. `.settings` file (`.code-ux/settings.json` with `julesApiKey`)",
    `3. Dashboard settings at http://localhost:${dashboardPort}`,
    "If your key is already set system-wide, restart this process in that environment.",
    "After saving the key, retry your command.",
  ].join("\n");
};
