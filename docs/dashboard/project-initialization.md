# Project Initialization

Project Initialization runs a repository-specific setup pass through the `Project Setup Agent`.

## Entry Points

- `Add Project` keeps the existing `Initialize with Project Setup Agent` flow for imported local and git source types.
- Imported local projects save only a project-level `git.githubMode: LOCAL` override. The same dashboard git-mode updater synchronizes internal `git_manager`, `git_manager_local`, and `git_manager_remote` skills so local imports start with repo-local git behavior.
- Imported Git URL projects do not receive git-mode or techstack overrides. They continue to inherit the remote git and unassigned techstack defaults unless the operator explicitly changes project or sprint settings or runs setup techstack detection.
- `New Project` reuses the same Add Project modal with the `new_project` source selected. The modal exposes `Local Repo` / `Remote Repo` init modes instead of setup scope controls.
- Chat includes five initial-project create-app quickactions for the currently selected project: `Create Web App`, `Create Desktop App`, `Create Onlineshop` (the Online shop action), `Create Portfolio`, and `Create Game`. These controls post typed `create_app` metadata and launch the matching detached `Plan & Start` quicksprint; they do not open the new-project modal, create/import a Code UX project, or use the normal dashboard-reply route.
- Project persistence records whether creation used `existing`, `new-local`, or `new-remote`. Imported and pre-migration projects default to `existing`; source type and creation time are never used to infer new-project provenance.
- Imported, new local, and new remote projects all start with explicit `designGuidance.selectedTechStackId: none` and `designGuidance.selectedStyleguideId: none` project overrides. Create-time guidance selections are normalized to `none`; custom guidance catalogs and visibility preferences remain available for later operator selection.
- All five create-app quickactions use `GET /api/projects/:projectId/initialization-state`, and the chat runtime repeats the same eligibility check before detached launch. Eligibility requires persisted `new-local` or `new-remote` provenance, the project directory as the repository root, a clean checkout with exactly one commit, and no root or tracked content except the initial Code UX `README.md` and `.gitignore`. The README must still match the generated `# <project name>` plus `Initialized with Code UX.` seed, and the only effective `.gitignore` entry may be `.code-ux/` (the no-trailing-slash `.code-ux` form is also accepted). Imported/legacy projects, dirty or ignored setup artifacts, altered seed content, extra files or commits, a missing checkout, and any inspection failure fail closed with eligibility disabled. After setup or any repository change, every create-app action disappears as soon as refreshed state no longer proves the initial seed.
- The initialization-state dashboard resource listens to both project structure and dedicated git realtime scopes. Repository inspection remains outside project-list loading, so the project collection does not carry or compute git status payloads.
- All `new_project` submissions, local or remote, include an explicit project `techstack` override. New local projects also include `git.githubMode: LOCAL`; new remote projects do not.
- The `new_project` branch hides the Project Setup Agent section entirely and routes creation through the backend `initMode` fields.
- New local project creation treats the directory path as optional. When no directory is selected, the dashboard submits the project name and the backend resolves it under the user's home directory; relative typed paths resolve from the user's home directory, while absolute paths selected through the desktop picker are used as-is.
- New local init does not require a Git URL slug; it only needs a project name and optional local directory path.
- New remote init still requires a Git URL slug and auto-fills it from the project name until the user edits it.
- New remote init clones into the selected clone directory, or `~/.code-ux/projects` when the field is blank, and stores the project base directory as the single checkout root `~/.code-ux/projects/<repo-name>`.
- Existing projects expose a `Setup Project` action from the project card agent button.

Imported-project setup lets the operator choose which generated artifacts to create. The dashboard keeps Docs disabled by default; selecting it embeds discovered repository documentation into Knowledge docs. Backend and MCP setup requests can also explicitly enable docs embedding:

- `Agents`
- `Quicksprints`
- `Preview Script`
- `CI`
- `Techstack`
- `Docs` (opt-in)

## Add Project Form Contract

The Add Project modal keeps source-type changes, new-project init-mode changes, and setup-scope reveal transitions tied to the shared interaction motion tokens. Reduced-motion mode resolves those transitions to instant state changes while preserving the same selected labels, focus rings, and setup-step status text.

Validation is intentionally delayed until blur or submit. Invalid submit announces one summary alert, focuses the first invalid field, and scrolls the modal body with reduced-motion-aware behavior. Inline field errors remain connected through `aria-invalid` and `aria-errormessage`, but they do not duplicate the summary alert.

Directory browsing must keep keyboard focus on the active control. Loading, current path, empty directory lists, failed loads, and selected-path confirmation are visible in the picker or directly below the associated field and are also exposed through polite live regions. Local project and new local project directory paths remain optional; git repository URL and new remote slug validation are unchanged.

During async project creation, close/cancel/submit controls expose the busy reason and suppress duplicate activation. Submission failures keep the modal open, show retryable feedback, and resubmit the same form payload when the operator chooses Retry.

