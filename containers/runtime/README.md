# Code UX managed runtime

The `base` and `browser` targets are shared Linux environments for Code UX
containers. Provider CLIs are intentionally excluded and are installed on the
user's machine into provider-specific Docker volumes.

The browser target contains the open-source Playwright packages and Linux
browser dependencies, but no browser binary. Code UX downloads the Playwright-
matched browser directly on the user's Docker host into a versioned volume and
mounts that volume read-only for invocations. The image smoke gate rejects any
embedded browser artifact or Widevine binary.

The application follows the `1-base` and `1-browser` channel tags at startup,
pulls them, resolves their repository digests, verifies Node 24, and executes
only the immutable digest. The workflow signs published digests and emits OCI
provenance and SBOM attestations. A weekly uncached rebuild picks up patched
base-image and Debian packages even when the runtime definition is unchanged.
