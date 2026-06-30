# Security Policy

We take the security of **Code UX** (`@codeuxai/codeux`) seriously. Thank you for helping keep the
project and its users safe.

## Supported versions

Code UX is pre-1.0 and ships frequently. Security fixes are applied to the **latest released version**
on npm and the `main` branch. Please make sure you can reproduce an issue on the latest release before
reporting.

| Version | Supported |
| ------- | --------- |
| Latest release (`@codeuxai/codeux`) | ✅ |
| Older releases | ❌ |

## Reporting a vulnerability

**Please do not report security vulnerabilities through public GitHub issues, discussions, or pull
requests.**

Instead, use one of the following private channels:

1. **GitHub Security Advisories (preferred).** Open a private report via
   [**Report a vulnerability**](https://github.com/codeux-ai/codeux/security/advisories/new). This
   keeps the discussion confidential until a fix is ready.
2. **Email.** Contact the maintainers at **security@codeux.ai**.

Please include as much of the following as you can:

- A description of the vulnerability and its impact
- Steps to reproduce or a proof of concept
- Affected version(s), platform, and configuration
- Any suggested remediation

## What to expect

- **Acknowledgement** within **3 business days**.
- An initial **assessment and severity triage** within **7 business days**.
- Coordinated disclosure: we'll work with you on a fix and a release timeline, and credit you in the
  advisory unless you prefer to remain anonymous.

## Scope & handling notes

- Code UX is **local-first**: it runs on your machine, executes provider CLIs in Docker workspaces,
  and stores runtime state in SQLite at `~/.code-ux/app.db`. Reports involving local execution,
  container isolation, the dashboard/MCP servers, credential handling, or browser-preview proxying are
  in scope.
- Never include real provider keys, tokens, or other secrets in a report. Redact them.
- We run dependency vulnerability scanning in CI (`pnpm audit --audit-level=high`); security overrides
  are pinned in `pnpm-workspace.yaml`.

Thank you for practicing responsible disclosure.
