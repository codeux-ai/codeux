# Linux Installation Guide

This guide provides step-by-step instructions for installing Code UX (jules-agent-mcp) on Linux systems.

For a high-level summary of the system architecture and goals, see the [Overview](../../README.md).

## Prerequisites

Before proceeding, ensure your system meets the following requirements:

- **Git:** Required to clone the repository or fetch recent releases.
- **Node.js:** Ensure Node.js (v18 or higher) is installed.
- **pnpm:** The project uses `pnpm` as its primary package manager. Install it via `npm install -g pnpm`.
- **Permissions:** You must have appropriate read/write access to your chosen installation directory.

---

## Option 1: Install via NPM/PNPM (Recommended)

Installing the package globally via your Node.js package manager is the recommended path to make the `jules-subagents` command available anywhere.

```bash
# Install globally via NPM
npm install -g jules-subagents

# Or using PNPM
pnpm install -g jules-subagents
```

---

## Option 2: Build from Source via Git

This method ensures you are installing directly from the latest official source code, which is ideal if you want to contribute or run from source.

### 1. Clone the Release Repository

Clone the repository to your local machine:

```bash
git clone https://github.com/numnx/jules-agent-mcp.git /opt/jules-agent-mcp
cd /opt/jules-agent-mcp
```

### 2. Install Dependencies and Build

Use `pnpm` to install dependencies and compile the source code:

```bash
pnpm install
pnpm run build
```

### 3. Global Link

Link the package globally to use the CLI tool from any directory:

```bash
pnpm link --global
```

---

## Post-Installation Verification

To verify that the installation was successful, check the application version or run a basic command to ensure the CLI is available:

```bash
jules-subagents --version
```

If the command returns the expected version number, the installation is complete.

## Troubleshooting

- **Permission Denied:** Ensure you are running commands with `sudo` where indicated, or verify you have write access to `/opt` and `/usr/local/bin`.
- **Command Not Found:** Verify that the installation directory has been added to your system's `$PATH` variable.
