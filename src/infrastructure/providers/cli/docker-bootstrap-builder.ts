import { getProviderFallbackInstallCommand } from "../../../services/cli-docker-utils.js";
import { CONTAINER_SETUP_SCRIPT } from "../../../services/cli-workflow-utils.js";

export const CODEX_CREDENTIALS_MOUNT = "/opt/credentials/codex";
export const GITHUB_CREDENTIALS_MOUNT = "/opt/credentials/gh";
export const GEMINI_CREDENTIALS_MOUNT = "/opt/credentials/gemini";
export const CLAUDE_CODE_CREDENTIALS_MOUNT = "/opt/credentials/claude-code";
export const CLAUDE_CODE_AUTH_JSON_MOUNT = "/opt/credentials/claude-code-auth.json";
export const QWEN_CODE_CREDENTIALS_MOUNT = "/opt/credentials/qwen-code";
export const OPENCODE_CREDENTIALS_MOUNT = "/opt/credentials/opencode";
export const GITCONFIG_CREDENTIALS_MOUNT = "/opt/credentials/gitconfig";
export const CLAUDE_CODE_MCP_CONFIG_MOUNT = "/opt/provider-config/claude-mcp.json";
export const GEMINI_MCP_SETTINGS_MOUNT = "/opt/provider-config/gemini-settings.json";
export const CODEX_MCP_CONFIG_MOUNT = "/opt/provider-config/codex-config.toml";
export const QWEN_CODE_SETTINGS_MOUNT = "/opt/provider-config/qwen-settings.json";

