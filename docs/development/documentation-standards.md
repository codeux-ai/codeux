# Documentation Standards

Use this standard for all future docs so the documentation remains consistent as the project grows.

## Principles

- Write for maintainers first.
- Prefer concrete behavior over abstract intent.
- Keep docs synchronized with code changes.
- Document operational impact, not just implementation details.

## Required Structure for New Docs

Each new major doc should include:

1. Purpose and scope
2. Source files involved
3. Data flow or behavior summary
4. Configuration and defaults
5. Failure cases and troubleshooting notes
6. Related links

## Writing Style

- Use short sections with descriptive headings.
- Use exact field names and tool names from code.
- Provide examples in fenced code blocks.
- Avoid ambiguous terms like "sometimes" without defining conditions.

## Update Rules

When behavior changes:

1. Update the relevant topic doc.
2. Update `docs/index.md` if a new page is added.
3. Update `docs/SUMMARY.md` table of contents.
4. Add migration notes when behavior is not backward compatible.

## Source of Truth Hierarchy

1. Source code
2. Tests
3. Documentation

If docs and code differ, fix docs immediately in the same change set.
