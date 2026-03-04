import { getProviderFallbackInstallCommand } from "../../../services/cli-docker-utils.js";
import { CONTAINER_SETUP_SCRIPT } from "../../../services/cli-workflow-utils.js";

export const CODEX_CREDENTIALS_MOUNT = "/opt/credentials/codex";
export const GITHUB_CREDENTIALS_MOUNT = "/opt/credentials/gh";
export const GEMINI_CREDENTIALS_MOUNT = "/opt/credentials/gemini";
export const CLAUDE_CODE_CREDENTIALS_MOUNT = "/opt/credentials/claude-code";
export const CLAUDE_CODE_AUTH_JSON_MOUNT = "/opt/credentials/claude-code-auth.json";
export const GITCONFIG_CREDENTIALS_MOUNT = "/opt/credentials/gitconfig";

export interface DockerBootstrapOptions {
  runtimeNpmPrefix: string;
  runtimeNpmCache: string;
  fallbackProviders?: string[];
}

/**
 * Builds the bootstrap shell script for Jules providers running in Docker.
 * Handles credential syncing, npm configuration, setup script execution, and fallback tool installation.
 */
export class DockerBootstrapBuilder {
  /**
   * Generates the complete bootstrap script.
   */
  build(options: DockerBootstrapOptions): string {
    const sections = [
      this.header(),
      this.credentialSync(),
      this.npmConfig(options.runtimeNpmPrefix, options.runtimeNpmCache),
      this.setupScript(),
      this.fallbackInstall(options.fallbackProviders || ["gemini", "codex", "claude"]),
      this.claudeAuth(),
      this.execution(),
    ];

    return sections.filter(Boolean).join("\n");
  }

  private header(): string {
    return [
      "set -euo pipefail",
      "mkdir -p \"$HOME/.config\" \"$HOME/.codex\" \"$HOME/.claude\" \"$HOME/.gemini\"",
      "sync_dir_contents() { local source=\"$1\"; local destination=\"$2\"; local label=\"$3\"; mkdir -p \"$destination\"; if ! cp -r \"$source/.\" \"$destination/\"; then echo \"provider-runner: warning: failed to copy $label credentials\" >&2; fi; }",
    ].join("\n");
  }

  private credentialSync(): string {
    return [
      `if [ -e "${GITCONFIG_CREDENTIALS_MOUNT}" ]; then cp -f "${GITCONFIG_CREDENTIALS_MOUNT}" "$HOME/.gitconfig" || echo "provider-runner: warning: failed to copy .gitconfig" >&2; fi`,
      `if [ -d "${CODEX_CREDENTIALS_MOUNT}" ]; then [ -f "${CODEX_CREDENTIALS_MOUNT}/auth.json" ] && cp -f "${CODEX_CREDENTIALS_MOUNT}/auth.json" "$HOME/.codex/auth.json"; [ -f "${CODEX_CREDENTIALS_MOUNT}/config.toml" ] && cp -f "${CODEX_CREDENTIALS_MOUNT}/config.toml" "$HOME/.codex/config.toml"; fi`,
      `if [ -d "${GITHUB_CREDENTIALS_MOUNT}" ]; then sync_dir_contents "${GITHUB_CREDENTIALS_MOUNT}" "$HOME/.config/gh" "gh"; fi`,
      `if [ -d "${GEMINI_CREDENTIALS_MOUNT}" ]; then sync_dir_contents "${GEMINI_CREDENTIALS_MOUNT}" "$HOME/.gemini" "gemini"; fi`,
    ].join("\n");
  }

  private npmConfig(runtimeNpmPrefix: string, runtimeNpmCache: string): string {
    return [
      `export NPM_CONFIG_PREFIX="${runtimeNpmPrefix}"`,
      `export NPM_CONFIG_CACHE="${runtimeNpmCache}"`,
      "export npm_config_cache=\"$NPM_CONFIG_CACHE\"",
      "mkdir -p \"$NPM_CONFIG_PREFIX\" \"$NPM_CONFIG_CACHE\"",
      "export PATH=\"$HOME/.local/bin:$NPM_CONFIG_PREFIX/bin:$PATH\"",
    ].join("\n");
  }

  private setupScript(): string {
    return `if [ -f "${CONTAINER_SETUP_SCRIPT}" ]; then bash "${CONTAINER_SETUP_SCRIPT}" || echo "provider-runner: setup script failed" >&2; fi`;
  }

  private fallbackInstall(fallbackProviders: string[]): string {
    const fallbackInstallCases = fallbackProviders.flatMap((providerCommand) => {
      const installCommand = getProviderFallbackInstallCommand(providerCommand);
      return installCommand ? [`    ${providerCommand}) ${installCommand} ;;`] : [];
    });

    if (fallbackInstallCases.length === 0) return "";

    return `if ! command -v "$1" >/dev/null 2>&1; then case "$1" in ${fallbackInstallCases.join(" ")} esac; fi`;
  }

  private claudeAuth(): string {
    return [
      "if [ \"$1\" = \"claude\" ]; then",
      `  if [ -f "${CLAUDE_CODE_CREDENTIALS_MOUNT}/.credentials.json" ]; then cp -f "${CLAUDE_CODE_CREDENTIALS_MOUNT}/.credentials.json" "$HOME/.claude/.credentials.json"; fi`,
      `  if [ -f "${CLAUDE_CODE_AUTH_JSON_MOUNT}" ]; then cp -f "${CLAUDE_CODE_AUTH_JSON_MOUNT}" "$HOME/.claude.json"; fi`,
      "fi",
    ].join("\n");
  }

  private execution(): string {
    return "exec \"$@\"";
  }
}
