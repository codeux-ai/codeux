# Code UX managed runtime

The `base` and `browser` targets are shared Linux environments for Code UX
containers. Provider CLIs are intentionally excluded and are installed on the
user's machine into provider-specific Docker volumes.

The application follows the `1-base` and `1-browser` channel tags at startup,
pulls them, resolves their repository digests, verifies Node 24, and executes
only the immutable digest. The workflow signs published digests and emits OCI
provenance and SBOM attestations. A weekly uncached rebuild picks up patched
base-image and Debian packages even when the runtime definition is unchanged.