## Backend Flow

The dashboard calls:

- `POST /api/projects/:projectId/setup`
- `POST /api/projects/:projectId/setup` with `background: true`

Project creation can also include the same setup request shape:

```json
{
  "setup": {
    "enabled": true,
    "options": {
      "agents": true,
      "quicksprints": true,
      "previewScript": true,
      "ci": true,
      "techstack": true,
      "docs": true
    }
  }
}
```

`ProjectSetupService` ensures a project-local `Project Setup Agent`, routes the request through the virtual provider planning path, asks for strict JSON, and applies the returned artifacts itself. This keeps the result stable when provider execution runs in Docker snapshots.

For Docker or remote provider execution, setup runs against the current remote default-branch snapshot for the project. Code UX resolves the project's saved default branch first, then the dashboard default, then `main`, and prepares the provider workspace from that branch so setup suggestions reflect the latest upstream baseline rather than an older local checkout state.

Project setup base-agent context is sourced from the bundled Code UX defaults in the app directory first, not from the mutable user home copy. The home copy is still seeded for visibility and user edits, but deleting `~/.code-ux/agents/*.md` does not remove the built-in Worker, Planning, Project manager, or Quality assurance templates from system setup prompts.

The dashboard uses background mode for user-triggered setup. The endpoint returns `202` with the created `invocationId` immediately, then the setup run continues server-side. The project card shows an `Initializing` state with the invocation short id, and toast notifications link directly to `/chat?mode=invocations&invocation=<id>` for live tracking and completion review.

Foreground setup responses include the applied artifact summary:

```json
{
  "ok": true,
  "projectId": "project-id",
  "invocationId": "invocation-id",
  "agentId": "project-setup-agent-id",
  "summary": "Setup summary",
  "createdAgentIds": ["agent-id"],
  "createdQuicksprintTemplateIds": ["template-id"],
  "writtenFiles": [".code-ux/browser/start-preview.sh"],
  "embeddedDocumentIds": ["knowledge-document-id"],
  "embeddedDocumentErrors": [
    { "fileName": "docs/broken.md", "error": "Failed to ingest file" }
  ]
}
```

`embeddedDocumentIds` lists Knowledge document records created from repository documentation during this setup run. `embeddedDocumentErrors` lists per-file discovery or ingestion failures. These errors are partial-failure diagnostics: provider-generated setup artifacts can still be applied and the setup response can still be successful when one documentation file cannot be embedded.

## Generated Artifacts

When selected, setup can create or update:

- `.code-ux/agents/*.md` through the normal agent preset sync path
- `.code-ux/quicksprints/templates/*.md` custom project templates and project-level overrides
- `.code-ux/browser/start-preview.sh`
- `.github/workflows/code-ux-basic-checks.yml`
- `.gitlab-ci.yml`
- a detected system techstack catalog entry selected through the project's `techstack.selectedTechstackId`
- repository documentation discovered from the checkout and ingested into the project's Knowledge docs library

Agent setup also updates project agent routing:

- the existing Planning agent route is preserved and never changed to `Project Setup Agent`
- task coding switches to `ORCHESTRATOR` when specialist worker agents are created
- created worker specialists are added to the orchestrator roster

Techstack setup is non-destructive and best-effort. Imported projects start with `techstack.selectedTechstackId: null`; when the operator enables `Techstack`, the Project Setup Agent inspects dependency evidence, especially `package.json`, lockfiles, workspace manifests, and framework config files. A valid result includes a stack name, description, and detected frameworks/libraries. Code UX adds the detected stack to the system catalog when no matching entry exists, then selects it for the project. Empty, invalid, or contradictory detections are ignored with a warning and do not block other selected setup artifacts.

Docs setup is opt-in and best-effort. When `docs` is enabled, Code UX discovers root documentation and files under `docs/`, then sends each file through the shared Knowledge ingestion pipeline as repository-path docs. The existing Knowledge ingestion path handles dedupe, text extraction, chunking, embedding, and document status updates. Setup reports the document IDs it receives from that path, but it does not guarantee every document has already reached `ready`; status continues to follow the KnowledgeService lifecycle shown on the Knowledge page. Individual documentation failures are reported in `embeddedDocumentErrors` and do not fail the provider-generated setup artifacts.

## Prompt Requirements

The setup prompt requires the agent to inspect the real repository before proposing artifacts, including assistant instruction files such as `AGENTS.md`, `GEMINI.md`, `Gemini.md`, `CLAUDE.md`, `Claude.md`, project documentation, dependency manifests, package scripts, source layout, existing CI, and preview/runtime configuration. When techstack detection is enabled, `package.json` dependency sections and related manifests are treated as primary evidence.

The agent output must be repository-specific. Generic role names or stack assumptions are rejected by the prompt contract in favor of architecture-aware agents, quicksprints, preview startup commands, and CI checks.
