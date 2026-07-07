# Runtime Limits

Sets preview container concurrency, host port range, app port, and startup script path.

## What It Controls

Container cap, host port start/end, internal app port, and startup override path decide how previews launch.

## Recommended Defaults

Keep preview ports on localhost-only ranges and set the app port to the project dev server port.

## Risks And Gotchas

Port collisions or wrong startup scripts prevent previews from becoming reachable.

## Dashboard Link

Open this subcategory from the dashboard docs route at `/docs/user/dashboard/settings#runtime-limits`. The Settings card header links to the matching published docs anchor.

## Related Docs

- [Browser Preview](../../dashboard/browser-preview.md)
- [Security Hardening](../../operations/security-hardening.md)
