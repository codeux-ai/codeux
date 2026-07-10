#!/usr/bin/env bash
set -euo pipefail

# The managed Code UX runtime already contains the shared Linux development
# toolchain, package managers, and optional browser layer. Provider CLIs are
# prepared separately in versioned Docker volumes and must not be installed by
# this script.
echo "[setup] Code UX managed runtime is ready."
echo "[setup] Add project-specific bootstrap commands to an explicitly configured setup script."