export interface DockerBootstrapOptions {
  runtimeNpmPrefix: string;
  runtimeNpmCache: string;
  fallbackProviders?: string[];
  runSetupScript?: boolean;
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
      this.setupScript(options.runSetupScript !== false),
      this.fallbackInstall(options.fallbackProviders || ["gemini", "codex", "claude", "qwen", "opencode"]),
      this.claudeAuth(),
      this.execution(),
    ];

    return sections.filter(Boolean).join("\n");
  }

  private header(): string {
    return [
      "set -euo pipefail",
      "mkdir -p \"$HOME/.config\" \"$HOME/.codex\" \"$HOME/.claude\" \"$HOME/.gemini\" \"$HOME/.qwen\" \"$HOME/.local/share/opencode\" \"$HOME/.config/opencode\"",
      "sync_dir_contents() { local source=\"$1\"; local destination=\"$2\"; local label=\"$3\"; mkdir -p \"$destination\"; if ! cp -r \"$source/.\" \"$destination/\"; then echo \"provider-runner: warning: failed to copy $label credentials\" >&2; fi; }",
      "copy_if_present() { local source=\"$1\"; local destination=\"$2\"; local label=\"$3\"; if [ -e \"$source\" ]; then mkdir -p \"$(dirname \"$destination\")\"; if ! cp -f \"$source\" \"$destination\"; then echo \"provider-runner: warning: failed to copy $label\" >&2; fi; fi; }",
      "merge_json_file() { local source=\"$1\"; local destination=\"$2\"; local label=\"$3\"; if [ ! -e \"$source\" ]; then return 0; fi; mkdir -p \"$(dirname \"$destination\")\"; if ! node -e 'const fs=require(\"fs\"); const [source,destination]=process.argv.slice(1); const read=(file)=>{ try { return JSON.parse(fs.readFileSync(file,\"utf8\")); } catch { return {}; } }; const sourceJson=read(source); const destinationJson=read(destination); const merged={...destinationJson,...sourceJson}; if (destinationJson.mcpServers || sourceJson.mcpServers) merged.mcpServers={...(destinationJson.mcpServers||{}), ...(sourceJson.mcpServers||{})}; fs.writeFileSync(destination, `${JSON.stringify(merged, null, 2)}\\n`);' \"$source\" \"$destination\"; then echo \"provider-runner: warning: failed to merge $label\" >&2; fi; }",
      "append_if_missing_literal() { local source=\"$1\"; local destination=\"$2\"; local literal=\"$3\"; local label=\"$4\"; if [ ! -e \"$source\" ]; then return 0; fi; mkdir -p \"$(dirname \"$destination\")\"; if [ -f \"$destination\" ] && grep -Fq \"$literal\" \"$destination\"; then return 0; fi; if [ -s \"$destination\" ]; then printf '\\n' >> \"$destination\"; fi; if ! cat \"$source\" >> \"$destination\"; then echo \"provider-runner: warning: failed to append $label\" >&2; fi; }",
      "ensure_json_file() { local destination=\"$1\"; local content=\"$2\"; mkdir -p \"$(dirname \"$destination\")\"; if [ ! -f \"$destination\" ]; then printf '%s\\n' \"$content\" > \"$destination\"; fi; }",
    ].join("\n");
  }

  private credentialSync(): string {
    return [
      `if [ -e "${GITCONFIG_CREDENTIALS_MOUNT}" ]; then cp -f "${GITCONFIG_CREDENTIALS_MOUNT}" "$HOME/.gitconfig" || echo "provider-runner: warning: failed to copy .gitconfig" >&2; fi`,
      `if [ -d "${CODEX_CREDENTIALS_MOUNT}" ]; then [ -f "${CODEX_CREDENTIALS_MOUNT}/auth.json" ] && cp -f "${CODEX_CREDENTIALS_MOUNT}/auth.json" "$HOME/.codex/auth.json"; [ -f "${CODEX_CREDENTIALS_MOUNT}/config.toml" ] && cp -f "${CODEX_CREDENTIALS_MOUNT}/config.toml" "$HOME/.codex/config.toml"; fi`,
      `if [ -d "${GITHUB_CREDENTIALS_MOUNT}" ]; then sync_dir_contents "${GITHUB_CREDENTIALS_MOUNT}" "$HOME/.config/gh" "gh"; fi`,
    ].join("\n");
  }

  private npmConfig(runtimeNpmPrefix: string, runtimeNpmCache: string): string {
    return [
      `export NPM_CONFIG_PREFIX="${runtimeNpmPrefix}"`,
      `export NPM_CONFIG_CACHE="${runtimeNpmCache}"`,
      "export npm_config_cache=\"$NPM_CONFIG_CACHE\"",
      "export PNPM_STORE_DIR=\"$NPM_CONFIG_CACHE/pnpm-store\"",
      "export pnpm_config_store_dir=\"$PNPM_STORE_DIR\"",
      "mkdir -p \"$NPM_CONFIG_PREFIX\" \"$NPM_CONFIG_CACHE\" \"$PNPM_STORE_DIR\"",
      "export PATH=\"$HOME/.local/bin:$NPM_CONFIG_PREFIX/bin:$PATH\"",
    ].join("\n");
  }

  private setupScript(enabled: boolean): string {
    if (!enabled) {
      return "";
    }
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
      `merge_json_file "${CLAUDE_CODE_MCP_CONFIG_MOUNT}" "$HOME/.mcp.json" "claude mcp config"`,
      "if [ \"$1\" = \"gemini\" ]; then",
      "  mkdir -p \"$HOME/.gemini/tmp\" \"$HOME/.gemini/history\" \"$HOME/.gemini/memory\"",
      "  ensure_json_file \"$HOME/.gemini/projects.json\" '{\"projects\":{}}'",
      `  copy_if_present "${GEMINI_CREDENTIALS_MOUNT}/settings.json" "$HOME/.gemini/settings.json" "gemini settings.json"`,
      `  copy_if_present "${GEMINI_CREDENTIALS_MOUNT}/oauth_creds.json" "$HOME/.gemini/oauth_creds.json" "gemini oauth_creds.json"`,
      `  copy_if_present "${GEMINI_CREDENTIALS_MOUNT}/google_accounts.json" "$HOME/.gemini/google_accounts.json" "gemini google_accounts.json"`,
      `  copy_if_present "${GEMINI_CREDENTIALS_MOUNT}/installation_id" "$HOME/.gemini/installation_id" "gemini installation_id"`,
      `  copy_if_present "${GEMINI_CREDENTIALS_MOUNT}/state.json" "$HOME/.gemini/state.json" "gemini state.json"`,
      `  copy_if_present "${GEMINI_CREDENTIALS_MOUNT}/trustedFolders.json" "$HOME/.gemini/trustedFolders.json" "gemini trustedFolders.json"`,
      `  merge_json_file "${GEMINI_MCP_SETTINGS_MOUNT}" "$HOME/.gemini/settings.json" "gemini mcp settings.json"`,
      "fi",
      "if [ \"$1\" = \"claude\" ]; then",
      `  if [ -f "${CLAUDE_CODE_CREDENTIALS_MOUNT}/.credentials.json" ]; then cp -f "${CLAUDE_CODE_CREDENTIALS_MOUNT}/.credentials.json" "$HOME/.claude/.credentials.json"; fi`,
      `  if [ -f "${CLAUDE_CODE_AUTH_JSON_MOUNT}" ]; then cp -f "${CLAUDE_CODE_AUTH_JSON_MOUNT}" "$HOME/.claude.json"; fi`,
      "fi",
      "if [ \"$1\" = \"qwen\" ]; then",
      `  if [ -d "${QWEN_CODE_CREDENTIALS_MOUNT}" ]; then sync_dir_contents "${QWEN_CODE_CREDENTIALS_MOUNT}" "$HOME/.qwen" "qwen"; fi`,
      `  merge_json_file "${QWEN_CODE_SETTINGS_MOUNT}" "$HOME/.qwen/settings.json" "qwen settings.json"`,
      "fi",
      "if [ \"$1\" = \"opencode\" ]; then",
      `  if [ -d "${OPENCODE_CREDENTIALS_MOUNT}" ]; then sync_dir_contents "${OPENCODE_CREDENTIALS_MOUNT}" "$HOME/.local/share/opencode" "opencode"; fi`,
      "fi",
      `append_if_missing_literal "${CODEX_MCP_CONFIG_MOUNT}" "$HOME/.codex/config.toml" "[mcp_servers.code-ux]" "codex mcp config"`,
    ].join("\n");
  }

  private execution(): string {
    return "exec \"$@\"";
  }
}
