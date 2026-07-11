# Google Drive Project Mount

The Google Drive project mount makes an existing local Google Drive sync or mount directory available to Docker-backed provider runs. Code UX does not connect to the Google Drive API, manage Google credentials, or synchronize files; the Google Drive desktop client or another host-side mount remains responsible for keeping the directory current.

> Settings area: `integrations` -> `Google Drive`
> Dashboard documentation route: `/docs/settings-google-drive-mount`

## Runtime Behavior

The feature is opt-in. A mount is created only when all of the following are true:

- **Enable Google Drive mount** is on in the effective settings.
- **Linked Drive directory** resolves to an existing host directory.
- The provider invocation uses Docker execution mode.

For qualifying runs, Code UX bind-mounts the host directory at the fixed container path:

```text
/mnt/code-ux/google-drive
```

Host-mode provider runs do not receive the directory. Changing the setting also does not add, remove, or alter mounts in containers that are already running. Start a new provider invocation after saving so Code UX can construct a new container with the effective mount settings.

## Access Modes

| Mode | Behavior | Guidance |
| --- | --- | --- |
| Read-only | The container can inspect linked files but cannot create, edit, rename, or delete them through the mount. | This is the default and recommended mode. |
| Read-write | The container can modify files in the linked directory, subject to host filesystem permissions. | Enable only when the project workflow must update Drive files and the contents are trusted and recoverable. |

Read-write access allows a provider agent to change files that the host-side Google Drive client may then synchronize to Drive. Those edits can affect collaborators and can propagate deletions or unwanted content. Read-only access limits that risk, but the mounted files are still visible to the container and may contain sensitive information. Link the narrowest suitable directory and review its contents before enabling the feature.

## Prompt Notice

When a valid mount is attached, Code UX adds a notice to Project Manager and worker prompts. The notice gives agents the fixed container path and whether access is read-only or read-write, and reminds them that the linked directory is separate from the Git workspace. The host path is not included in the prompt notice.

No notice is added when the feature is disabled, the host directory is invalid or unavailable, or the invocation is not Docker-backed.

## Effective Settings And Inheritance

Google Drive settings participate in the normal System -> Project -> Sprint settings cascade:

- System values provide defaults.
- Project overrides replace inherited values for that project.
- Sprint overrides, where supplied, take precedence for that sprint.

The enable flag, host path, and access mode resolve independently, so inspect the source badges for each field. A system change will not affect a project field that already has a project override. Reset the project override when the project should inherit the system value again.

For least privilege, keep the system default disabled and configure the linked directory at Project scope unless the same safe directory and policy genuinely apply to every project.

## Configuration

1. Ensure Google Drive is already linked and synchronized or mounted on the machine that runs Code UX.
2. Open **Settings -> Integrations -> Google Drive** in the intended System or Project scope.
3. Select the existing local directory in **Linked Drive directory**.
4. Keep **Read-only** unless containerized agents explicitly need to modify those files.
5. Turn on **Enable Google Drive mount** and save the settings.
6. Start a new Docker-backed provider invocation and use `/mnt/code-ux/google-drive` inside that container.

## Troubleshooting

### The directory is not mounted

- Confirm the effective enable flag is on and the linked path is not empty. An empty path leaves the integration inactive.
- Confirm the path exists on the Code UX host and is a directory, not a file. Missing, inaccessible, and non-directory paths fail closed: the provider run continues without the Google Drive mount and records a settings warning/activity message.
- If the configured path is relative, remember that Code UX resolves it from the project repository. Prefer selecting the intended directory with the local file picker when the location is outside the repository.
- Confirm the invocation uses Docker execution mode. Host-mode runs never receive this container mount.

### Docker cannot see the host path

The Docker daemon, not only the Code UX process, must be able to access the bind-mount source. With Docker Desktop, a VM-backed daemon, or a remote daemon, make sure the directory is shared with or mapped into the daemon's host filesystem. A path visible to the Code UX process can still be unavailable to a differently hosted Docker daemon.

### A saved change has no effect

- Check whether a Project or Sprint override is masking the System value you changed. Review the source badge for `enabled`, `hostPath`, and `accessMode`, then reset or update the narrower override as needed.
- Existing running containers keep the mounts and access mode they started with. Finish or stop the current run, then rerun the provider invocation so a new container uses the saved settings.

## Related Documentation

- [Settings overview](./index.md)
- [Integrations](./integrations.md)
- [Docker Runtime](./docker-runtime.md)
- [Configuration and Storage](../configuration-and-storage.md)
